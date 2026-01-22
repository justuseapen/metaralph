/**
 * Phase Orchestrator - Manages autonomous TDD phase transitions
 *
 * Orchestrates the 6-phase TDD workflow:
 * RED -> RESEARCH -> GREEN -> INTEGRATE -> REFINE -> COMMIT
 *
 * The orchestrator manages phase transitions, handles failures with rollback,
 * and allows the REFINE phase to loop until P0/P1 bugs are resolved.
 */

import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';
import {
  type TddPhase,
  type PhaseStatus,
  type TddPhaseRecord,
  type TddResult,
  type AutonomousTddConfig,
  type PhaseOrchestratorEvents,
  type FrozenContracts,
  type Bug,
  DEFAULT_TDD_CONFIG,
} from './types.js';
import { PhaseRepository, BugRepository } from './repositories/index.js';
import { type UserStory } from '../collaboration/prd-builder.js';
import { TestGenerator, type TestFramework } from './test-generator.js';
import { ResearchCoordinator } from './research-coordinator.js';
import { GreenPhase, type GreenPhaseResult } from './green-phase.js';
import { ContractValidator, type ContractValidationResult } from './contract-validator.js';
import { BugClassifier, type BugClassificationResult, type AutoFixResult } from './bug-classifier.js';
import { ReceiptBuilder } from './receipt-builder.js';
import { Rollback, type Checkpoint } from '../self-improve/rollback.js';

/**
 * Valid phase transitions in the TDD workflow
 * Each phase maps to the set of phases it can transition to
 */
const VALID_TRANSITIONS: Record<TddPhase | 'start', TddPhase[]> = {
  start: ['red'],
  red: ['research'],
  research: ['green'],
  green: ['integrate'],
  integrate: ['refine'],
  refine: ['refine', 'commit'], // Can loop back to itself or proceed to commit
  commit: [], // Terminal phase - no transitions out
};

/**
 * Phase transition order for sequential execution
 */
const PHASE_ORDER: TddPhase[] = [
  'red',
  'research',
  'green',
  'integrate',
  'refine',
  'commit',
];

/**
 * Project context passed to the orchestrator
 */
export interface ProjectContext {
  /** Project root path */
  path: string;
  /** Project name */
  name: string;
  /** Branch name for PR */
  branchName?: string;
}

/**
 * Task context passed to the orchestrator
 */
export interface TaskContext {
  /** User story being implemented */
  userStory: UserStory;
  /** PRD content as JSON */
  prdJson: string;
  /** Execution ID (created if not provided) */
  executionId?: string;
}

/**
 * Phase failure information
 */
export interface PhaseFailure {
  executionId: string;
  phase: TddPhase;
  error: string;
  failedAt: string;
  recoverable: boolean;
}

/**
 * Phase Orchestrator - Manages autonomous TDD workflow execution
 */
export class PhaseOrchestrator extends EventEmitter {
  private config: AutonomousTddConfig;
  private currentExecutionId: string | null = null;
  private refineIterationCount = 0;
  private checkpoint: Checkpoint | null = null;

  // Phase results stored during execution
  private testFiles: string[] = [];
  private frozenContracts: FrozenContracts | null = null;
  private bugs: Bug[] = [];
  private currentRefinePhaseId: string | null = null;

  constructor(config?: Partial<AutonomousTddConfig>) {
    super();
    this.config = {
      ...DEFAULT_TDD_CONFIG,
      ...config,
      timeouts: {
        ...DEFAULT_TDD_CONFIG.timeouts,
        ...config?.timeouts,
      },
    };
  }

  /**
   * Run the full autonomous TDD workflow
   *
   * Executes all six phases in sequence:
   * RED -> RESEARCH -> GREEN -> INTEGRATE -> REFINE -> COMMIT
   *
   * The REFINE phase loops until P0/P1 bugs are resolved (up to maxRefineIterations).
   * On the final iteration, escalates to opus model for difficult bugs.
   *
   * @param task - Task context with user story and PRD
   * @param project - Project context with path and name
   * @returns TDD result with success status and PR receipt
   */
  async runAutonomous(
    task: TaskContext,
    project: ProjectContext
  ): Promise<TddResult> {
    const startTime = Date.now();
    const executionId = task.executionId ?? uuidv4();
    this.currentExecutionId = executionId;
    this.refineIterationCount = 0;

    // Reset state
    this.testFiles = [];
    this.frozenContracts = null;
    this.bugs = [];
    this.currentRefinePhaseId = null;

    const phases: TddPhaseRecord[] = [];

    // Create project object for Rollback
    const projectForRollback = {
      id: executionId,
      name: project.name,
      path: project.path,
      group_id: null,
      deploy_config: null,
      added_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      // Create checkpoint before starting
      this.checkpoint = await Rollback.createCheckpoint(
        projectForRollback,
        `TDD workflow start for ${task.userStory.title}`
      );

      // Execute phases: RED, RESEARCH, GREEN, INTEGRATE
      for (const phase of ['red', 'research', 'green', 'integrate'] as TddPhase[]) {
        const phaseRecord = await this.executePhase(phase, task, project, executionId, phases);
        if (!phaseRecord) {
          throw new Error(`Phase ${phase} failed to create record`);
        }
      }

      // Execute REFINE phase with loop
      await this.executeRefinePhaseWithLoop(task, project, executionId, phases);

      // Execute COMMIT phase
      await this.executePhase('commit', task, project, executionId, phases);

      // Build receipt
      const receipt = ReceiptBuilder.build(executionId);

      // All phases completed successfully
      return {
        success: true,
        executionId,
        phases,
        receipt,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      // Rollback to checkpoint on failure
      if (this.checkpoint) {
        await Rollback.rollbackToCheckpoint(projectForRollback, this.checkpoint);
      }

      return {
        success: false,
        executionId,
        phases,
        error: error instanceof Error ? error.message : String(error),
        totalDurationMs: Date.now() - startTime,
      };
    } finally {
      this.currentExecutionId = null;
      this.checkpoint = null;
    }
  }

  /**
   * Execute a single phase
   */
  private async executePhase(
    phase: TddPhase,
    task: TaskContext,
    project: ProjectContext,
    executionId: string,
    phases: TddPhaseRecord[]
  ): Promise<TddPhaseRecord> {
    // Create phase record
    const phaseRecord = PhaseRepository.create({
      executionId,
      phase,
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    phases.push(phaseRecord);

    // Emit phase started event
    this.emitPhaseStarted(executionId, phase);

    try {
      // Execute actual phase logic
      const metrics = await this.executePhaseLogic(phase, task, project, phaseRecord.id);

      // Update phase as completed
      const completedAt = new Date().toISOString();
      PhaseRepository.update(phaseRecord.id, {
        status: 'completed',
        completedAt,
        metrics,
      });

      // Emit phase completed event
      this.emitPhaseCompleted(executionId, phase, metrics);

      return phaseRecord;
    } catch (phaseError) {
      // Update phase as failed
      PhaseRepository.update(phaseRecord.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
      });

      // Handle phase failure
      const errorMessage = phaseError instanceof Error ? phaseError.message : String(phaseError);
      await this.handlePhaseFailure(executionId, phase, errorMessage);

      throw phaseError;
    }
  }

  /**
   * Execute the actual phase logic
   */
  private async executePhaseLogic(
    phase: TddPhase,
    task: TaskContext,
    project: ProjectContext,
    phaseId: string
  ): Promise<Record<string, unknown>> {
    const projectContext = {
      path: project.path,
      name: project.name,
    };

    switch (phase) {
      case 'red': {
        // RED Phase: Generate tests
        const testGeneratorProject = {
          ...projectContext,
          testFramework: this.detectTestFramework(project.path),
          srcDir: 'src',
          testLocation: '__tests__' as const,
        };

        const testResult = await TestGenerator.generate(
          { userStory: task.userStory, prdJson: task.prdJson },
          testGeneratorProject,
          phaseId,
          {}
        );

        if (!testResult.success) {
          throw new Error(`RED phase failed: ${testResult.error}`);
        }

        // Store test files for GREEN phase (derive from generated tests)
        this.testFiles = testResult.tests.map((t) => t.filePath);

        return {
          testFilesGenerated: this.testFiles.length,
          testFiles: this.testFiles,
          metrics: testResult.metrics,
        };
      }

      case 'research': {
        // RESEARCH Phase: Analyze patterns and freeze contracts
        const researchContext = {
          userStory: task.userStory,
          prdJson: task.prdJson,
          projectPath: project.path,
          projectName: project.name,
        };

        const researchResult = await ResearchCoordinator.runParallel(
          undefined, // Use all agent types
          researchContext,
          phaseId,
          {}
        );

        if (!researchResult.success) {
          throw new Error(`RESEARCH phase failed: ${researchResult.error}`);
        }

        // Store frozen contracts for GREEN and INTEGRATE phases
        this.frozenContracts = researchResult.frozenContracts;

        return {
          frozenContracts: this.frozenContracts,
          patternsDiscovered: researchResult.metrics.patternsDiscovered,
          agentsSucceeded: researchResult.metrics.agentsSucceeded,
          agentsFailed: researchResult.metrics.agentsFailed,
        };
      }

      case 'green': {
        // GREEN Phase: Implement until tests pass
        if (!this.frozenContracts) {
          throw new Error('GREEN phase requires frozen contracts from RESEARCH phase');
        }

        const greenResult = await GreenPhase.run(
          {
            userStory: task.userStory,
            prdJson: task.prdJson,
            testFiles: this.testFiles,
          },
          {
            ...projectContext,
            testFramework: this.detectTestFramework(project.path),
          },
          this.frozenContracts,
          {
            maxGreenRetries: this.config.maxGreenRetries,
            executionTimeoutMs: this.config.timeouts.green,
          }
        );

        if (!greenResult.success) {
          throw new Error(`GREEN phase failed after ${greenResult.attempts} attempts: ${greenResult.error}`);
        }

        return {
          attempts: greenResult.attempts,
          testsPassed: greenResult.testResults?.passed ?? false,
          metrics: greenResult.metrics,
        };
      }

      case 'integrate': {
        // INTEGRATE Phase: Validate contracts across layers
        if (!this.frozenContracts) {
          throw new Error('INTEGRATE phase requires frozen contracts from RESEARCH phase');
        }

        const validationResult = await ContractValidator.validate(
          this.frozenContracts,
          projectContext,
          {}
        );

        if (!validationResult.passed) {
          throw new Error(
            `INTEGRATE phase failed: ${validationResult.errors.map((e) => e.message).join(', ')}`
          );
        }

        return {
          contractsValidated: validationResult.totalContractsValidated,
          contractsFailed: validationResult.totalContractsFailed,
          layersChecked: validationResult.layerResults.map((r) => r.layer),
          errors: validationResult.errors.map((e) => e.message),
        };
      }

      case 'refine': {
        // REFINE Phase: AI code review and bug fixing
        // This is called from the loop handler, so just return metrics
        return this.executeRefineIteration(task, project, phaseId);
      }

      case 'commit': {
        // COMMIT Phase: Build receipts and create PR
        const receipt = ReceiptBuilder.build(this.currentExecutionId!);

        // Create PR with receipts
        const prResult = await ReceiptBuilder.createPr(
          {
            storyId: task.userStory.id,
            title: task.userStory.title,
            description: task.userStory.description,
          },
          receipt,
          {
            path: project.path,
            baseBranch: 'main',
          }
        );

        return {
          prCreated: prResult.success,
          prUrl: prResult.prUrl,
          prTitle: prResult.title,
          error: prResult.error,
        };
      }

      default:
        throw new Error(`Unknown phase: ${phase}`);
    }
  }

  /**
   * Execute a single REFINE iteration (AI review + auto-fix)
   */
  private async executeRefineIteration(
    task: TaskContext,
    project: ProjectContext,
    phaseId: string
  ): Promise<Record<string, unknown>> {
    const projectContext = {
      path: project.path,
      name: project.name,
    };

    // Load code changes for review
    const codeChanges = await BugClassifier.loadCodeChangesFromGit(projectContext);

    // Perform AI code review
    const isFinalIteration = this.refineIterationCount >= this.config.maxRefineIterations - 1;
    const reviewResult = await BugClassifier.aiReview(
      projectContext,
      codeChanges,
      phaseId,
      {}
    );

    if (!reviewResult.success) {
      throw new Error(`REFINE AI review failed: ${reviewResult.error}`);
    }

    // Update bugs list
    this.bugs = reviewResult.bugs;
    this.currentRefinePhaseId = phaseId;

    // If there are P0/P1 bugs, attempt auto-fix
    const hasP0P1Bugs = this.bugs.some(
      (bug) => bug.status === 'open' && (bug.severity === 'P0' || bug.severity === 'P1')
    );

    let autoFixResult: AutoFixResult | null = null;
    if (hasP0P1Bugs) {
      autoFixResult = await BugClassifier.autoFix(this.bugs, projectContext, {
        isFinalIteration,
      });

      // Update bugs with fixed status
      this.bugs = autoFixResult.bugs;
    }

    return {
      totalBugsFound: reviewResult.metrics.totalBugsFound,
      p0Count: reviewResult.metrics.p0Count,
      p1Count: reviewResult.metrics.p1Count,
      p2Count: reviewResult.metrics.p2Count,
      p3Count: reviewResult.metrics.p3Count,
      bugsFixed: autoFixResult?.metrics.p0Fixed ?? 0 + (autoFixResult?.metrics.p1Fixed ?? 0),
      refineIteration: this.refineIterationCount + 1,
      opusEscalationUsed: isFinalIteration,
    };
  }

  /**
   * Execute the REFINE phase with loop until P0/P1 bugs are resolved
   */
  private async executeRefinePhaseWithLoop(
    task: TaskContext,
    project: ProjectContext,
    executionId: string,
    phases: TddPhaseRecord[]
  ): Promise<void> {
    this.refineIterationCount = 0;

    do {
      // Execute REFINE phase iteration
      await this.executePhase('refine', task, project, executionId, phases);
      this.refineIterationCount++;

      // Check if we can exit the loop
      if (this.currentRefinePhaseId) {
        const canExit = BugRepository.canExitRefineLoop(this.currentRefinePhaseId);
        if (canExit) {
          break;
        }
      }
    } while (this.refineIterationCount < this.config.maxRefineIterations);
  }

  /**
   * Detect test framework from project
   */
  private detectTestFramework(projectPath: string): TestFramework {
    return GreenPhase.detectTestFramework(projectPath);
  }

  /**
   * Transition to a new phase
   *
   * @param executionId - Execution ID
   * @param targetPhase - Phase to transition to
   * @returns The new phase record, or null if transition is invalid
   */
  transitionToPhase(
    executionId: string,
    targetPhase: TddPhase
  ): TddPhaseRecord | null {
    // Get current phase
    const currentPhase = PhaseRepository.getCurrentPhase(executionId);
    const currentPhaseName = currentPhase?.phase ?? 'start';

    // Validate transition
    if (!this.canTransition(executionId, targetPhase)) {
      return null;
    }

    // If there's a current running phase, mark it as completed
    if (currentPhase && currentPhase.status === 'running') {
      PhaseRepository.update(currentPhase.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
    }

    // Create new phase record
    const newPhase = PhaseRepository.create({
      executionId,
      phase: targetPhase,
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    // Emit phase started event
    this.emitPhaseStarted(executionId, targetPhase);

    return newPhase;
  }

  /**
   * Check if a transition to the target phase is valid
   *
   * @param executionId - Execution ID
   * @param targetPhase - Phase to transition to
   * @returns True if transition is valid
   */
  canTransition(executionId: string, targetPhase: TddPhase): boolean {
    const currentPhase = PhaseRepository.getCurrentPhase(executionId);
    const currentPhaseName: TddPhase | 'start' = currentPhase?.phase ?? 'start';

    // Get valid transitions from current phase
    const validTargets = VALID_TRANSITIONS[currentPhaseName];
    return validTargets.includes(targetPhase);
  }

  /**
   * Handle a phase failure
   *
   * @param executionId - Execution ID
   * @param phase - Phase that failed
   * @param error - Error message
   */
  async handlePhaseFailure(
    executionId: string,
    phase: TddPhase,
    error: string
  ): Promise<void> {
    // Emit phase failed event
    this.emitPhaseFailed(executionId, phase, error);

    // Log the failure
    console.error(`Phase ${phase} failed for execution ${executionId}: ${error}`);

    // Note: Rollback is handled in the main runAutonomous catch block
  }

  /**
   * Get the current configuration
   */
  getConfig(): AutonomousTddConfig {
    return { ...this.config };
  }

  /**
   * Get the current execution ID (if running)
   */
  getCurrentExecutionId(): string | null {
    return this.currentExecutionId;
  }

  /**
   * Get the current REFINE iteration count
   */
  getRefineIterationCount(): number {
    return this.refineIterationCount;
  }

  // ============ Private Event Emitters ============

  /**
   * Emit phase:started event
   */
  private emitPhaseStarted(executionId: string, phase: TddPhase): void {
    const event: PhaseOrchestratorEvents['phase:started'] = {
      executionId,
      phase,
      startedAt: new Date().toISOString(),
    };
    this.emit('phase:started', event);
  }

  /**
   * Emit phase:completed event
   */
  private emitPhaseCompleted(
    executionId: string,
    phase: TddPhase,
    metrics: Record<string, unknown>
  ): void {
    const event: PhaseOrchestratorEvents['phase:completed'] = {
      executionId,
      phase,
      completedAt: new Date().toISOString(),
      metrics,
    };
    this.emit('phase:completed', event);
  }

  /**
   * Emit phase:failed event
   */
  private emitPhaseFailed(
    executionId: string,
    phase: TddPhase,
    error: string
  ): void {
    const event: PhaseOrchestratorEvents['phase:failed'] = {
      executionId,
      phase,
      error,
      failedAt: new Date().toISOString(),
    };
    this.emit('phase:failed', event);
  }
}
