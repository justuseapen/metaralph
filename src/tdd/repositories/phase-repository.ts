/**
 * TDD Phase Repository
 *
 * CRUD operations for TDD phase records. Tracks phase execution state
 * so the orchestrator can manage phase transitions and recover from interruptions.
 */

import { v4 as uuidv4 } from 'uuid';
import { initDatabase, type DatabaseInstance } from '../../db/index.js';
import type { TddPhase, PhaseStatus, TddPhaseRecord } from '../types.js';

/**
 * Input for creating a new TDD phase record
 */
export interface CreatePhaseInput {
  executionId: string;
  phase: TddPhase;
  status?: PhaseStatus;
  startedAt?: string;
  metrics?: Record<string, unknown>;
}

/**
 * Input for updating a TDD phase record
 */
export interface UpdatePhaseInput {
  status?: PhaseStatus;
  startedAt?: string;
  completedAt?: string;
  metrics?: Record<string, unknown>;
}

/**
 * Database row representation for tdd_phases table
 */
interface PhaseRow {
  id: string;
  execution_id: string;
  phase: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  metrics: string | null;
  created_at: string;
}

/**
 * Convert database row to TddPhaseRecord
 */
function rowToRecord(row: PhaseRow): TddPhaseRecord {
  return {
    id: row.id,
    executionId: row.execution_id,
    phase: row.phase as TddPhase,
    status: row.status as PhaseStatus,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    metrics: row.metrics ? JSON.parse(row.metrics) : {},
    createdAt: row.created_at,
  };
}

/**
 * TDD Phase Repository - CRUD operations for TDD phases
 */
export const PhaseRepository = {
  /**
   * Create a new TDD phase record
   *
   * @param input - Phase creation parameters
   * @param db - Optional database instance for testing
   * @returns The created phase record
   */
  create(input: CreatePhaseInput, db?: DatabaseInstance): TddPhaseRecord {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const id = uuidv4();
      const now = new Date().toISOString();
      const status = input.status ?? 'pending';
      const metricsJson = input.metrics ? JSON.stringify(input.metrics) : null;

      database.prepare(`
        INSERT INTO tdd_phases (id, execution_id, phase, status, started_at, metrics, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.executionId, input.phase, status, input.startedAt ?? null, metricsJson, now);

      return {
        id,
        executionId: input.executionId,
        phase: input.phase,
        status,
        startedAt: input.startedAt ?? null,
        completedAt: null,
        metrics: input.metrics ?? {},
        createdAt: now,
      };
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Update an existing TDD phase record
   *
   * @param id - Phase ID to update
   * @param input - Fields to update
   * @param db - Optional database instance for testing
   * @returns The updated phase record or null if not found
   */
  update(id: string, input: UpdatePhaseInput, db?: DatabaseInstance): TddPhaseRecord | null {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      // Build dynamic update query
      const updates: string[] = [];
      const values: (string | null)[] = [];

      if (input.status !== undefined) {
        updates.push('status = ?');
        values.push(input.status);
      }
      if (input.startedAt !== undefined) {
        updates.push('started_at = ?');
        values.push(input.startedAt);
      }
      if (input.completedAt !== undefined) {
        updates.push('completed_at = ?');
        values.push(input.completedAt);
      }
      if (input.metrics !== undefined) {
        updates.push('metrics = ?');
        values.push(JSON.stringify(input.metrics));
      }

      if (updates.length === 0) {
        return this.findById(id, database);
      }

      values.push(id);
      database.prepare(`
        UPDATE tdd_phases
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...values);

      return this.findById(id, database);
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Find a TDD phase record by ID
   *
   * @param id - Phase ID to find
   * @param db - Optional database instance for testing
   * @returns The phase record or null if not found
   */
  findById(id: string, db?: DatabaseInstance): TddPhaseRecord | null {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const row = database.prepare(`
        SELECT id, execution_id, phase, status, started_at, completed_at, metrics, created_at
        FROM tdd_phases
        WHERE id = ?
      `).get(id) as PhaseRow | undefined;

      return row ? rowToRecord(row) : null;
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Find all TDD phase records for an execution
   *
   * @param executionId - Execution ID to filter by
   * @param db - Optional database instance for testing
   * @returns Array of phase records ordered by created_at
   */
  findByExecution(executionId: string, db?: DatabaseInstance): TddPhaseRecord[] {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const rows = database.prepare(`
        SELECT id, execution_id, phase, status, started_at, completed_at, metrics, created_at
        FROM tdd_phases
        WHERE execution_id = ?
        ORDER BY created_at ASC
      `).all(executionId) as PhaseRow[];

      return rows.map(rowToRecord);
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Get the current (running or latest) phase for an execution
   *
   * @param executionId - Execution ID to query
   * @param db - Optional database instance for testing
   * @returns The current phase record or null if no phases exist
   */
  getCurrentPhase(executionId: string, db?: DatabaseInstance): TddPhaseRecord | null {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      // First try to find a running phase
      const runningRow = database.prepare(`
        SELECT id, execution_id, phase, status, started_at, completed_at, metrics, created_at
        FROM tdd_phases
        WHERE execution_id = ? AND status = 'running'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(executionId) as PhaseRow | undefined;

      if (runningRow) {
        return rowToRecord(runningRow);
      }

      // If no running phase, get the latest phase
      const latestRow = database.prepare(`
        SELECT id, execution_id, phase, status, started_at, completed_at, metrics, created_at
        FROM tdd_phases
        WHERE execution_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(executionId) as PhaseRow | undefined;

      return latestRow ? rowToRecord(latestRow) : null;
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Get ordered phase history for an execution
   *
   * @param executionId - Execution ID to query
   * @param db - Optional database instance for testing
   * @returns Array of phase records in execution order (oldest first)
   */
  getPhaseHistory(executionId: string, db?: DatabaseInstance): TddPhaseRecord[] {
    // This is the same as findByExecution but semantically clearer for getting history
    return this.findByExecution(executionId, db);
  },
};
