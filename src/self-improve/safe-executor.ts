/**
 * Safe Executor - Executes self-improvements on isolated branches
 *
 * This module provides sandboxed execution for self-improvement tasks,
 * creating isolated branches to safely test changes before merging.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Project } from '../registry/index.js';
import { type Task } from '../queue/task.js';
import { RalphSpawner, type SpawnOptions, type CompletionResult } from '../workers/ralph-spawner.js';
import { ExecutionRepository, type Execution } from '../workers/execution.js';
import { TaskRepository } from '../queue/task.js';
import { initDatabase, type DatabaseInstance } from '../db/index.js';
import { Rollback, type Checkpoint } from './rollback.js';

/**
 * Result of running a shell command
 */
interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a shell command and capture output
 */
function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });

    proc.on('error', () => {
      resolve({
        stdout,
        stderr,
        exitCode: 1,
      });
    });
  });
}

/**
 * Result of safe execution
 */
export interface SafeExecutionResult {
  success: boolean;
  branchName: string;
  checkpoint?: Checkpoint;
  execution?: Execution;
  completionResult?: CompletionResult;
  validationPassed: boolean;
  error?: string;
  wasRolledBack: boolean;
}

/**
 * Options for safe execution
 */
export interface SafeExecutionOptions {
  /** Feature name for the branch (used in branch name generation) */
  featureName: string;
  /** Run full test suite after completion */
  runTests?: boolean;
  /** Run typecheck after completion */
  runTypecheck?: boolean;
  /** Auto-merge on success */
  autoMerge?: boolean;
  /** Max iterations for Ralph */
  maxIterations?: number;
}

/**
 * Generate an isolated branch name for self-improvement work
 *
 * @param featureName - Name of the feature being implemented
 * @returns Branch name in format: self-improve/<feature>-<timestamp>
 */
export function generateIsolatedBranchName(featureName: string): string {
  const timestamp = Date.now();
  // Sanitize feature name for branch name
  const sanitized = featureName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  return `self-improve/${sanitized}-${timestamp}`;
}

/**
 * SafeExecutor - Executes self-improvements on isolated branches
 */
export const SafeExecutor = {
  /**
   * Create an isolated branch for self-improvement work
   *
   * @param project - The project to create the branch in
   * @param branchName - Name for the new branch
   * @returns Result indicating success/failure
   */
  async createIsolatedBranch(
    project: Project,
    branchName: string
  ): Promise<{ success: boolean; error?: string }> {
    // Get current branch to return to if needed
    const currentBranchResult = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], project.path);
    if (currentBranchResult.exitCode !== 0) {
      return { success: false, error: 'Failed to get current branch' };
    }

    // Check if branch already exists
    const branchExistsResult = await runCommand('git', ['branch', '--list', branchName], project.path);
    if (branchExistsResult.stdout.trim()) {
      // Branch exists, check it out
      const checkoutResult = await runCommand('git', ['checkout', branchName], project.path);
      return {
        success: checkoutResult.exitCode === 0,
        error: checkoutResult.exitCode !== 0 ? checkoutResult.stderr : undefined,
      };
    }

    // Create and checkout new branch from main/master
    const mainBranchResult = await runCommand(
      'git',
      ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
      project.path
    );
    const mainBranch = mainBranchResult.stdout.trim().replace('origin/', '') || 'main';

    // First, ensure we're on the main branch and up to date
    const fetchResult = await runCommand('git', ['fetch', 'origin'], project.path);
    if (fetchResult.exitCode !== 0) {
      // Fetch failed, but we can still try to create from local
    }

    // Create branch from main
    const createResult = await runCommand(
      'git',
      ['checkout', '-b', branchName, mainBranch],
      project.path
    );

    if (createResult.exitCode !== 0) {
      // Try without specifying base branch
      const fallbackResult = await runCommand('git', ['checkout', '-b', branchName], project.path);
      return {
        success: fallbackResult.exitCode === 0,
        error: fallbackResult.exitCode !== 0 ? fallbackResult.stderr : undefined,
      };
    }

    return { success: true };
  },

  /**
   * Execute a self-improvement task on an isolated branch
   *
   * @param task - The task to execute
   * @param project - The project to execute in
   * @param options - Execution options
   * @param db - Optional database instance
   * @returns SafeExecutionResult with details of the execution
   */
  async execute(
    task: Task,
    project: Project,
    options: SafeExecutionOptions,
    db?: DatabaseInstance
  ): Promise<SafeExecutionResult> {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    // Generate branch name
    const branchName = generateIsolatedBranchName(options.featureName);

    const result: SafeExecutionResult = {
      success: false,
      branchName,
      validationPassed: false,
      wasRolledBack: false,
    };

    try {
      // Step 1: Create checkpoint before making any changes
      const checkpoint = await Rollback.createCheckpoint(project, `Pre-${options.featureName}`);
      result.checkpoint = checkpoint;

      // Step 2: Create isolated branch
      const branchResult = await this.createIsolatedBranch(project, branchName);
      if (!branchResult.success) {
        result.error = `Failed to create isolated branch: ${branchResult.error}`;
        return result;
      }

      // Step 3: Update task status
      TaskRepository.updateStatus(task.id, 'running', database);

      // Step 4: Spawn Ralph to execute the task
      const spawnOptions: SpawnOptions = {
        tool: 'claude',
        maxIterations: options.maxIterations ?? 10,
      };

      const spawnResult = RalphSpawner.spawn(task, project, spawnOptions);
      if (!spawnResult.success || !spawnResult.childProcess) {
        result.error = `Failed to spawn Ralph: ${spawnResult.error}`;
        await this.handleFailure(project, checkpoint, database, task.id);
        result.wasRolledBack = true;
        return result;
      }

      result.execution = spawnResult.execution;

      // Step 5: Monitor execution
      const completionResult = await RalphSpawner.monitor(spawnResult.execution, spawnResult.childProcess);
      result.completionResult = completionResult;

      // Step 6: If execution failed, rollback
      if (!completionResult.success) {
        result.error = `Ralph execution failed: ${completionResult.errorOutput || 'Unknown error'}`;
        await this.handleFailure(project, checkpoint, database, task.id);
        result.wasRolledBack = true;
        return result;
      }

      // Step 7: Run validation (typecheck and tests)
      const validationResult = await this.runValidation(project, options);
      result.validationPassed = validationResult.success;

      if (!validationResult.success) {
        result.error = `Validation failed: ${validationResult.error}`;
        await this.handleFailure(project, checkpoint, database, task.id);
        result.wasRolledBack = true;
        return result;
      }

      // Step 8: Success - update task status
      TaskRepository.updateStatus(task.id, 'completed', database);
      result.success = true;

      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      // Try to rollback on any unexpected error
      if (result.checkpoint) {
        await Rollback.rollbackToCheckpoint(project, result.checkpoint);
        result.wasRolledBack = true;
      }
      TaskRepository.updateStatus(task.id, 'failed', database);
      return result;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Run validation checks (typecheck and/or tests)
   *
   * @param project - The project to validate
   * @param options - Execution options with validation settings
   * @returns Result indicating success/failure
   */
  async runValidation(
    project: Project,
    options: SafeExecutionOptions
  ): Promise<{ success: boolean; error?: string }> {
    const errors: string[] = [];

    // Run typecheck if enabled (default: true)
    if (options.runTypecheck !== false) {
      const typecheckResult = await this.runTypecheck(project);
      if (!typecheckResult.success) {
        errors.push(`Typecheck: ${typecheckResult.error}`);
      }
    }

    // Run tests if enabled (default: true)
    if (options.runTests !== false) {
      const testResult = await this.runTests(project);
      if (!testResult.success) {
        errors.push(`Tests: ${testResult.error}`);
      }
    }

    if (errors.length > 0) {
      return { success: false, error: errors.join('; ') };
    }

    return { success: true };
  },

  /**
   * Run TypeScript typecheck
   *
   * @param project - The project to typecheck
   * @returns Result indicating success/failure
   */
  async runTypecheck(project: Project): Promise<{ success: boolean; error?: string }> {
    // Check if tsc is available
    const tscPath = path.join(project.path, 'node_modules', '.bin', 'tsc');
    if (!fs.existsSync(tscPath)) {
      // No TypeScript, skip
      return { success: true };
    }

    const result = await runCommand(tscPath, ['--noEmit'], project.path);
    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || result.stdout || 'Typecheck failed',
      };
    }

    return { success: true };
  },

  /**
   * Run test suite
   *
   * @param project - The project to test
   * @returns Result indicating success/failure
   */
  async runTests(project: Project): Promise<{ success: boolean; error?: string }> {
    // Detect test runner
    const packageJsonPath = path.join(project.path, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return { success: true }; // No package.json, skip tests
    }

    let testCommand = 'npm';
    let testArgs = ['test', '--', '--passWithNoTests'];

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const scripts = packageJson.scripts || {};

      if (!scripts.test) {
        // No test script defined
        return { success: true };
      }

      // Check for specific test runners
      if (scripts.test.includes('vitest')) {
        testArgs = ['run', 'test'];
      } else if (scripts.test.includes('jest')) {
        testArgs = ['test', '--', '--passWithNoTests'];
      }
    } catch {
      // Ignore JSON parse errors
    }

    const result = await runCommand(testCommand, testArgs, project.path);
    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || result.stdout || 'Tests failed',
      };
    }

    return { success: true };
  },

  /**
   * Handle execution failure by rolling back and updating status
   *
   * @param project - The project
   * @param checkpoint - The checkpoint to rollback to
   * @param db - Database instance
   * @param taskId - The task ID
   */
  async handleFailure(
    project: Project,
    checkpoint: Checkpoint,
    db: DatabaseInstance,
    taskId: string
  ): Promise<void> {
    // Rollback to checkpoint
    await Rollback.rollbackToCheckpoint(project, checkpoint);

    // Update task status
    TaskRepository.updateStatus(taskId, 'failed', db);
  },

  /**
   * Merge the isolated branch back to main
   *
   * @param project - The project
   * @param branchName - The branch to merge
   * @returns Result indicating success/failure
   */
  async mergeBranch(
    project: Project,
    branchName: string
  ): Promise<{ success: boolean; error?: string }> {
    // Get main branch name
    const mainBranchResult = await runCommand(
      'git',
      ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
      project.path
    );
    const mainBranch = mainBranchResult.stdout.trim().replace('origin/', '') || 'main';

    // Checkout main branch
    const checkoutResult = await runCommand('git', ['checkout', mainBranch], project.path);
    if (checkoutResult.exitCode !== 0) {
      return { success: false, error: `Failed to checkout ${mainBranch}: ${checkoutResult.stderr}` };
    }

    // Merge the feature branch
    const mergeResult = await runCommand(
      'git',
      ['merge', branchName, '--no-edit'],
      project.path
    );

    if (mergeResult.exitCode !== 0) {
      return { success: false, error: `Merge failed: ${mergeResult.stderr}` };
    }

    return { success: true };
  },

  /**
   * Clean up an isolated branch after execution
   *
   * @param project - The project
   * @param branchName - The branch to delete
   * @param force - Force delete even if not fully merged
   * @returns Result indicating success/failure
   */
  async cleanupBranch(
    project: Project,
    branchName: string,
    force: boolean = false
  ): Promise<{ success: boolean; error?: string }> {
    const deleteFlag = force ? '-D' : '-d';
    const result = await runCommand('git', ['branch', deleteFlag, branchName], project.path);

    return {
      success: result.exitCode === 0,
      error: result.exitCode !== 0 ? result.stderr : undefined,
    };
  },
};
