/**
 * TDD Bug Repository
 *
 * CRUD operations for bug records. Tracks bugs found during the REFINE phase
 * and their resolution status. Critical for determining when to exit the refine loop.
 */

import { v4 as uuidv4 } from 'uuid';
import { initDatabase, type DatabaseInstance } from '../../db/index.js';
import type { BugSeverity, BugCategory, BugStatus, Bug } from '../types.js';

/**
 * Input for creating a new bug record
 */
export interface CreateBugInput {
  phaseId: string;
  severity: BugSeverity;
  category: BugCategory;
  description: string;
  filePath: string;
  lineNumber?: number;
  status?: BugStatus;
  suggestedFix?: string;
}

/**
 * Input for updating a bug record
 */
export interface UpdateBugInput {
  status?: BugStatus;
  suggestedFix?: string;
  fixedAt?: string;
  fixAttempts?: number;
}

/**
 * Bug counts by priority level
 */
export interface BugPriorityCounts {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
}

/**
 * Database row representation for bugs table
 */
interface BugRow {
  id: string;
  phase_id: string;
  severity: string;
  category: string;
  description: string;
  file_path: string;
  line_number: number | null;
  status: string;
  suggested_fix: string | null;
  fix_attempts: number;
  fixed_at: string | null;
  created_at: string;
}

/**
 * Convert database row to Bug
 */
function rowToRecord(row: BugRow): Bug {
  return {
    id: row.id,
    phaseId: row.phase_id,
    severity: row.severity as BugSeverity,
    category: row.category as BugCategory,
    description: row.description,
    filePath: row.file_path,
    lineNumber: row.line_number ?? undefined,
    status: row.status as BugStatus,
    suggestedFix: row.suggested_fix ?? undefined,
    fixAttempts: row.fix_attempts,
    fixedAt: row.fixed_at ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * TDD Bug Repository - CRUD operations for bugs found during REFINE phase
 */
export const BugRepository = {
  /**
   * Create a new bug record
   *
   * @param input - Bug creation parameters
   * @param db - Optional database instance for testing
   * @returns The created bug record
   */
  create(input: CreateBugInput, db?: DatabaseInstance): Bug {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const id = uuidv4();
      const now = new Date().toISOString();
      const status = input.status ?? 'open';

      database.prepare(`
        INSERT INTO bugs (id, phase_id, severity, category, description, file_path, line_number, status, suggested_fix, fix_attempts, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.phaseId,
        input.severity,
        input.category,
        input.description,
        input.filePath,
        input.lineNumber ?? null,
        status,
        input.suggestedFix ?? null,
        0,
        now
      );

      return {
        id,
        phaseId: input.phaseId,
        severity: input.severity,
        category: input.category,
        description: input.description,
        filePath: input.filePath,
        lineNumber: input.lineNumber,
        status,
        suggestedFix: input.suggestedFix,
        fixAttempts: 0,
        fixedAt: undefined,
        createdAt: now,
      };
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Update an existing bug record
   *
   * @param id - Bug ID to update
   * @param input - Fields to update
   * @param db - Optional database instance for testing
   * @returns The updated bug record or null if not found
   */
  update(id: string, input: UpdateBugInput, db?: DatabaseInstance): Bug | null {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      // Build dynamic update query
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (input.status !== undefined) {
        updates.push('status = ?');
        values.push(input.status);
      }
      if (input.suggestedFix !== undefined) {
        updates.push('suggested_fix = ?');
        values.push(input.suggestedFix);
      }
      if (input.fixedAt !== undefined) {
        updates.push('fixed_at = ?');
        values.push(input.fixedAt);
      }
      if (input.fixAttempts !== undefined) {
        updates.push('fix_attempts = ?');
        values.push(input.fixAttempts);
      }

      if (updates.length === 0) {
        return this.findById(id, database);
      }

      values.push(id);
      database.prepare(`
        UPDATE bugs
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
   * Find a bug record by ID
   *
   * @param id - Bug ID to find
   * @param db - Optional database instance for testing
   * @returns The bug record or null if not found
   */
  findById(id: string, db?: DatabaseInstance): Bug | null {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const row = database.prepare(`
        SELECT id, phase_id, severity, category, description, file_path, line_number, status, suggested_fix, fix_attempts, fixed_at, created_at
        FROM bugs
        WHERE id = ?
      `).get(id) as BugRow | undefined;

      return row ? rowToRecord(row) : null;
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Find all bugs for a phase
   *
   * @param phaseId - Phase ID to filter by
   * @param db - Optional database instance for testing
   * @returns Array of bug records ordered by severity (P0 first) and created_at
   */
  findByPhase(phaseId: string, db?: DatabaseInstance): Bug[] {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const rows = database.prepare(`
        SELECT id, phase_id, severity, category, description, file_path, line_number, status, suggested_fix, fix_attempts, fixed_at, created_at
        FROM bugs
        WHERE phase_id = ?
        ORDER BY
          CASE severity
            WHEN 'P0' THEN 1
            WHEN 'P1' THEN 2
            WHEN 'P2' THEN 3
            WHEN 'P3' THEN 4
          END,
          created_at ASC
      `).all(phaseId) as BugRow[];

      return rows.map(rowToRecord);
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Find bugs by severity level
   *
   * @param phaseId - Phase ID to filter by
   * @param severity - Severity level to filter by (P0, P1, P2, P3)
   * @param db - Optional database instance for testing
   * @returns Array of bug records with the specified severity
   */
  findBySeverity(phaseId: string, severity: BugSeverity, db?: DatabaseInstance): Bug[] {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const rows = database.prepare(`
        SELECT id, phase_id, severity, category, description, file_path, line_number, status, suggested_fix, fix_attempts, fixed_at, created_at
        FROM bugs
        WHERE phase_id = ? AND severity = ?
        ORDER BY created_at ASC
      `).all(phaseId, severity) as BugRow[];

      return rows.map(rowToRecord);
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Find all open (unresolved) bugs for a phase
   *
   * @param phaseId - Phase ID to filter by
   * @param db - Optional database instance for testing
   * @returns Array of open bug records
   */
  findOpen(phaseId: string, db?: DatabaseInstance): Bug[] {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const rows = database.prepare(`
        SELECT id, phase_id, severity, category, description, file_path, line_number, status, suggested_fix, fix_attempts, fixed_at, created_at
        FROM bugs
        WHERE phase_id = ? AND status = 'open'
        ORDER BY
          CASE severity
            WHEN 'P0' THEN 1
            WHEN 'P1' THEN 2
            WHEN 'P2' THEN 3
            WHEN 'P3' THEN 4
          END,
          created_at ASC
      `).all(phaseId) as BugRow[];

      return rows.map(rowToRecord);
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Count open bugs by priority level
   *
   * @param phaseId - Phase ID to count bugs for
   * @param db - Optional database instance for testing
   * @returns Counts of open bugs by priority (p0, p1, p2, p3)
   */
  countOpenByPriority(phaseId: string, db?: DatabaseInstance): BugPriorityCounts {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const rows = database.prepare(`
        SELECT severity, COUNT(*) as count
        FROM bugs
        WHERE phase_id = ? AND status = 'open'
        GROUP BY severity
      `).all(phaseId) as Array<{ severity: string; count: number }>;

      // Initialize with zeros
      const counts: BugPriorityCounts = {
        p0: 0,
        p1: 0,
        p2: 0,
        p3: 0,
      };

      // Fill in actual counts
      for (const row of rows) {
        const key = row.severity.toLowerCase() as keyof BugPriorityCounts;
        if (key in counts) {
          counts[key] = row.count;
        }
      }

      return counts;
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Check if the REFINE phase can exit its loop
   *
   * The loop can exit when there are no open P0 or P1 bugs.
   * P2 and P3 bugs are acceptable to ship with.
   *
   * @param phaseId - Phase ID to check
   * @param db - Optional database instance for testing
   * @returns True if P0=0 AND P1=0 for open bugs, false otherwise
   */
  canExitRefineLoop(phaseId: string, db?: DatabaseInstance): boolean {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      // Count open P0 and P1 bugs
      const result = database.prepare(`
        SELECT COUNT(*) as count
        FROM bugs
        WHERE phase_id = ? AND status = 'open' AND severity IN ('P0', 'P1')
      `).get(phaseId) as { count: number };

      return result.count === 0;
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },
};
