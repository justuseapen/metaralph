/**
 * Proposal Generator - Creates Task objects from improvement opportunities
 *
 * Converts ImprovementOpportunity findings from the analyzer and TODO extractor
 * into Task objects that can be queued for execution.
 */

import { v4 as uuidv4 } from 'uuid';
import type { ImprovementOpportunity } from './analyzer.js';
import type { CreateTaskInput, Task, TaskType, EffortLevel } from '../queue/task.js';
import { TaskRepository } from '../queue/task.js';
import type { DatabaseInstance } from '../db/index.js';

/**
 * A generated proposal for an improvement task
 */
export interface Proposal {
  id: string;
  projectId: string;
  opportunity: ImprovementOpportunity;
  taskInput: CreateTaskInput;
  createdAt: string;
}

/**
 * Result of generating proposals
 */
export interface ProposalGenerationResult {
  proposals: Proposal[];
  tasksCreated: Task[];
  summary: {
    totalOpportunities: number;
    proposalsGenerated: number;
    tasksAutoQueued: number;
    tasksPendingApproval: number;
  };
}

/**
 * Options for proposal generation
 */
export interface ProposalGenerationOptions {
  /** Create tasks immediately (default: true) */
  createTasks?: boolean;
  /** Maximum number of proposals to generate (default: no limit) */
  maxProposals?: number;
  /** Filter by minimum severity (default: all) */
  minSeverity?: 'low' | 'medium' | 'high';
  /** Filter by opportunity type (default: all) */
  types?: ImprovementOpportunity['type'][];
}

/**
 * Generate a task title from an improvement opportunity
 */
function generateTitle(opportunity: ImprovementOpportunity): string {
  // For TODO comments, use the original title which already includes the content
  if (opportunity.type === 'todo_comment') {
    return opportunity.title;
  }

  // For other types, create a descriptive title
  return opportunity.title;
}

/**
 * Generate a task description with context
 */
function generateDescription(opportunity: ImprovementOpportunity): string {
  let description = opportunity.description;

  // Add file location if available
  if (opportunity.file && opportunity.line) {
    description += `\n\nLocation: ${opportunity.file}:${opportunity.line}`;
  } else if (opportunity.file) {
    description += `\n\nFile: ${opportunity.file}`;
  }

  return description;
}

/**
 * Generate a simple PRD JSON for the task
 */
function generatePrdJson(
  projectId: string,
  opportunity: ImprovementOpportunity
): string {
  const prd = {
    project: projectId,
    branchName: `metaralph/${opportunity.type}/${Date.now()}`,
    description: opportunity.description,
    userStories: [
      {
        id: 'US-001',
        title: generateTitle(opportunity),
        description: opportunity.description,
        acceptanceCriteria: generateAcceptanceCriteria(opportunity),
        priority: 1,
        passes: false,
        notes: opportunity.file
          ? `File: ${opportunity.file}${opportunity.line ? `:${opportunity.line}` : ''}`
          : '',
      },
    ],
  };

  return JSON.stringify(prd, null, 2);
}

/**
 * Generate acceptance criteria based on opportunity type
 */
function generateAcceptanceCriteria(opportunity: ImprovementOpportunity): string[] {
  const criteria: string[] = [];

  switch (opportunity.type) {
    case 'outdated_dep':
      criteria.push('Dependency is updated to the specified version');
      criteria.push('All existing tests pass after update');
      criteria.push('No breaking changes introduced');
      criteria.push('Typecheck passes');
      break;

    case 'type_error':
      criteria.push('Type error is fixed');
      criteria.push('No new type errors introduced');
      criteria.push('Typecheck passes');
      break;

    case 'lint_issue':
      criteria.push('Lint issues are resolved');
      criteria.push('No new lint issues introduced');
      criteria.push('Code style follows project conventions');
      criteria.push('Typecheck passes');
      break;

    case 'todo_comment':
      criteria.push('TODO item is addressed or removed');
      criteria.push('Implementation matches the intent of the TODO');
      criteria.push('Typecheck passes');
      break;

    default:
      criteria.push('Issue is resolved');
      criteria.push('Typecheck passes');
  }

  return criteria;
}

/**
 * Filter opportunities based on options
 */
function filterOpportunities(
  opportunities: ImprovementOpportunity[],
  options: ProposalGenerationOptions
): ImprovementOpportunity[] {
  let filtered = [...opportunities];

  // Filter by minimum severity
  if (options.minSeverity) {
    const severityOrder = { low: 0, medium: 1, high: 2 };
    const minLevel = severityOrder[options.minSeverity];
    filtered = filtered.filter(
      (opp) => severityOrder[opp.severity] >= minLevel
    );
  }

  // Filter by types
  if (options.types && options.types.length > 0) {
    const allowedTypes = new Set(options.types);
    filtered = filtered.filter((opp) => allowedTypes.has(opp.type));
  }

  // Limit number of proposals
  if (options.maxProposals && options.maxProposals > 0) {
    filtered = filtered.slice(0, options.maxProposals);
  }

  return filtered;
}

/**
 * ProposalGenerator - Creates Task objects from improvement opportunities
 */
export const ProposalGenerator = {
  /**
   * Generate proposals from improvement opportunities
   *
   * @param projectId - The project ID for the tasks
   * @param opportunities - Array of improvement opportunities
   * @param options - Generation options
   * @param db - Optional database instance
   * @returns Proposal generation result with tasks
   */
  generate(
    projectId: string,
    opportunities: ImprovementOpportunity[],
    options: ProposalGenerationOptions = {},
    db?: DatabaseInstance
  ): ProposalGenerationResult {
    const { createTasks = true } = options;

    // Filter opportunities
    const filtered = filterOpportunities(opportunities, options);

    const proposals: Proposal[] = [];
    const tasksCreated: Task[] = [];
    let tasksAutoQueued = 0;
    let tasksPendingApproval = 0;

    for (const opportunity of filtered) {
      // Create task input
      const taskInput: CreateTaskInput = {
        projectId,
        type: opportunity.suggestedTaskType,
        title: generateTitle(opportunity),
        source: 'onboarding',
        estimatedEffort: opportunity.suggestedEffort,
        description: generateDescription(opportunity),
        prdJson: generatePrdJson(projectId, opportunity),
      };

      // Create proposal record
      const proposal: Proposal = {
        id: uuidv4(),
        projectId,
        opportunity,
        taskInput,
        createdAt: new Date().toISOString(),
      };

      proposals.push(proposal);

      // Create actual task if requested
      if (createTasks) {
        const task = TaskRepository.create(taskInput, db);
        tasksCreated.push(task);

        if (task.requiresApproval) {
          tasksPendingApproval++;
        } else {
          tasksAutoQueued++;
        }
      }
    }

    return {
      proposals,
      tasksCreated,
      summary: {
        totalOpportunities: opportunities.length,
        proposalsGenerated: proposals.length,
        tasksAutoQueued,
        tasksPendingApproval,
      },
    };
  },

  /**
   * Create a single task from an improvement opportunity
   *
   * @param projectId - The project ID
   * @param opportunity - The improvement opportunity
   * @param db - Optional database instance
   * @returns The created task
   */
  createTask(
    projectId: string,
    opportunity: ImprovementOpportunity,
    db?: DatabaseInstance
  ): Task {
    const taskInput: CreateTaskInput = {
      projectId,
      type: opportunity.suggestedTaskType,
      title: generateTitle(opportunity),
      source: 'onboarding',
      estimatedEffort: opportunity.suggestedEffort,
      description: generateDescription(opportunity),
      prdJson: generatePrdJson(projectId, opportunity),
    };

    return TaskRepository.create(taskInput, db);
  },

  /**
   * Preview proposals without creating tasks
   *
   * @param projectId - The project ID
   * @param opportunities - Array of improvement opportunities
   * @param options - Generation options
   * @returns Proposal generation result (no tasks created)
   */
  preview(
    projectId: string,
    opportunities: ImprovementOpportunity[],
    options: ProposalGenerationOptions = {}
  ): ProposalGenerationResult {
    return this.generate(projectId, opportunities, {
      ...options,
      createTasks: false,
    });
  },
};
