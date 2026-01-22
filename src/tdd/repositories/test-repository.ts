/**
 * TDD Test Repository
 *
 * CRUD operations for generated test records. Tracks tests created during
 * the RED phase and their status (failing/passing) throughout the workflow.
 */

import { v4 as uuidv4 } from 'uuid';
import { initDatabase, type DatabaseInstance } from '../../db/index.js';
import type { TestType, TestStatus, GeneratedTest } from '../types.js';

/**
 * Input for creating a new generated test record
 */
export interface CreateTestInput {
  phaseId: string;
  testType: TestType;
  filePath: string;
  testContent: string;
  status?: TestStatus;
  errorMessage?: string;
}

/**
 * Input for updating a generated test record
 */
export interface UpdateTestInput {
  status?: TestStatus;
  testContent?: string;
  errorMessage?: string;
}

/**
 * Database row representation for generated_tests table
 */
interface TestRow {
  id: string;
  phase_id: string;
  test_type: string;
  file_path: string;
  test_content: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

/**
 * Test count by status
 */
export interface TestStatusCounts {
  failing: number;
  passing: number;
  error: number;
  skipped: number;
  total: number;
}

/**
 * Convert database row to GeneratedTest
 */
function rowToRecord(row: TestRow): GeneratedTest {
  return {
    id: row.id,
    phaseId: row.phase_id,
    testType: row.test_type as TestType,
    filePath: row.file_path,
    testContent: row.test_content,
    status: row.status as TestStatus,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * TDD Test Repository - CRUD operations for generated tests
 */
export const TestRepository = {
  /**
   * Create a new generated test record
   *
   * @param input - Test creation parameters
   * @param db - Optional database instance for testing
   * @returns The created test record
   */
  create(input: CreateTestInput, db?: DatabaseInstance): GeneratedTest {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const id = uuidv4();
      const now = new Date().toISOString();
      const status = input.status ?? 'failing';

      database.prepare(`
        INSERT INTO generated_tests (id, phase_id, test_type, file_path, test_content, status, error_message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.phaseId,
        input.testType,
        input.filePath,
        input.testContent,
        status,
        input.errorMessage ?? null,
        now
      );

      return {
        id,
        phaseId: input.phaseId,
        testType: input.testType,
        filePath: input.filePath,
        testContent: input.testContent,
        status,
        errorMessage: input.errorMessage,
        createdAt: now,
      };
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Update an existing generated test record
   *
   * @param id - Test ID to update
   * @param input - Fields to update
   * @param db - Optional database instance for testing
   * @returns The updated test record or null if not found
   */
  update(id: string, input: UpdateTestInput, db?: DatabaseInstance): GeneratedTest | null {
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
      if (input.testContent !== undefined) {
        updates.push('test_content = ?');
        values.push(input.testContent);
      }
      if (input.errorMessage !== undefined) {
        updates.push('error_message = ?');
        values.push(input.errorMessage);
      }

      if (updates.length === 0) {
        return this.findById(id, database);
      }

      values.push(id);
      database.prepare(`
        UPDATE generated_tests
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
   * Find a generated test record by ID
   *
   * @param id - Test ID to find
   * @param db - Optional database instance for testing
   * @returns The test record or null if not found
   */
  findById(id: string, db?: DatabaseInstance): GeneratedTest | null {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const row = database.prepare(`
        SELECT id, phase_id, test_type, file_path, test_content, status, error_message, created_at
        FROM generated_tests
        WHERE id = ?
      `).get(id) as TestRow | undefined;

      return row ? rowToRecord(row) : null;
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Find all generated tests for a phase
   *
   * @param phaseId - Phase ID to filter by
   * @param db - Optional database instance for testing
   * @returns Array of test records ordered by created_at
   */
  findByPhase(phaseId: string, db?: DatabaseInstance): GeneratedTest[] {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const rows = database.prepare(`
        SELECT id, phase_id, test_type, file_path, test_content, status, error_message, created_at
        FROM generated_tests
        WHERE phase_id = ?
        ORDER BY created_at ASC
      `).all(phaseId) as TestRow[];

      return rows.map(rowToRecord);
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Find generated tests filtered by type
   *
   * @param phaseId - Phase ID to filter by
   * @param testType - Test type to filter by (unit, integration, e2e)
   * @param db - Optional database instance for testing
   * @returns Array of test records matching the filter
   */
  findByType(phaseId: string, testType: TestType, db?: DatabaseInstance): GeneratedTest[] {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const rows = database.prepare(`
        SELECT id, phase_id, test_type, file_path, test_content, status, error_message, created_at
        FROM generated_tests
        WHERE phase_id = ? AND test_type = ?
        ORDER BY created_at ASC
      `).all(phaseId, testType) as TestRow[];

      return rows.map(rowToRecord);
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Count tests by status for a phase
   *
   * @param phaseId - Phase ID to count tests for
   * @param db - Optional database instance for testing
   * @returns Object with counts by status and total
   */
  countByStatus(phaseId: string, db?: DatabaseInstance): TestStatusCounts {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      // Get counts for each status
      const rows = database.prepare(`
        SELECT status, COUNT(*) as count
        FROM generated_tests
        WHERE phase_id = ?
        GROUP BY status
      `).all(phaseId) as Array<{ status: string; count: number }>;

      // Initialize counts
      const counts: TestStatusCounts = {
        failing: 0,
        passing: 0,
        error: 0,
        skipped: 0,
        total: 0,
      };

      // Populate from query results
      for (const row of rows) {
        const status = row.status as TestStatus;
        if (status in counts) {
          counts[status] = row.count;
        }
        counts.total += row.count;
      }

      return counts;
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },
};
