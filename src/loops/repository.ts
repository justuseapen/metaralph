/**
 * Loop Repository - Database operations for Ralph loops
 *
 * Provides CRUD operations for loops and loop iterations.
 */

import { v4 as uuidv4 } from 'uuid';
import { initDatabase, type DatabaseInstance } from '../db/index.js';

/**
 * Status of a Ralph loop
 */
export type LoopStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';

/**
 * Status of a loop iteration
 */
export type IterationStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Represents a Ralph loop
 */
export interface Loop {
  id: string;
  projectId: string;
  branchName: string;
  prdPath: string;
  status: LoopStatus;
  maxIterations: number;
  currentIteration: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/**
 * Represents an iteration within a loop
 */
export interface LoopIteration {
  id: string;
  loopId: string;
  iterationNumber: number;
  storyId: string | null;
  status: IterationStatus;
  output: string | null;
  commitSha: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * Database row for loops table (snake_case)
 */
interface LoopRow {
  id: string;
  project_id: string;
  branch_name: string;
  prd_path: string;
  status: string;
  max_iterations: number;
  current_iteration: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

/**
 * Database row for loop_iterations table (snake_case)
 */
interface LoopIterationRow {
  id: string;
  loop_id: string;
  iteration_number: number;
  story_id: string | null;
  status: string;
  output: string | null;
  commit_sha: string | null;
  started_at: string | null;
  completed_at: string | null;
}

/**
 * Input for creating a new loop
 */
export interface CreateLoopInput {
  projectId: string;
  branchName: string;
  prdPath: string;
  maxIterations?: number;
}

/**
 * Convert database row to Loop interface
 */
function rowToLoop(row: LoopRow): Loop {
  return {
    id: row.id,
    projectId: row.project_id,
    branchName: row.branch_name,
    prdPath: row.prd_path,
    status: row.status as LoopStatus,
    maxIterations: row.max_iterations,
    currentIteration: row.current_iteration,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

/**
 * Convert database row to LoopIteration interface
 */
function rowToIteration(row: LoopIterationRow): LoopIteration {
  return {
    id: row.id,
    loopId: row.loop_id,
    iterationNumber: row.iteration_number,
    storyId: row.story_id,
    status: row.status as IterationStatus,
    output: row.output,
    commitSha: row.commit_sha,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

/**
 * LoopRepository - CRUD operations for loops
 */
export const LoopRepository = {
  /**
   * Create a new loop
   */
  create(input: CreateLoopInput, db?: DatabaseInstance): Loop {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const id = uuidv4();
      const now = new Date().toISOString();

      database.prepare(`
        INSERT INTO loops (
          id, project_id, branch_name, prd_path, status,
          max_iterations, current_iteration, created_at
        )
        VALUES (?, ?, ?, ?, 'pending', ?, 0, ?)
      `).run(
        id,
        input.projectId,
        input.branchName,
        input.prdPath,
        input.maxIterations ?? 10,
        now
      );

      return {
        id,
        projectId: input.projectId,
        branchName: input.branchName,
        prdPath: input.prdPath,
        status: 'pending',
        maxIterations: input.maxIterations ?? 10,
        currentIteration: 0,
        startedAt: null,
        completedAt: null,
        createdAt: now,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find a loop by ID
   */
  findById(id: string, db?: DatabaseInstance): Loop | undefined {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const row = database.prepare('SELECT * FROM loops WHERE id = ?').get(id) as LoopRow | undefined;
      return row ? rowToLoop(row) : undefined;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find all loops, sorted by status (running first) then by created_at DESC
   */
  findAll(db?: DatabaseInstance): Loop[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM loops
        ORDER BY
          CASE status
            WHEN 'running' THEN 0
            WHEN 'paused' THEN 1
            WHEN 'pending' THEN 2
            ELSE 3
          END,
          created_at DESC
      `).all() as LoopRow[];
      return rows.map(rowToLoop);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find loops by project ID
   */
  findByProject(projectId: string, db?: DatabaseInstance): Loop[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM loops
        WHERE project_id = ?
        ORDER BY
          CASE status
            WHEN 'running' THEN 0
            WHEN 'paused' THEN 1
            WHEN 'pending' THEN 2
            ELSE 3
          END,
          created_at DESC
      `).all(projectId) as LoopRow[];
      return rows.map(rowToLoop);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find loops by status
   */
  findByStatus(status: LoopStatus, db?: DatabaseInstance): Loop[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM loops
        WHERE status = ?
        ORDER BY created_at DESC
      `).all(status) as LoopRow[];
      return rows.map(rowToLoop);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Update a loop's status
   */
  updateStatus(id: string, status: LoopStatus, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const now = new Date().toISOString();
      let result;

      if (status === 'running') {
        result = database.prepare(`
          UPDATE loops SET status = ?, started_at = COALESCE(started_at, ?)
          WHERE id = ?
        `).run(status, now, id);
      } else if (status === 'completed' || status === 'failed' || status === 'stopped') {
        result = database.prepare(`
          UPDATE loops SET status = ?, completed_at = ?
          WHERE id = ?
        `).run(status, now, id);
      } else {
        result = database.prepare(`
          UPDATE loops SET status = ?
          WHERE id = ?
        `).run(status, id);
      }

      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Update the current iteration count
   */
  updateCurrentIteration(id: string, iteration: number, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const result = database.prepare(`
        UPDATE loops SET current_iteration = ?
        WHERE id = ?
      `).run(iteration, id);
      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Delete a loop
   */
  delete(id: string, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const result = database.prepare('DELETE FROM loops WHERE id = ?').run(id);
      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },
};

/**
 * LoopIterationRepository - CRUD operations for loop iterations
 */
export const LoopIterationRepository = {
  /**
   * Create a new iteration
   */
  create(loopId: string, iterationNumber: number, db?: DatabaseInstance): LoopIteration {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const id = uuidv4();
      const now = new Date().toISOString();

      database.prepare(`
        INSERT INTO loop_iterations (
          id, loop_id, iteration_number, status, started_at
        )
        VALUES (?, ?, ?, 'running', ?)
      `).run(id, loopId, iterationNumber, now);

      return {
        id,
        loopId,
        iterationNumber,
        storyId: null,
        status: 'running',
        output: null,
        commitSha: null,
        startedAt: now,
        completedAt: null,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find iterations by loop ID
   */
  findByLoop(loopId: string, db?: DatabaseInstance): LoopIteration[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM loop_iterations
        WHERE loop_id = ?
        ORDER BY iteration_number ASC
      `).all(loopId) as LoopIterationRow[];
      return rows.map(rowToIteration);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Update an iteration's status and optionally output/commit
   */
  update(
    id: string,
    updates: {
      status?: IterationStatus;
      storyId?: string;
      output?: string;
      commitSha?: string;
    },
    db?: DatabaseInstance
  ): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const now = new Date().toISOString();
      const parts: string[] = [];
      const values: (string | number)[] = [];

      if (updates.status) {
        parts.push('status = ?');
        values.push(updates.status);
        if (updates.status === 'completed' || updates.status === 'failed') {
          parts.push('completed_at = ?');
          values.push(now);
        }
      }
      if (updates.storyId !== undefined) {
        parts.push('story_id = ?');
        values.push(updates.storyId);
      }
      if (updates.output !== undefined) {
        parts.push('output = ?');
        values.push(updates.output);
      }
      if (updates.commitSha !== undefined) {
        parts.push('commit_sha = ?');
        values.push(updates.commitSha);
      }

      if (parts.length === 0) {
        return false;
      }

      values.push(id);
      const result = database.prepare(`
        UPDATE loop_iterations SET ${parts.join(', ')}
        WHERE id = ?
      `).run(...values);

      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },
};
