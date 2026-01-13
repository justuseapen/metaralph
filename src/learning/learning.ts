/**
 * Learning Model - Stores knowledge extracted from execution outcomes
 *
 * Learnings are patterns, best practices, and gotchas discovered during
 * Ralph executions that can be applied to improve future task success.
 */

import { v4 as uuidv4 } from 'uuid';
import { initDatabase, type DatabaseInstance } from '../db/index.js';

/**
 * Category of learning - what type of knowledge this represents
 */
export type LearningCategory =
  | 'pattern'        // Code pattern that works well
  | 'gotcha'         // Common mistake or pitfall
  | 'dependency'     // Package or tool dependency insight
  | 'testing'        // Testing approach or requirement
  | 'architecture'   // Architectural pattern
  | 'workflow'       // Development workflow tip
  | 'environment'    // Environment/config requirement
  | 'general';       // General knowledge

/**
 * Represents a learning/insight from execution history
 */
export interface Learning {
  id: string;
  executionId: string | null;      // Execution this was extracted from (null if manually added)
  projectId: string | null;        // Project this was observed in (null if cross-project)
  category: LearningCategory;
  content: string;                 // The actual learning/insight text
  confidence: number;              // 0-1 confidence score (increases with successful applications)
  timesApplied: number;            // How many times this learning was used
  timesSuccessful: number;         // How many times it led to success
  tags: string[];                  // Keywords for matching (e.g., 'typescript', 'react')
  createdAt: string;
  updatedAt: string;
}

/**
 * Database row representation (snake_case)
 */
interface LearningRow {
  id: string;
  execution_id: string | null;
  project_id: string | null;
  category: string;
  content: string;
  confidence: number;
  applied_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Input for creating a new learning
 */
export interface CreateLearningInput {
  executionId?: string;
  projectId?: string;
  category: LearningCategory;
  content: string;
  confidence?: number;
  tags?: string[];
}

/**
 * Input for updating a learning
 */
export interface UpdateLearningInput {
  confidence?: number;
  timesApplied?: number;
  timesSuccessful?: number;
}

/**
 * Convert database row to Learning interface
 * Note: tags and timesSuccessful are stored in content JSON metadata
 */
function rowToLearning(row: LearningRow): Learning {
  // Parse metadata from content if present (stored as JSON at end)
  let tags: string[] = [];
  let timesSuccessful = 0;
  let content = row.content;

  // Check for metadata block at end of content
  const metadataMatch = row.content.match(/\n---METADATA---\n(.+)$/);
  if (metadataMatch) {
    try {
      const metadata = JSON.parse(metadataMatch[1]);
      tags = metadata.tags || [];
      timesSuccessful = metadata.timesSuccessful || 0;
      content = row.content.replace(/\n---METADATA---\n.+$/, '');
    } catch {
      // Ignore parse errors, use defaults
    }
  }

  return {
    id: row.id,
    executionId: row.execution_id,
    projectId: row.project_id,
    category: row.category as LearningCategory,
    content,
    confidence: row.confidence,
    timesApplied: row.applied_count,
    timesSuccessful,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Encode metadata into content for storage
 */
function encodeMetadata(content: string, tags: string[], timesSuccessful: number): string {
  const metadata = { tags, timesSuccessful };
  return `${content}\n---METADATA---\n${JSON.stringify(metadata)}`;
}

/**
 * LearningRepository - CRUD operations for learnings
 */
export const LearningRepository = {
  /**
   * Create a new learning
   */
  create(input: CreateLearningInput, db?: DatabaseInstance): Learning {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const id = uuidv4();
      const now = new Date().toISOString();
      const confidence = input.confidence ?? 0.5;
      const tags = input.tags ?? [];
      const contentWithMetadata = encodeMetadata(input.content, tags, 0);

      database.prepare(`
        INSERT INTO learnings (
          id, execution_id, project_id, category, content, confidence,
          applied_count, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.executionId ?? null,
        input.projectId ?? null,
        input.category,
        contentWithMetadata,
        confidence,
        0,
        now,
        now
      );

      return {
        id,
        executionId: input.executionId ?? null,
        projectId: input.projectId ?? null,
        category: input.category,
        content: input.content,
        confidence,
        timesApplied: 0,
        timesSuccessful: 0,
        tags,
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
   * Find a learning by ID
   */
  findById(id: string, db?: DatabaseInstance): Learning | undefined {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const row = database.prepare('SELECT * FROM learnings WHERE id = ?').get(id) as LearningRow | undefined;
      return row ? rowToLearning(row) : undefined;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find all learnings
   */
  findAll(db?: DatabaseInstance): Learning[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM learnings
        ORDER BY confidence DESC, applied_count DESC
      `).all() as LearningRow[];
      return rows.map(rowToLearning);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find learnings by project
   */
  findByProject(projectId: string, db?: DatabaseInstance): Learning[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM learnings
        WHERE project_id = ? OR project_id IS NULL
        ORDER BY confidence DESC
      `).all(projectId) as LearningRow[];
      return rows.map(rowToLearning);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find learnings by category
   */
  findByCategory(category: LearningCategory, db?: DatabaseInstance): Learning[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM learnings
        WHERE category = ?
        ORDER BY confidence DESC
      `).all(category) as LearningRow[];
      return rows.map(rowToLearning);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find learnings by execution
   */
  findByExecution(executionId: string, db?: DatabaseInstance): Learning[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM learnings
        WHERE execution_id = ?
        ORDER BY created_at DESC
      `).all(executionId) as LearningRow[];
      return rows.map(rowToLearning);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Search learnings by content or tags
   */
  search(query: string, db?: DatabaseInstance): Learning[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const searchPattern = `%${query.toLowerCase()}%`;
      const rows = database.prepare(`
        SELECT * FROM learnings
        WHERE LOWER(content) LIKE ? OR LOWER(category) LIKE ?
        ORDER BY confidence DESC
      `).all(searchPattern, searchPattern) as LearningRow[];
      return rows.map(rowToLearning);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Update a learning's metrics (called when learning is applied)
   */
  update(id: string, input: UpdateLearningInput, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const existing = this.findById(id, database);
      if (!existing) {
        return false;
      }

      const now = new Date().toISOString();
      const confidence = input.confidence ?? existing.confidence;
      const timesApplied = input.timesApplied ?? existing.timesApplied;
      const timesSuccessful = input.timesSuccessful ?? existing.timesSuccessful;

      // Re-encode metadata with updated values
      const contentWithMetadata = encodeMetadata(existing.content, existing.tags, timesSuccessful);

      const result = database.prepare(`
        UPDATE learnings
        SET confidence = ?, applied_count = ?, content = ?, updated_at = ?
        WHERE id = ?
      `).run(confidence, timesApplied, contentWithMetadata, now, id);

      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Record that a learning was applied (increment counters)
   */
  recordApplication(id: string, wasSuccessful: boolean, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const existing = this.findById(id, database);
      if (!existing) {
        return false;
      }

      const timesApplied = existing.timesApplied + 1;
      const timesSuccessful = wasSuccessful ? existing.timesSuccessful + 1 : existing.timesSuccessful;

      // Recalculate confidence based on success rate
      // Formula: base confidence + (success_rate * 0.4)
      // This means confidence can range from initial confidence to initial + 0.4
      const successRate = timesApplied > 0 ? timesSuccessful / timesApplied : 0;
      const confidence = Math.min(1.0, 0.5 + (successRate * 0.5));

      return this.update(id, { confidence, timesApplied, timesSuccessful }, database);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Delete a learning
   */
  delete(id: string, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const result = database.prepare('DELETE FROM learnings WHERE id = ?').run(id);
      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find high-confidence learnings (confidence >= threshold)
   */
  findHighConfidence(threshold: number = 0.7, db?: DatabaseInstance): Learning[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM learnings
        WHERE confidence >= ?
        ORDER BY confidence DESC, applied_count DESC
      `).all(threshold) as LearningRow[];
      return rows.map(rowToLearning);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },
};
