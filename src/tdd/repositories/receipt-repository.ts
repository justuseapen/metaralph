/**
 * TDD PR Receipt Repository
 *
 * CRUD operations for PR receipt records. The COMMIT phase creates these receipts
 * to document test results, contract validation, and bug resolution for each execution.
 */

import { v4 as uuidv4 } from 'uuid';
import { initDatabase, type DatabaseInstance } from '../../db/index.js';
import type {
  PrReceipt,
  TestReceipt,
  IntegrationReceipt,
  ReviewReceipt,
} from '../types.js';

/**
 * Input for creating a new PR receipt record
 */
export interface CreateReceiptInput {
  executionId: string;
  testReceipt: TestReceipt;
  integrationReceipt: IntegrationReceipt;
  reviewReceipt: ReviewReceipt;
  prUrl?: string;
}

/**
 * Input for updating a PR receipt record
 */
export interface UpdateReceiptInput {
  testReceipt?: TestReceipt;
  integrationReceipt?: IntegrationReceipt;
  reviewReceipt?: ReviewReceipt;
  prUrl?: string;
}

/**
 * Database row representation for pr_receipts table
 */
interface ReceiptRow {
  id: string;
  execution_id: string;
  test_receipt: string;
  integration_receipt: string;
  review_receipt: string;
  pr_url: string | null;
  created_at: string;
}

/**
 * Convert database row to PrReceipt
 */
function rowToRecord(row: ReceiptRow): PrReceipt {
  return {
    id: row.id,
    executionId: row.execution_id,
    testReceipt: JSON.parse(row.test_receipt) as TestReceipt,
    integrationReceipt: JSON.parse(row.integration_receipt) as IntegrationReceipt,
    reviewReceipt: JSON.parse(row.review_receipt) as ReviewReceipt,
    prUrl: row.pr_url ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * TDD PR Receipt Repository - CRUD operations for PR receipts created during COMMIT phase
 */
export const ReceiptRepository = {
  /**
   * Create a new PR receipt record
   *
   * @param input - Receipt creation parameters
   * @param db - Optional database instance for testing
   * @returns The created receipt record
   */
  create(input: CreateReceiptInput, db?: DatabaseInstance): PrReceipt {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const id = uuidv4();
      const now = new Date().toISOString();

      database.prepare(`
        INSERT INTO pr_receipts (id, execution_id, test_receipt, integration_receipt, review_receipt, pr_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.executionId,
        JSON.stringify(input.testReceipt),
        JSON.stringify(input.integrationReceipt),
        JSON.stringify(input.reviewReceipt),
        input.prUrl ?? null,
        now
      );

      return {
        id,
        executionId: input.executionId,
        testReceipt: input.testReceipt,
        integrationReceipt: input.integrationReceipt,
        reviewReceipt: input.reviewReceipt,
        prUrl: input.prUrl,
        createdAt: now,
      };
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Update an existing PR receipt record
   *
   * @param id - Receipt ID to update
   * @param input - Fields to update
   * @param db - Optional database instance for testing
   * @returns The updated receipt record or null if not found
   */
  update(id: string, input: UpdateReceiptInput, db?: DatabaseInstance): PrReceipt | null {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      // Build dynamic update query
      const updates: string[] = [];
      const values: (string | null)[] = [];

      if (input.testReceipt !== undefined) {
        updates.push('test_receipt = ?');
        values.push(JSON.stringify(input.testReceipt));
      }
      if (input.integrationReceipt !== undefined) {
        updates.push('integration_receipt = ?');
        values.push(JSON.stringify(input.integrationReceipt));
      }
      if (input.reviewReceipt !== undefined) {
        updates.push('review_receipt = ?');
        values.push(JSON.stringify(input.reviewReceipt));
      }
      if (input.prUrl !== undefined) {
        updates.push('pr_url = ?');
        values.push(input.prUrl);
      }

      if (updates.length === 0) {
        return this.findById(id, database);
      }

      values.push(id);
      database.prepare(`
        UPDATE pr_receipts
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
   * Find a PR receipt record by ID
   *
   * @param id - Receipt ID to find
   * @param db - Optional database instance for testing
   * @returns The receipt record or null if not found
   */
  findById(id: string, db?: DatabaseInstance): PrReceipt | null {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const row = database.prepare(`
        SELECT id, execution_id, test_receipt, integration_receipt, review_receipt, pr_url, created_at
        FROM pr_receipts
        WHERE id = ?
      `).get(id) as ReceiptRow | undefined;

      return row ? rowToRecord(row) : null;
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Find a PR receipt record by execution ID
   *
   * Since there's a UNIQUE constraint on execution_id, this returns at most one record.
   *
   * @param executionId - Execution ID to filter by
   * @param db - Optional database instance for testing
   * @returns The receipt record or null if not found
   */
  findByExecution(executionId: string, db?: DatabaseInstance): PrReceipt | null {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const row = database.prepare(`
        SELECT id, execution_id, test_receipt, integration_receipt, review_receipt, pr_url, created_at
        FROM pr_receipts
        WHERE execution_id = ?
      `).get(executionId) as ReceiptRow | undefined;

      return row ? rowToRecord(row) : null;
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },
};
