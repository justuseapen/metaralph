/**
 * Self-Registration - Auto-registers Ralph and MetaRalph as self-managed projects
 *
 * This module handles the automatic registration of Ralph and MetaRalph
 * codebases when the daemon starts, treating them as self-improvement targets.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { registerSelfProject, getSelfProjects, type Project } from '../registry/index.js';
import { loadConfig } from '../utils/config.js';
import { initDatabase, type DatabaseInstance } from '../db/index.js';

/**
 * Known locations where Ralph might be installed
 */
const RALPH_SEARCH_PATHS = [
  // Global installations
  path.join(os.homedir(), '.ralph'),
  path.join(os.homedir(), 'ralph'),
  // Common development locations
  path.join(os.homedir(), 'code', 'ralph'),
  path.join(os.homedir(), 'projects', 'ralph'),
  path.join(os.homedir(), 'dev', 'ralph'),
  path.join(os.homedir(), 'src', 'ralph'),
  // npm global location
  '/usr/local/lib/node_modules/ralph',
];

/**
 * Known locations where MetaRalph might be installed
 */
const METARALPH_SEARCH_PATHS = [
  // Global installations
  path.join(os.homedir(), '.metaralph'),
  path.join(os.homedir(), 'metaralph'),
  // Common development locations
  path.join(os.homedir(), 'code', 'metaralph'),
  path.join(os.homedir(), 'projects', 'metaralph'),
  path.join(os.homedir(), 'dev', 'metaralph'),
  path.join(os.homedir(), 'src', 'metaralph'),
  path.join(os.homedir(), 'Dropbox', 'code', 'metaralph'),
  // npm global location
  '/usr/local/lib/node_modules/metaralph',
];

/**
 * Generate an isolated branch name for self-improvement work
 *
 * @param projectName - Name of the project
 * @returns Branch name for self-improvement
 */
export function generateSelfBranch(projectName: string): string {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `self-improve/${projectName}-${timestamp}`;
}

/**
 * Find a project by searching known paths
 *
 * @param searchPaths - Array of paths to search
 * @returns The first valid path found, or undefined
 */
function findProjectPath(searchPaths: string[]): string | undefined {
  for (const searchPath of searchPaths) {
    if (fs.existsSync(searchPath) && fs.statSync(searchPath).isDirectory()) {
      // Check if it's a git repository
      if (fs.existsSync(path.join(searchPath, '.git'))) {
        return searchPath;
      }
    }
  }
  return undefined;
}

/**
 * Find Ralph repository path
 *
 * @returns Path to Ralph repository, or undefined if not found
 */
export function findRalphPath(): string | undefined {
  const config = loadConfig();

  // Check config first
  if (config.ralphPath && fs.existsSync(config.ralphPath)) {
    return config.ralphPath;
  }

  // Search known locations
  return findProjectPath(RALPH_SEARCH_PATHS);
}

/**
 * Find MetaRalph repository path
 *
 * @returns Path to MetaRalph repository, or undefined if not found
 */
export function findMetaRalphPath(): string | undefined {
  const config = loadConfig();

  // Check config first
  if (config.metaRalphPath && fs.existsSync(config.metaRalphPath)) {
    return config.metaRalphPath;
  }

  // Check current working directory - might be running from MetaRalph dir
  const cwd = process.cwd();
  const packageJsonPath = path.join(cwd, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (pkg.name === 'metaralph') {
        return cwd;
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  // Search known locations
  return findProjectPath(METARALPH_SEARCH_PATHS);
}

/**
 * Result of self-registration
 */
export interface SelfRegistrationResult {
  success: boolean;
  ralphRegistered: boolean;
  metaRalphRegistered: boolean;
  ralphPath?: string;
  metaRalphPath?: string;
  errors: string[];
}

/**
 * Register Ralph and MetaRalph as self-managed projects
 *
 * This function should be called when the daemon starts.
 * It finds and registers both projects with is_self=true.
 *
 * @param db - Optional database instance
 * @returns Registration result
 */
export function registerSelfProjects(db?: DatabaseInstance): SelfRegistrationResult {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();
  const config = loadConfig();

  const result: SelfRegistrationResult = {
    success: true,
    ralphRegistered: false,
    metaRalphRegistered: false,
    errors: [],
  };

  // Skip if self-improvement is disabled
  if (!config.selfImprovementEnabled) {
    result.success = true;
    return result;
  }

  try {
    // Find and register Ralph
    const ralphPath = findRalphPath();
    if (ralphPath) {
      result.ralphPath = ralphPath;
      const selfBranch = generateSelfBranch('ralph');
      const regResult = registerSelfProject(ralphPath, selfBranch, database);

      if (regResult.success) {
        result.ralphRegistered = true;
      } else {
        result.errors.push(`Ralph registration: ${regResult.message}`);
      }
    }

    // Find and register MetaRalph
    const metaRalphPath = findMetaRalphPath();
    if (metaRalphPath) {
      result.metaRalphPath = metaRalphPath;
      const selfBranch = generateSelfBranch('metaralph');
      const regResult = registerSelfProject(metaRalphPath, selfBranch, database);

      if (regResult.success) {
        result.metaRalphRegistered = true;
      } else {
        result.errors.push(`MetaRalph registration: ${regResult.message}`);
      }
    }

    // Success if at least one was registered or both weren't found (which is ok)
    result.success = result.errors.length === 0 || result.ralphRegistered || result.metaRalphRegistered;
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }

  return result;
}

/**
 * Get currently registered self-managed projects
 *
 * @param db - Optional database instance
 * @returns Array of self-managed projects
 */
export function getRegisteredSelfProjects(db?: DatabaseInstance): Project[] {
  return getSelfProjects(db);
}

/**
 * Check if a project is a self-managed project
 *
 * @param project - Project to check
 * @returns True if the project is self-managed
 */
export function isSelfProject(project: Project): boolean {
  return project.is_self === true || (project.is_self as unknown as number) === 1;
}
