/**
 * Self-Improvement Engine - Coordinates the self-improvement loop
 *
 * This module orchestrates the entire self-improvement process including:
 * - Analyzing Ralph/MetaRalph for improvement opportunities
 * - Proposing changes with proper risk assessment
 * - Executing approved changes safely
 * - Validating and merging/rolling back as needed
 */

import { type Project } from '../registry/index.js';
import { type Task, TaskRepository, type CreateTaskInput, type TaskSource } from '../queue/task.js';
import { initDatabase, type DatabaseInstance } from '../db/index.js';
import { RalphAnalyzer, type SelfImprovementOpportunity } from './ralph-analyzer.js';
import {
  registerSelfProjects,
  getRegisteredSelfProjects,
  isSelfProject,
  type SelfRegistrationResult,
} from './self-registration.js';
import { SafeExecutor, type SafeExecutionResult, type SafeExecutionOptions } from './safe-executor.js';
import { Rollback, type Checkpoint } from './rollback.js';
import { Guardrails, type RiskAssessment, type RiskLevel } from './guardrails.js';
import { calculatePriorityScore, categorizeTask } from '../queue/prioritizer.js';

/**
 * Result of the self-improvement analysis phase
 */
export interface AnalysisResult {
  success: boolean;
  project: Project;
  opportunities: SelfImprovementOpportunity[];
  summary: Record<string, number>;
  byRisk: Record<RiskLevel, SelfImprovementOpportunity[]>;
  safeToAutoExecute: SelfImprovementOpportunity[];
  requiresApproval: SelfImprovementOpportunity[];
}

/**
 * Result of the self-improvement proposal phase
 */
export interface ProposalResult {
  success: boolean;
  project: Project;
  proposals: Array<{
    opportunity: SelfImprovementOpportunity;
    task?: Task;
    riskAssessment: RiskAssessment;
    autoApproved: boolean;
  }>;
  tasksCreated: number;
  tasksAutoApproved: number;
  tasksPendingApproval: number;
}

/**
 * Result of the self-improvement execution phase
 */
export interface ExecutionResult {
  success: boolean;
  project: Project;
  execution?: SafeExecutionResult;
  task?: Task;
  merged: boolean;
  rolledBack: boolean;
  error?: string;
}

/**
 * Result of a full self-improvement run
 */
export interface SelfImprovementRunResult {
  success: boolean;
  project: Project;
  analysis: AnalysisResult;
  proposals?: ProposalResult;
  executions: ExecutionResult[];
  summary: {
    opportunitiesFound: number;
    proposalsGenerated: number;
    tasksExecuted: number;
    tasksSucceeded: number;
    tasksFailed: number;
    tasksRolledBack: number;
  };
}

/**
 * Options for running self-improvement
 */
export interface SelfImprovementOptions {
  /** Only analyze and propose, don't execute */
  dryRun?: boolean;
  /** Execute only auto-approved (low-risk) changes */
  autoOnly?: boolean;
  /** Maximum number of changes to execute in one run */
  maxExecutions?: number;
  /** Whether to auto-merge successful changes */
  autoMerge?: boolean;
  /** Run tests after execution */
  runTests?: boolean;
  /** Run typecheck after execution */
  runTypecheck?: boolean;
  /** Optional database instance */
  db?: DatabaseInstance;
}

/**
 * SelfImprovementEngine - Coordinates the self-improvement loop
 */
export const SelfImprovementEngine = {
  /**
   * Analyze a self-managed project for improvement opportunities
   *
   * @param project - The project to analyze
   * @returns Analysis result with opportunities categorized by risk
   */
  async analyze(project: Project): Promise<AnalysisResult> {
    // Get opportunities from RalphAnalyzer
    const opportunities = await RalphAnalyzer.analyze(project.path);
    const summary = RalphAnalyzer.getSummary(opportunities);

    // Categorize by risk
    const byRisk = Guardrails.categorizeByRisk(opportunities, project.path);

    // Separate auto-executable from approval-required
    const safeToAutoExecute = Guardrails.filterSafeOpportunities(opportunities, project.path);
    const requiresApproval = opportunities.filter(
      (opp) => !safeToAutoExecute.includes(opp)
    );

    return {
      success: true,
      project,
      opportunities,
      summary,
      byRisk,
      safeToAutoExecute,
      requiresApproval,
    };
  },

  /**
   * Generate task proposals from improvement opportunities
   *
   * @param project - The project to propose for
   * @param opportunities - Opportunities to convert to proposals
   * @param db - Optional database instance
   * @returns Proposal result with tasks created
   */
  async propose(
    project: Project,
    opportunities: SelfImprovementOpportunity[],
    db?: DatabaseInstance
  ): Promise<ProposalResult> {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    const proposals: ProposalResult['proposals'] = [];
    let tasksCreated = 0;
    let tasksAutoApproved = 0;
    let tasksPendingApproval = 0;

    try {
      for (const opportunity of opportunities) {
        // Assess risk
        const riskAssessment = Guardrails.assessOpportunityRisk(opportunity, project.path);

        // Generate PRD JSON for the task
        const prdJson = this.generatePrdJson(project, opportunity);

        // Create task input
        const taskInput: CreateTaskInput = {
          projectId: project.id,
          type: opportunity.suggestedTaskType || 'refactor',
          title: opportunity.title,
          source: 'self_improvement' as TaskSource,
          estimatedEffort: opportunity.suggestedEffort || 'small',
          prdJson: JSON.stringify(prdJson),
          description: opportunity.description,
        };

        // Create task using repository (it calculates priority internally)
        const task = TaskRepository.create(taskInput, database);

        // Auto-approve low-risk tasks
        const autoApproved = !riskAssessment.requiresApproval && riskAssessment.level === 'low';
        if (autoApproved) {
          TaskRepository.updateApprovalStatus(task.id, 'approved', database);
          TaskRepository.updateStatus(task.id, 'queued', database);
          tasksAutoApproved++;
        } else {
          tasksPendingApproval++;
        }

        tasksCreated++;

        proposals.push({
          opportunity,
          task,
          riskAssessment,
          autoApproved,
        });
      }

      return {
        success: true,
        project,
        proposals,
        tasksCreated,
        tasksAutoApproved,
        tasksPendingApproval,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Generate PRD JSON for a self-improvement opportunity
   *
   * @param project - The project
   * @param opportunity - The opportunity to convert
   * @returns PRD JSON structure
   */
  generatePrdJson(
    project: Project,
    opportunity: SelfImprovementOpportunity
  ): {
    project: string;
    branchName: string;
    description: string;
    userStories: Array<{
      id: string;
      title: string;
      description: string;
      acceptanceCriteria: string[];
      priority: number;
      passes: boolean;
      notes: string;
    }>;
  } {
    const timestamp = Date.now();

    return {
      project: project.name,
      branchName: `self-improve/${opportunity.category}-${timestamp}`,
      description: opportunity.description,
      userStories: [
        {
          id: `SI-${timestamp}`,
          title: opportunity.title,
          description: opportunity.description,
          acceptanceCriteria: this.generateAcceptanceCriteria(opportunity),
          priority: 1,
          passes: false,
          notes: opportunity.file ? `Target file: ${opportunity.file}` : '',
        },
      ],
    };
  },

  /**
   * Generate acceptance criteria for an opportunity
   *
   * @param opportunity - The opportunity
   * @returns Array of acceptance criteria strings
   */
  generateAcceptanceCriteria(opportunity: SelfImprovementOpportunity): string[] {
    const criteria: string[] = [];

    switch (opportunity.category) {
      case 'test':
        criteria.push(
          opportunity.file
            ? `Test file exists for ${opportunity.file}`
            : 'Test files created for target modules'
        );
        criteria.push('All new tests pass');
        criteria.push('Code coverage increased or maintained');
        break;

      case 'documentation':
        criteria.push(
          opportunity.file
            ? `JSDoc added to ${opportunity.file}`
            : 'JSDoc documentation added to target functions/classes'
        );
        criteria.push('Documentation follows existing style');
        break;

      case 'optimization':
        criteria.push('Performance improvement verified');
        criteria.push('No regression in functionality');
        criteria.push('Existing tests continue to pass');
        break;

      case 'refactor':
        criteria.push('Code structure improved as described');
        criteria.push('All existing functionality preserved');
        criteria.push('Existing tests continue to pass');
        break;

      case 'feature':
        criteria.push('Feature implemented as described');
        criteria.push('Tests added for new functionality');
        break;

      default:
        criteria.push('Change implemented as described');
    }

    // Always require typecheck
    criteria.push('Typecheck passes');

    return criteria;
  },

  /**
   * Execute approved self-improvement tasks
   *
   * @param project - The project
   * @param tasks - Tasks to execute
   * @param options - Execution options
   * @returns Array of execution results
   */
  async executeApproved(
    project: Project,
    tasks: Task[],
    options: SelfImprovementOptions = {}
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    const maxExecutions = options.maxExecutions ?? 1;

    for (let i = 0; i < Math.min(tasks.length, maxExecutions); i++) {
      const task = tasks[i];

      // Validate change is safe
      const validation = Guardrails.validateChange(
        task,
        project.path,
        task.approvalStatus === 'approved'
      );

      if (!validation.allowed) {
        results.push({
          success: false,
          project,
          task,
          merged: false,
          rolledBack: false,
          error: validation.reason,
        });
        continue;
      }

      // Execute the task
      const execOptions: SafeExecutionOptions = {
        featureName: task.title.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30),
        runTests: options.runTests ?? true,
        runTypecheck: options.runTypecheck ?? true,
        autoMerge: options.autoMerge ?? false,
        maxIterations: 10,
      };

      const execution = await SafeExecutor.execute(task, project, execOptions, options.db);

      const result: ExecutionResult = {
        success: execution.success,
        project,
        execution,
        task,
        merged: false,
        rolledBack: execution.wasRolledBack,
        error: execution.error,
      };

      // Merge if successful and auto-merge is enabled
      if (execution.success && options.autoMerge) {
        const mergeResult = await SafeExecutor.mergeBranch(project, execution.branchName);
        result.merged = mergeResult.success;

        if (mergeResult.success) {
          // Clean up the branch
          await SafeExecutor.cleanupBranch(project, execution.branchName, true);
        }
      }

      results.push(result);
    }

    return results;
  },

  /**
   * Run the complete self-improvement loop
   *
   * Pipeline: analyze -> propose -> approve -> execute -> validate -> merge/rollback
   *
   * @param project - The project to improve
   * @param options - Options for the run
   * @returns Complete run result
   */
  async run(project: Project, options: SelfImprovementOptions = {}): Promise<SelfImprovementRunResult> {
    const shouldCloseDb = !options.db;
    const database = options.db ?? initDatabase();

    try {
      // Step 1: Analyze
      const analysis = await this.analyze(project);

      const result: SelfImprovementRunResult = {
        success: true,
        project,
        analysis,
        executions: [],
        summary: {
          opportunitiesFound: analysis.opportunities.length,
          proposalsGenerated: 0,
          tasksExecuted: 0,
          tasksSucceeded: 0,
          tasksFailed: 0,
          tasksRolledBack: 0,
        },
      };

      // If no opportunities, we're done
      if (analysis.opportunities.length === 0) {
        return result;
      }

      // Step 2: Propose (filter to safe opportunities if autoOnly)
      const opportunitiesToPropose = options.autoOnly
        ? analysis.safeToAutoExecute
        : analysis.opportunities;

      const proposals = await this.propose(project, opportunitiesToPropose, database);
      result.proposals = proposals;
      result.summary.proposalsGenerated = proposals.tasksCreated;

      // If dry run, stop here
      if (options.dryRun) {
        return result;
      }

      // Step 3: Get approved tasks to execute
      const approvedTasks = proposals.proposals
        .filter((p) => p.autoApproved && p.task)
        .map((p) => p.task!)
        .slice(0, options.maxExecutions ?? 1);

      if (approvedTasks.length === 0) {
        // No auto-approved tasks to execute
        return result;
      }

      // Step 4: Execute approved tasks
      const executions = await this.executeApproved(project, approvedTasks, {
        ...options,
        db: database,
      });

      result.executions = executions;
      result.summary.tasksExecuted = executions.length;
      result.summary.tasksSucceeded = executions.filter((e) => e.success).length;
      result.summary.tasksFailed = executions.filter((e) => !e.success).length;
      result.summary.tasksRolledBack = executions.filter((e) => e.rolledBack).length;

      // Overall success if at least one task succeeded or in dry-run mode
      result.success = result.summary.tasksSucceeded > 0 || Boolean(options.dryRun);

      return result;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Run self-improvement on all registered self-managed projects
   *
   * @param options - Options for the run
   * @returns Array of run results, one per project
   */
  async runAll(options: SelfImprovementOptions = {}): Promise<SelfImprovementRunResult[]> {
    const shouldCloseDb = !options.db;
    const database = options.db ?? initDatabase();

    const results: SelfImprovementRunResult[] = [];

    try {
      const selfProjects = getRegisteredSelfProjects(database);

      for (const project of selfProjects) {
        const result = await this.run(project, { ...options, db: database });
        results.push(result);
      }

      return results;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Preview what self-improvement would do without making changes
   *
   * @param project - The project to preview
   * @param db - Optional database instance
   * @returns Analysis and proposal preview
   */
  async preview(
    project: Project,
    db?: DatabaseInstance
  ): Promise<{
    analysis: AnalysisResult;
    proposalPreview: Array<{
      opportunity: SelfImprovementOpportunity;
      riskAssessment: RiskAssessment;
      wouldAutoApprove: boolean;
    }>;
  }> {
    const analysis = await this.analyze(project);

    const proposalPreview = analysis.opportunities.map((opportunity) => {
      const riskAssessment = Guardrails.assessOpportunityRisk(opportunity, project.path);
      const wouldAutoApprove = !riskAssessment.requiresApproval && riskAssessment.level === 'low';

      return {
        opportunity,
        riskAssessment,
        wouldAutoApprove,
      };
    });

    return {
      analysis,
      proposalPreview,
    };
  },
};

// Re-export types and functions from submodules
export {
  RalphAnalyzer,
  type SelfImprovementOpportunity,
  registerSelfProjects,
  getRegisteredSelfProjects,
  isSelfProject,
  type SelfRegistrationResult,
  SafeExecutor,
  type SafeExecutionResult,
  type SafeExecutionOptions,
  Rollback,
  type Checkpoint,
  Guardrails,
  type RiskAssessment,
  type RiskLevel,
};
