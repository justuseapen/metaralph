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
 * Migrate projects table to add new columns if they don't exist
 * This handles upgrades from older schema versions
 *
 * @param db - The database instance
 */
function migrateProjectsTable(db: DatabaseInstance): void {
  // Get existing columns
  const columns = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  // Add last_analyzed column if it doesn't exist
  if (!columnNames.has('last_analyzed')) {
    db.exec('ALTER TABLE projects ADD COLUMN last_analyzed TEXT');
  }
}

/**
 * Migrate tasks table to add new columns if they don't exist
 * This handles upgrades from older schema versions
 *
 * @param db - The database instance
 */
function migrateTasksTable(db: DatabaseInstance): void {
  // Get existing columns
  const columns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  // Add new columns if they don't exist
  const migrations: Array<{ column: string; definition: string }> = [
    { column: 'type', definition: "TEXT NOT NULL DEFAULT 'feature'" },
    { column: 'source', definition: "TEXT NOT NULL DEFAULT 'manual'" },
    { column: 'priority_score', definition: 'REAL NOT NULL DEFAULT 0' },
    { column: 'estimated_effort', definition: "TEXT NOT NULL DEFAULT 'medium'" },
    { column: 'requires_approval', definition: 'INTEGER NOT NULL DEFAULT 1' },
    { column: 'approval_status', definition: "TEXT NOT NULL DEFAULT 'pending'" },
    { column: 'prd_json', definition: 'TEXT' },
  ];

  for (const migration of migrations) {
    if (!columnNames.has(migration.column)) {
      db.exec(`ALTER TABLE tasks ADD COLUMN ${migration.column} ${migration.definition}`);
    }
  }
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

  // Add new columns to existing projects table if they don't exist (migration)
  migrateProjectsTable(db);

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
  // Extended with priority scoring, approval workflow, and PRD storage
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'feature',
      title TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      priority_score REAL NOT NULL DEFAULT 0,
      estimated_effort TEXT NOT NULL DEFAULT 'medium',
      requires_approval INTEGER NOT NULL DEFAULT 1,
      approval_status TEXT NOT NULL DEFAULT 'pending',
      status TEXT NOT NULL DEFAULT 'pending',
      prd_json TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // Add new columns to existing tasks table if they don't exist (migration)
  migrateTasksTable(db);

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
    CREATE INDEX IF NOT EXISTS idx_tasks_priority_score ON tasks(priority_score);
    CREATE INDEX IF NOT EXISTS idx_tasks_approval_status ON tasks(approval_status);
    CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
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
