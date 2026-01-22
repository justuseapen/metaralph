/**
 * Execution Model - Tracks Ralph worker execution instances
 *
 * Each execution represents a single Ralph instance working on a task.
 * Captures output, status, and iteration counts.
 */

import { v4 as uuidv4 } from 'uuid';
import { initDatabase, type DatabaseInstance } from '../db/index.js';
import type { TddPhase, TddPhaseRecord, AutonomousTddConfig } from '../tdd/types.js';

/**
 * Status of an execution
 */
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Represents a Ralph execution instance
 */
export interface Execution {
  id: string;
  taskId: string;
  pid: number | null;
  status: ExecutionStatus;
  iterationsUsed: number;
  ralphOutput: string | null;
  errorLog: string | null;
  exitCode: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  /**
   * Current TDD phase (if TDD workflow is enabled)
   */
  currentPhase: TddPhase | null;
  /**
   * History of TDD phase executions
   */
  phaseHistory: TddPhaseRecord[] | null;
  /**
   * Whether TDD workflow is enabled for this execution
   */
  tddEnabled: boolean;
  /**
   * Configuration for TDD workflow (if enabled)
   */
  tddConfig: AutonomousTddConfig | null;
}

/**
 * Database row representation (snake_case)
 */
interface ExecutionRow {
  id: string;
  task_id: string;
  project_id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  exit_code: number | null;
  output_log: string | null;
  error_log: string | null;
  created_at: string;
  // TDD fields
  current_phase: string | null;
  phase_history: string | null;
  tdd_enabled: number;
  tdd_config: string | null;
}

/**
 * Input for creating a new execution
 */
export interface CreateExecutionInput {
  taskId: string;
  projectId: string;
  /**
   * Enable TDD workflow for this execution
   */
  tddEnabled?: boolean;
  /**
   * Configuration for TDD workflow (if enabled)
   */
  tddConfig?: AutonomousTddConfig;
}

/**
 * Input for updating an execution
 */
export interface UpdateExecutionInput {
  status?: ExecutionStatus;
  pid?: number | null;
  iterationsUsed?: number;
  ralphOutput?: string;
  errorLog?: string;
  exitCode?: number;
  startedAt?: string;
  completedAt?: string;
}

/**
 * Convert database row to Execution interface
 */
function rowToExecution(row: ExecutionRow): Execution {
  // Parse iterations from output if available (we store it in output_log)
  const iterationsMatch = row.output_log?.match(/Iterations used: (\d+)/);
  const iterationsUsed = iterationsMatch ? parseInt(iterationsMatch[1], 10) : 0;

  // Parse phase history from JSON
  let phaseHistory: TddPhaseRecord[] | null = null;
  if (row.phase_history) {
    try {
      phaseHistory = JSON.parse(row.phase_history) as TddPhaseRecord[];
    } catch {
      // Invalid JSON, leave as null
    }
  }

  // Parse TDD config from JSON
  let tddConfig: AutonomousTddConfig | null = null;
  if (row.tdd_config) {
    try {
      tddConfig = JSON.parse(row.tdd_config) as AutonomousTddConfig;
    } catch {
      // Invalid JSON, leave as null
    }
  }

  return {
    id: row.id,
    taskId: row.task_id,
    pid: null, // PID is not persisted to DB, only tracked in memory
    status: row.status as ExecutionStatus,
    iterationsUsed,
    ralphOutput: row.output_log,
    errorLog: row.error_log,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    currentPhase: row.current_phase as TddPhase | null,
    phaseHistory,
    tddEnabled: row.tdd_enabled === 1,
    tddConfig,
  };
}

/**
 * ExecutionRepository - CRUD operations for executions
 */
export const ExecutionRepository = {
  /**
   * Create a new execution record
   */
  create(input: CreateExecutionInput, db?: DatabaseInstance): Execution {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const id = uuidv4();
      const now = new Date().toISOString();
      const tddEnabled = input.tddEnabled ?? false;
      const tddConfig = input.tddConfig ? JSON.stringify(input.tddConfig) : null;

      database.prepare(`
        INSERT INTO executions (
          id, task_id, project_id, status, created_at, tdd_enabled, tdd_config
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.taskId, input.projectId, 'pending', now, tddEnabled ? 1 : 0, tddConfig);

      return {
        id,
        taskId: input.taskId,
        pid: null,
        status: 'pending',
        iterationsUsed: 0,
        ralphOutput: null,
        errorLog: null,
        exitCode: null,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        currentPhase: null,
        phaseHistory: null,
        tddEnabled,
        tddConfig: input.tddConfig ?? null,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Update an existing execution
   */
  update(id: string, input: UpdateExecutionInput, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (input.status !== undefined) {
        updates.push('status = ?');
        values.push(input.status);
      }

      if (input.ralphOutput !== undefined) {
        // Append iterations info to output if provided
        let output = input.ralphOutput;
        if (input.iterationsUsed !== undefined) {
          output += `\n\nIterations used: ${input.iterationsUsed}`;
        }
        updates.push('output_log = ?');
        values.push(output);
      } else if (input.iterationsUsed !== undefined) {
        // Update just iterations in existing output
        const existing = database.prepare('SELECT output_log FROM executions WHERE id = ?').get(id) as { output_log: string | null } | undefined;
        const existingOutput = existing?.output_log ?? '';
        const output = existingOutput.replace(/\n\nIterations used: \d+$/, '') + `\n\nIterations used: ${input.iterationsUsed}`;
        updates.push('output_log = ?');
        values.push(output);
      }

      if (input.errorLog !== undefined) {
        updates.push('error_log = ?');
        values.push(input.errorLog);
      }

      if (input.exitCode !== undefined) {
        updates.push('exit_code = ?');
        values.push(input.exitCode);
      }

      if (input.startedAt !== undefined) {
        updates.push('started_at = ?');
        values.push(input.startedAt);
      }

      if (input.completedAt !== undefined) {
        updates.push('completed_at = ?');
        values.push(input.completedAt);
      }

      if (updates.length === 0) {
        return true; // Nothing to update
      }

      values.push(id);
      const sql = `UPDATE executions SET ${updates.join(', ')} WHERE id = ?`;
      const result = database.prepare(sql).run(...values);

      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find an execution by ID
   */
  findById(id: string, db?: DatabaseInstance): Execution | undefined {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const row = database.prepare('SELECT * FROM executions WHERE id = ?').get(id) as ExecutionRow | undefined;
      return row ? rowToExecution(row) : undefined;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find all running executions
   */
  findRunning(db?: DatabaseInstance): Execution[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM executions
        WHERE status = 'running'
        ORDER BY started_at ASC
      `).all() as ExecutionRow[];
      return rows.map(rowToExecution);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find executions for a specific task
   */
  findByTask(taskId: string, db?: DatabaseInstance): Execution[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM executions
        WHERE task_id = ?
        ORDER BY created_at DESC
      `).all(taskId) as ExecutionRow[];
      return rows.map(rowToExecution);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find executions for a specific project
   */
  findByProject(projectId: string, db?: DatabaseInstance): Execution[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM executions
        WHERE project_id = ?
        ORDER BY created_at DESC
      `).all(projectId) as ExecutionRow[];
      return rows.map(rowToExecution);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Update the current TDD phase for an execution
   */
  updateCurrentPhase(id: string, phase: TddPhase | null, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const result = database.prepare(`
        UPDATE executions SET current_phase = ? WHERE id = ?
      `).run(phase, id);

      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Append a phase record to the execution's phase history
   */
  appendPhaseHistory(id: string, record: TddPhaseRecord, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      // Get existing phase history
      const existing = database.prepare('SELECT phase_history FROM executions WHERE id = ?').get(id) as { phase_history: string | null } | undefined;

      if (!existing) {
        return false;
      }

      // Parse existing history or start fresh
      let history: TddPhaseRecord[] = [];
      if (existing.phase_history) {
        try {
          history = JSON.parse(existing.phase_history) as TddPhaseRecord[];
        } catch {
          // Invalid JSON, start fresh
        }
      }

      // Append new record
      history.push(record);

      // Update database
      const result = database.prepare(`
        UPDATE executions SET phase_history = ? WHERE id = ?
      `).run(JSON.stringify(history), id);

      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },
};
