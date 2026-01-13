/**
 * Project Registry - Manages projects registered with MetaRalph
 *
 * Provides opt-in project management functionality where users explicitly
 * add projects they want MetaRalph to manage.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase, type DatabaseInstance } from '../db/index.js';

/**
 * Represents a project registered with MetaRalph
 */
export interface Project {
  id: string;
  name: string;
  path: string;
  group_id: string | null;
  added_at: string;
  updated_at: string;
  /** Whether this is a self-managed project (Ralph or MetaRalph itself) */
  is_self?: boolean;
  /** Isolated branch for self-improvement work */
  self_branch?: string;
}

/**
 * Result of an add/remove operation
 */
export interface RegistryResult {
  success: boolean;
  message: string;
  project?: Project;
}

/**
 * Check if a path is a git repository
 *
 * @param projectPath - Path to check
 * @returns true if the path contains a .git directory
 */
export function isGitRepository(projectPath: string): boolean {
  const gitPath = path.join(projectPath, '.git');
  try {
    const stat = fs.statSync(gitPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Extract project name from path
 * Tries to read from package.json first, falls back to directory name
 *
 * @param projectPath - Path to the project
 * @returns The project name
 */
export function extractProjectName(projectPath: string): string {
  // Try to read package.json first
  const packageJsonPath = path.join(projectPath, 'package.json');
  try {
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (packageJson.name && typeof packageJson.name === 'string') {
        return packageJson.name;
      }
    }
  } catch {
    // Ignore JSON parse errors, fall back to directory name
  }

  // Fall back to directory name
  return path.basename(projectPath);
}

/**
 * Add a project to the MetaRalph registry
 *
 * @param projectPath - Path to the project to add
 * @param db - Optional database instance (creates one if not provided)
 * @returns Result of the add operation
 */
export function addProject(projectPath: string, db?: DatabaseInstance): RegistryResult {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    // Resolve to absolute path
    const absolutePath = path.resolve(projectPath);

    // Check if path exists
    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        message: `Path does not exist: ${absolutePath}`,
      };
    }

    // Check if it's a directory
    const stat = fs.statSync(absolutePath);
    if (!stat.isDirectory()) {
      return {
        success: false,
        message: `Path is not a directory: ${absolutePath}`,
      };
    }

    // Validate it's a git repository
    if (!isGitRepository(absolutePath)) {
      return {
        success: false,
        message: `Path is not a git repository: ${absolutePath}`,
      };
    }

    // Check if project is already registered
    const existing = database.prepare('SELECT * FROM projects WHERE path = ?').get(absolutePath) as Project | undefined;
    if (existing) {
      return {
        success: false,
        message: `Project already registered: ${existing.name} (${existing.id})`,
        project: existing,
      };
    }

    // Extract project name
    const name = extractProjectName(absolutePath);

    // Create project record
    const id = uuidv4();
    const now = new Date().toISOString();

    database.prepare(`
      INSERT INTO projects (id, name, path, added_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, absolutePath, now, now);

    const project: Project = {
      id,
      name,
      path: absolutePath,
      group_id: null,
      added_at: now,
      updated_at: now,
    };

    return {
      success: true,
      message: `Project added: ${name}`,
      project,
    };
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * Remove a project from the MetaRalph registry
 *
 * @param projectId - ID of the project to remove
 * @param db - Optional database instance (creates one if not provided)
 * @returns Result of the remove operation
 */
export function removeProject(projectId: string, db?: DatabaseInstance): RegistryResult {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    // Find the project
    const project = database.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Project | undefined;

    if (!project) {
      return {
        success: false,
        message: `Project not found: ${projectId}`,
      };
    }

    // Delete the project
    database.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

    return {
      success: true,
      message: `Project removed: ${project.name}`,
      project,
    };
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * List all registered projects
 *
 * @param db - Optional database instance (creates one if not provided)
 * @returns Array of all registered projects
 */
export function listProjects(db?: DatabaseInstance): Project[] {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    const projects = database.prepare(`
      SELECT * FROM projects
      ORDER BY added_at DESC
    `).all() as Project[];

    return projects;
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * Get a project by ID
 *
 * @param projectId - ID of the project
 * @param db - Optional database instance (creates one if not provided)
 * @returns The project or undefined if not found
 */
export function getProject(projectId: string, db?: DatabaseInstance): Project | undefined {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    const project = database.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Project | undefined;
    return project;
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * Get a project by path
 *
 * @param projectPath - Path to the project
 * @param db - Optional database instance (creates one if not provided)
 * @returns The project or undefined if not found
 */
export function getProjectByPath(projectPath: string, db?: DatabaseInstance): Project | undefined {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    const absolutePath = path.resolve(projectPath);
    const project = database.prepare('SELECT * FROM projects WHERE path = ?').get(absolutePath) as Project | undefined;
    return project;
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * Register a self-managed project (Ralph or MetaRalph)
 * Self-managed projects are always enabled and use separate isolated branches.
 *
 * @param projectPath - Path to the project
 * @param selfBranch - Branch name for self-improvement work
 * @param db - Optional database instance (creates one if not provided)
 * @returns Result of the registration
 */
export function registerSelfProject(
  projectPath: string,
  selfBranch: string,
  db?: DatabaseInstance
): RegistryResult {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    // Resolve to absolute path
    const absolutePath = path.resolve(projectPath);

    // Check if path exists
    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        message: `Path does not exist: ${absolutePath}`,
      };
    }

    // Check if it's a directory
    const stat = fs.statSync(absolutePath);
    if (!stat.isDirectory()) {
      return {
        success: false,
        message: `Path is not a directory: ${absolutePath}`,
      };
    }

    // Validate it's a git repository
    if (!isGitRepository(absolutePath)) {
      return {
        success: false,
        message: `Path is not a git repository: ${absolutePath}`,
      };
    }

    // Check if project is already registered
    const existing = database.prepare('SELECT * FROM projects WHERE path = ?').get(absolutePath) as Project | undefined;
    if (existing) {
      // Update existing project to mark it as self-managed
      database.prepare(`
        UPDATE projects SET is_self = 1, self_branch = ?, updated_at = ?
        WHERE id = ?
      `).run(selfBranch, new Date().toISOString(), existing.id);

      return {
        success: true,
        message: `Project updated as self-managed: ${existing.name}`,
        project: {
          ...existing,
          is_self: true,
          self_branch: selfBranch,
        },
      };
    }

    // Extract project name
    const name = extractProjectName(absolutePath);

    // Create project record with is_self = true
    const id = uuidv4();
    const now = new Date().toISOString();

    database.prepare(`
      INSERT INTO projects (id, name, path, is_self, self_branch, added_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)
    `).run(id, name, absolutePath, selfBranch, now, now);

    const project: Project = {
      id,
      name,
      path: absolutePath,
      group_id: null,
      added_at: now,
      updated_at: now,
      is_self: true,
      self_branch: selfBranch,
    };

    return {
      success: true,
      message: `Self-managed project added: ${name}`,
      project,
    };
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * Get all self-managed projects (Ralph and MetaRalph)
 *
 * @param db - Optional database instance (creates one if not provided)
 * @returns Array of self-managed projects
 */
export function getSelfProjects(db?: DatabaseInstance): Project[] {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    const projects = database.prepare(`
      SELECT * FROM projects WHERE is_self = 1
      ORDER BY added_at DESC
    `).all() as Project[];

    return projects;
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}
