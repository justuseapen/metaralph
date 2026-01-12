import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from '../utils/config.js';

/**
 * Database instance type from better-sqlite3
 */
export type DatabaseInstance = Database.Database;

/**
 * Initialize the MetaRalph SQLite database
 * Creates the database file and all required tables if they don't exist.
 *
 * @param dbPath - Optional path to the database file. Uses config dbPath if not provided.
 * @returns The initialized database instance
 */
export function initDatabase(dbPath?: string): DatabaseInstance {
  const config = loadConfig();
  const finalDbPath = dbPath ?? config.dbPath;

  // Ensure the directory for the database file exists
  const dbDir = path.dirname(finalDbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Create or open the database
  const db = new Database(finalDbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create all tables
  createTables(db);

  return db;
}

/**
 * Create all required tables in the database
 * Uses IF NOT EXISTS to be idempotent
 *
 * @param db - The database instance
 */
function createTables(db: DatabaseInstance): void {
  // Project Groups table - for grouping related repositories
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Projects table - registered projects under MetaRalph management
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      group_id TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (group_id) REFERENCES project_groups(id) ON DELETE SET NULL
    )
  `);

  // Conversations table - collaborative PRD creation threads
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // Messages table - individual messages within conversations
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);

  // Tasks table - PRD user stories / tasks for execution
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      conversation_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      acceptance_criteria TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      passes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    )
  `);

  // Executions table - individual Ralph executions for tasks
  db.exec(`
    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT,
      completed_at TEXT,
      exit_code INTEGER,
      output_log TEXT,
      error_log TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // Learnings table - knowledge extracted from executions for self-improvement
  db.exec(`
    CREATE TABLE IF NOT EXISTS learnings (
      id TEXT PRIMARY KEY,
      execution_id TEXT,
      project_id TEXT,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      applied_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE SET NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    )
  `);

  // Create indexes for common queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_projects_group_id ON projects(group_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_executions_task_id ON executions(task_id);
    CREATE INDEX IF NOT EXISTS idx_executions_project_id ON executions(project_id);
    CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
    CREATE INDEX IF NOT EXISTS idx_learnings_project_id ON learnings(project_id);
    CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category);
  `);
}

/**
 * Close the database connection
 *
 * @param db - The database instance to close
 */
export function closeDatabase(db: DatabaseInstance): void {
  db.close();
}
