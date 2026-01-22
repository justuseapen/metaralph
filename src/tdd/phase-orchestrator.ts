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
  DEFAULT_TDD_CONFIG,
} from './types.js';
import { PhaseRepository } from './repositories/index.js';
import { type UserStory } from '../collaboration/prd-builder.js';

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
   * This is a stub implementation that will be wired up with phase executors later.
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

    const phases: TddPhaseRecord[] = [];

    try {
      // TODO: Create checkpoint before starting (Rollback.createCheckpoint)

      // Execute each phase in order
      for (const phase of PHASE_ORDER) {
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
          // TODO: Execute actual phase logic
          // For now, this is a stub that just marks the phase as completed
          await this.executePhaseStub(phase, task, project);

          // Handle REFINE phase loop
          if (phase === 'refine') {
            // Check if we need to loop (P0/P1 bugs exist)
            const shouldLoop = await this.shouldRefineLoop(executionId);
            if (shouldLoop && this.refineIterationCount < this.config.maxRefineIterations) {
              this.refineIterationCount++;
              // Note: In full implementation, this would re-execute refine phase
            }
          }

          // Update phase as completed
          const completedAt = new Date().toISOString();
          PhaseRepository.update(phaseRecord.id, {
            status: 'completed',
            completedAt,
            metrics: { iterationCount: phase === 'refine' ? this.refineIterationCount : undefined },
          });

          // Emit phase completed event
          this.emitPhaseCompleted(executionId, phase, {});
        } catch (phaseError) {
          // Update phase as failed
          PhaseRepository.update(phaseRecord.id, {
            status: 'failed',
            completedAt: new Date().toISOString(),
          });

          // Handle phase failure
          const failure: PhaseFailure = {
            executionId,
            phase,
            error: phaseError instanceof Error ? phaseError.message : String(phaseError),
            failedAt: new Date().toISOString(),
            recoverable: false,
          };
          await this.handlePhaseFailure(executionId, phase, failure.error);

          throw phaseError;
        }
      }

      // All phases completed successfully
      return {
        success: true,
        executionId,
        phases,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      // TODO: Rollback to checkpoint on failure
      return {
        success: false,
        executionId,
        phases,
        error: error instanceof Error ? error.message : String(error),
        totalDurationMs: Date.now() - startTime,
      };
    } finally {
      this.currentExecutionId = null;
    }
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

    // TODO: Trigger rollback to checkpoint
    // For now, just log the failure
    console.error(`Phase ${phase} failed for execution ${executionId}: ${error}`);
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

  // ============ Private Methods ============

  /**
   * Stub implementation for phase execution
   * Will be replaced with actual phase logic in later stories
   */
  private async executePhaseStub(
    phase: TddPhase,
    _task: TaskContext,
    _project: ProjectContext
  ): Promise<void> {
    // Simulate async phase execution
    // In real implementation, this would call the actual phase executor
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  /**
   * Check if the REFINE phase should loop again
   * Will be replaced with actual bug checking logic
   */
  private async shouldRefineLoop(_executionId: string): Promise<boolean> {
    // TODO: Check if P0/P1 bugs exist via BugRepository.canExitRefineLoop()
    // For now, return false (no loop needed)
    return false;
  }

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
