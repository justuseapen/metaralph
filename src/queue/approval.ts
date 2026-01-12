/**
 * Approval Queue - Manages task approval workflow
 *
 * Handles the approval process for tasks that require manual review.
 * Auto-approved tasks (bug_fix, docs, test with quick_win or small effort)
 * bypass this queue and go directly to execution.
 */

import { initDatabase, type DatabaseInstance } from '../db/index.js';
import {
  Task,
  TaskRepository,
  type TaskStatus,
  type ApprovalStatus,
} from './task.js';
import { categorizeTask as categorizePrioritizer } from './prioritizer.js';
import type { TaskType, EffortLevel } from './task.js';

/**
 * Re-export categorizeTask for clarity
 * Returns 'auto' if task can be auto-approved, 'needs_approval' if manual review required
 */
export function categorizeTask(type: TaskType, effort: EffortLevel): 'auto' | 'needs_approval' {
  return categorizePrioritizer(type, effort);
}

/**
 * Result of an approval queue operation
 */
export interface ApprovalResult {
  success: boolean;
  message: string;
  task?: Task;
}

/**
 * ApprovalQueue - Manages task approval workflow
 *
 * Provides methods to:
 * - Submit tasks for approval
 * - Approve pending tasks
 * - Reject pending tasks
 * - Get all pending tasks awaiting approval
 */
export class ApprovalQueue {
  private db?: DatabaseInstance;

  constructor(db?: DatabaseInstance) {
    this.db = db;
  }

  /**
   * Submit a task for approval
   * If the task qualifies for auto-approval, it will be automatically approved
   *
   * @param taskId - ID of the task to submit
   * @returns Result of the submission
   */
  submit(taskId: string): ApprovalResult {
    const shouldCloseDb = !this.db;
    const database = this.db ?? initDatabase();

    try {
      const task = TaskRepository.findById(taskId, database);

      if (!task) {
        return {
          success: false,
          message: `Task not found: ${taskId}`,
        };
      }

      // Check if task requires approval
      const category = categorizeTask(task.type, task.estimatedEffort);

      if (category === 'auto') {
        // Auto-approve the task
        TaskRepository.updateApprovalStatus(taskId, 'not_required', database);
        TaskRepository.updateStatus(taskId, 'queued', database);

        const updatedTask = TaskRepository.findById(taskId, database);
        return {
          success: true,
          message: `Task auto-approved and queued: ${task.title}`,
          task: updatedTask,
        };
      }

      // Task needs manual approval - ensure it's in pending state
      if (task.approvalStatus !== 'pending') {
        TaskRepository.updateApprovalStatus(taskId, 'pending', database);
      }

      const updatedTask = TaskRepository.findById(taskId, database);
      return {
        success: true,
        message: `Task submitted for approval: ${task.title}`,
        task: updatedTask,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  }

  /**
   * Approve a pending task
   *
   * @param taskId - ID of the task to approve
   * @returns Result of the approval
   */
  approve(taskId: string): ApprovalResult {
    const shouldCloseDb = !this.db;
    const database = this.db ?? initDatabase();

    try {
      const task = TaskRepository.findById(taskId, database);

      if (!task) {
        return {
          success: false,
          message: `Task not found: ${taskId}`,
        };
      }

      if (task.approvalStatus !== 'pending') {
        return {
          success: false,
          message: `Task is not pending approval (current status: ${task.approvalStatus})`,
          task,
        };
      }

      // Approve the task and move to queued status
      TaskRepository.updateApprovalStatus(taskId, 'approved', database);

      const updatedTask = TaskRepository.findById(taskId, database);
      return {
        success: true,
        message: `Task approved and queued: ${task.title}`,
        task: updatedTask,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  }

  /**
   * Reject a pending task
   *
   * @param taskId - ID of the task to reject
   * @returns Result of the rejection
   */
  reject(taskId: string): ApprovalResult {
    const shouldCloseDb = !this.db;
    const database = this.db ?? initDatabase();

    try {
      const task = TaskRepository.findById(taskId, database);

      if (!task) {
        return {
          success: false,
          message: `Task not found: ${taskId}`,
        };
      }

      if (task.approvalStatus !== 'pending') {
        return {
          success: false,
          message: `Task is not pending approval (current status: ${task.approvalStatus})`,
          task,
        };
      }

      // Reject the task and mark as failed
      TaskRepository.updateApprovalStatus(taskId, 'rejected', database);
      TaskRepository.updateStatus(taskId, 'failed', database);

      const updatedTask = TaskRepository.findById(taskId, database);
      return {
        success: true,
        message: `Task rejected: ${task.title}`,
        task: updatedTask,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  }

  /**
   * Get all tasks pending approval
   *
   * @returns Array of tasks awaiting approval, ordered by priority
   */
  getPending(): Task[] {
    const shouldCloseDb = !this.db;
    const database = this.db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM tasks
        WHERE approval_status = 'pending'
        AND status = 'pending'
        ORDER BY priority_score DESC, created_at ASC
      `).all() as Array<{
        id: string;
        project_id: string;
        type: string;
        title: string;
        source: string;
        priority_score: number;
        estimated_effort: string;
        requires_approval: number;
        approval_status: string;
        status: string;
        prd_json: string | null;
        description: string | null;
        created_at: string;
        updated_at: string;
      }>;

      return rows.map((row) => ({
        id: row.id,
        projectId: row.project_id,
        type: row.type as Task['type'],
        title: row.title,
        source: row.source as Task['source'],
        priorityScore: row.priority_score,
        estimatedEffort: row.estimated_effort as Task['estimatedEffort'],
        requiresApproval: row.requires_approval === 1,
        approvalStatus: row.approval_status as ApprovalStatus,
        status: row.status as TaskStatus,
        prdJson: row.prd_json,
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  }
}

/**
 * Singleton instance for convenience
 */
let defaultQueue: ApprovalQueue | null = null;

/**
 * Get the default ApprovalQueue instance
 */
export function getApprovalQueue(): ApprovalQueue {
  if (!defaultQueue) {
    defaultQueue = new ApprovalQueue();
  }
  return defaultQueue;
}
