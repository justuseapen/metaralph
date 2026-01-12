/**
 * Task Model - Represents work items for Ralph execution
 *
 * Tasks are the atomic units of work that Ralph workers execute.
 * Each task represents a single user story or improvement to be implemented.
 */

import { v4 as uuidv4 } from 'uuid';
import { initDatabase, type DatabaseInstance } from '../db/index.js';

/**
 * Type of work to be performed
 */
export type TaskType = 'bug_fix' | 'test' | 'docs' | 'refactor' | 'feature';

/**
 * Estimated effort level for a task
 */
export type EffortLevel = 'quick_win' | 'small' | 'medium' | 'large';

/**
 * Current status of a task in the queue
 */
export type TaskStatus = 'pending' | 'approved' | 'queued' | 'running' | 'completed' | 'failed';

/**
 * Approval status for tasks that require manual review
 */
export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

/**
 * Source of how the task was created
 */
export type TaskSource = 'manual' | 'onboarding' | 'analysis' | 'conversation' | 'self_improvement';

/**
 * Represents a task in the work queue
 */
export interface Task {
  id: string;
  projectId: string;
  type: TaskType;
  title: string;
  source: TaskSource;
  priorityScore: number;
  estimatedEffort: EffortLevel;
  requiresApproval: boolean;
  approvalStatus: ApprovalStatus;
  status: TaskStatus;
  prdJson: string | null; // JSON string of the PRD for this task
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Database row representation (snake_case)
 */
interface TaskRow {
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
}

/**
 * Input for creating a new task
 */
export interface CreateTaskInput {
  projectId: string;
  type: TaskType;
  title: string;
  source: TaskSource;
  estimatedEffort: EffortLevel;
  description?: string;
  prdJson?: string;
}

/**
 * Convert database row to Task interface
 */
function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type as TaskType,
    title: row.title,
    source: row.source as TaskSource,
    priorityScore: row.priority_score,
    estimatedEffort: row.estimated_effort as EffortLevel,
    requiresApproval: row.requires_approval === 1,
    approvalStatus: row.approval_status as ApprovalStatus,
    status: row.status as TaskStatus,
    prdJson: row.prd_json,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * TaskRepository - CRUD operations for tasks
 */
export const TaskRepository = {
  /**
   * Create a new task in the queue
   * Automatically calculates priority score and determines approval requirements
   */
  create(input: CreateTaskInput, db?: DatabaseInstance): Task {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const { calculatePriorityScore, categorizeTask } = require('./prioritizer.js');

      const id = uuidv4();
      const now = new Date().toISOString();
      const priorityScore = calculatePriorityScore(input.type, input.estimatedEffort);
      const approvalCategory = categorizeTask(input.type, input.estimatedEffort);
      const requiresApproval = approvalCategory === 'needs_approval';
      const approvalStatus: ApprovalStatus = requiresApproval ? 'pending' : 'not_required';
      const status: TaskStatus = requiresApproval ? 'pending' : 'queued';

      database.prepare(`
        INSERT INTO tasks (
          id, project_id, type, title, source, priority_score,
          estimated_effort, requires_approval, approval_status, status,
          prd_json, description, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.projectId,
        input.type,
        input.title,
        input.source,
        priorityScore,
        input.estimatedEffort,
        requiresApproval ? 1 : 0,
        approvalStatus,
        status,
        input.prdJson ?? null,
        input.description ?? null,
        now,
        now
      );

      return {
        id,
        projectId: input.projectId,
        type: input.type,
        title: input.title,
        source: input.source,
        priorityScore,
        estimatedEffort: input.estimatedEffort,
        requiresApproval,
        approvalStatus,
        status,
        prdJson: input.prdJson ?? null,
        description: input.description ?? null,
        createdAt: now,
        updatedAt: now,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find a task by ID
   */
  findById(id: string, db?: DatabaseInstance): Task | undefined {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const row = database.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
      return row ? rowToTask(row) : undefined;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find all pending tasks (awaiting approval or queued for execution)
   */
  findPending(db?: DatabaseInstance): Task[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM tasks
        WHERE status IN ('pending', 'queued')
        ORDER BY priority_score DESC, created_at ASC
      `).all() as TaskRow[];
      return rows.map(rowToTask);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Get next tasks ready for execution (approved or auto-approved, not yet running)
   * Ordered by priority score (highest first)
   *
   * @param limit - Maximum number of tasks to return
   */
  getNextTasks(limit: number = 10, db?: DatabaseInstance): Task[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM tasks
        WHERE status = 'queued'
        AND (approval_status = 'approved' OR approval_status = 'not_required')
        ORDER BY priority_score DESC, created_at ASC
        LIMIT ?
      `).all(limit) as TaskRow[];
      return rows.map(rowToTask);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Update a task's status
   */
  updateStatus(id: string, status: TaskStatus, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const now = new Date().toISOString();
      const result = database.prepare(`
        UPDATE tasks SET status = ?, updated_at = ?
        WHERE id = ?
      `).run(status, now, id);
      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Update a task's approval status
   */
  updateApprovalStatus(id: string, approvalStatus: ApprovalStatus, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const now = new Date().toISOString();
      // If approved, also update status to queued
      const newStatus = approvalStatus === 'approved' ? 'queued' : undefined;

      if (newStatus) {
        database.prepare(`
          UPDATE tasks SET approval_status = ?, status = ?, updated_at = ?
          WHERE id = ?
        `).run(approvalStatus, newStatus, now, id);
      } else {
        database.prepare(`
          UPDATE tasks SET approval_status = ?, updated_at = ?
          WHERE id = ?
        `).run(approvalStatus, now, id);
      }
      return true;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find all tasks for a project
   */
  findByProject(projectId: string, db?: DatabaseInstance): Task[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM tasks
        WHERE project_id = ?
        ORDER BY priority_score DESC, created_at ASC
      `).all(projectId) as TaskRow[];
      return rows.map(rowToTask);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Update a task's PRD JSON
   */
  updatePrdJson(id: string, prdJson: string, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const now = new Date().toISOString();
      const result = database.prepare(`
        UPDATE tasks SET prd_json = ?, updated_at = ?
        WHERE id = ?
      `).run(prdJson, now, id);
      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },
};
