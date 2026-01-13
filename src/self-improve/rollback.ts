/**
 * Rollback - Provides checkpoint and rollback functionality for safe execution
 *
 * This module enables creating checkpoints before making changes and
 * rolling back to those checkpoints if something goes wrong.
 */

import { spawn } from 'node:child_process';
import { type Project } from '../registry/index.js';

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
 * Represents a checkpoint in the repository state
 */
export interface Checkpoint {
  /** Unique identifier for this checkpoint */
  id: string;
  /** The git commit SHA at checkpoint creation */
  commitSha: string;
  /** The branch name at checkpoint creation */
  branchName: string;
  /** Human-readable description of the checkpoint */
  description: string;
  /** When the checkpoint was created */
  createdAt: string;
  /** Whether there were uncommitted changes at checkpoint time */
  hadUncommittedChanges: boolean;
  /** Stash reference if changes were stashed */
  stashRef?: string;
}

/**
 * Result of a rollback operation
 */
export interface RollbackResult {
  success: boolean;
  error?: string;
  /** The branch we ended up on after rollback */
  finalBranch?: string;
  /** Whether any stashed changes were restored */
  restoredStash?: boolean;
}

/**
 * Rollback - Provides checkpoint and rollback functionality
 */
export const Rollback = {
  /**
   * Create a checkpoint of the current repository state
   *
   * @param project - The project to checkpoint
   * @param description - Human-readable description of the checkpoint
   * @returns The created checkpoint
   */
  async createCheckpoint(project: Project, description: string): Promise<Checkpoint> {
    // Get current branch
    const branchResult = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], project.path);
    const branchName = branchResult.stdout.trim() || 'HEAD';

    // Get current commit SHA
    const shaResult = await runCommand('git', ['rev-parse', 'HEAD'], project.path);
    const commitSha = shaResult.stdout.trim();

    // Check for uncommitted changes
    const statusResult = await runCommand('git', ['status', '--porcelain'], project.path);
    const hadUncommittedChanges = statusResult.stdout.trim().length > 0;

    let stashRef: string | undefined;

    // If there are uncommitted changes, stash them
    if (hadUncommittedChanges) {
      const stashMessage = `metaralph-checkpoint: ${description}`;
      const stashResult = await runCommand(
        'git',
        ['stash', 'push', '-m', stashMessage, '--include-untracked'],
        project.path
      );

      if (stashResult.exitCode === 0) {
        // Get the stash reference
        const stashListResult = await runCommand('git', ['stash', 'list', '-n', '1'], project.path);
        if (stashListResult.stdout.trim()) {
          stashRef = 'stash@{0}';
        }
      }
    }

    const checkpoint: Checkpoint = {
      id: `checkpoint-${Date.now()}`,
      commitSha,
      branchName,
      description,
      createdAt: new Date().toISOString(),
      hadUncommittedChanges,
      stashRef,
    };

    return checkpoint;
  },

  /**
   * Rollback to a previously created checkpoint
   *
   * @param project - The project to rollback
   * @param checkpoint - The checkpoint to rollback to
   * @returns Result of the rollback operation
   */
  async rollbackToCheckpoint(project: Project, checkpoint: Checkpoint): Promise<RollbackResult> {
    const result: RollbackResult = {
      success: false,
    };

    try {
      // Step 1: Abort any in-progress operations
      await runCommand('git', ['merge', '--abort'], project.path);
      await runCommand('git', ['rebase', '--abort'], project.path);
      await runCommand('git', ['cherry-pick', '--abort'], project.path);

      // Step 2: Clean up any uncommitted changes
      await runCommand('git', ['checkout', '--', '.'], project.path);
      await runCommand('git', ['clean', '-fd'], project.path);

      // Step 3: Checkout the original branch
      const checkoutResult = await runCommand(
        'git',
        ['checkout', checkpoint.branchName],
        project.path
      );

      if (checkoutResult.exitCode !== 0) {
        // If branch doesn't exist anymore, checkout by SHA
        const shaCheckoutResult = await runCommand(
          'git',
          ['checkout', checkpoint.commitSha],
          project.path
        );

        if (shaCheckoutResult.exitCode !== 0) {
          result.error = `Failed to checkout: ${shaCheckoutResult.stderr}`;
          return result;
        }
      }

      // Step 4: Hard reset to the checkpoint commit
      const resetResult = await runCommand(
        'git',
        ['reset', '--hard', checkpoint.commitSha],
        project.path
      );

      if (resetResult.exitCode !== 0) {
        result.error = `Failed to reset: ${resetResult.stderr}`;
        return result;
      }

      result.finalBranch = checkpoint.branchName;

      // Step 5: Restore stashed changes if there were any
      if (checkpoint.stashRef) {
        const stashPopResult = await runCommand(
          'git',
          ['stash', 'pop', checkpoint.stashRef],
          project.path
        );

        result.restoredStash = stashPopResult.exitCode === 0;
      }

      result.success = true;
      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  },

  /**
   * Perform an immediate rollback by resetting to the last commit
   *
   * @param project - The project to rollback
   * @returns Result of the rollback operation
   */
  async immediateRollback(project: Project): Promise<RollbackResult> {
    const result: RollbackResult = {
      success: false,
    };

    try {
      // Abort any in-progress operations
      await runCommand('git', ['merge', '--abort'], project.path);
      await runCommand('git', ['rebase', '--abort'], project.path);

      // Discard all uncommitted changes
      const checkoutResult = await runCommand('git', ['checkout', '--', '.'], project.path);
      const cleanResult = await runCommand('git', ['clean', '-fd'], project.path);

      // Reset to HEAD
      const resetResult = await runCommand('git', ['reset', '--hard', 'HEAD'], project.path);

      if (resetResult.exitCode !== 0) {
        result.error = `Reset failed: ${resetResult.stderr}`;
        return result;
      }

      // Get current branch for result
      const branchResult = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], project.path);
      result.finalBranch = branchResult.stdout.trim();

      result.success = true;
      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  },

  /**
   * Verify that a rollback was successful
   *
   * @param project - The project to verify
   * @param checkpoint - The checkpoint that should have been restored
   * @returns True if the current state matches the checkpoint
   */
  async verifyRollback(project: Project, checkpoint: Checkpoint): Promise<boolean> {
    // Get current commit SHA
    const shaResult = await runCommand('git', ['rev-parse', 'HEAD'], project.path);
    const currentSha = shaResult.stdout.trim();

    // Compare with checkpoint SHA
    return currentSha === checkpoint.commitSha;
  },

  /**
   * Delete all branches matching a pattern (for cleanup)
   *
   * @param project - The project
   * @param pattern - Pattern to match (e.g., "self-improve/")
   * @param excludeBranches - Branches to exclude from deletion
   * @returns Number of branches deleted
   */
  async cleanupBranches(
    project: Project,
    pattern: string,
    excludeBranches: string[] = []
  ): Promise<{ deletedCount: number; errors: string[] }> {
    const errors: string[] = [];
    let deletedCount = 0;

    // List all branches matching pattern
    const branchListResult = await runCommand(
      'git',
      ['branch', '--list', `${pattern}*`],
      project.path
    );

    if (branchListResult.exitCode !== 0 || !branchListResult.stdout.trim()) {
      return { deletedCount: 0, errors: [] };
    }

    const branches = branchListResult.stdout
      .trim()
      .split('\n')
      .map((b) => b.trim().replace(/^\* /, ''))
      .filter((b) => b && !excludeBranches.includes(b));

    for (const branch of branches) {
      const deleteResult = await runCommand('git', ['branch', '-D', branch], project.path);
      if (deleteResult.exitCode === 0) {
        deletedCount++;
      } else {
        errors.push(`Failed to delete ${branch}: ${deleteResult.stderr}`);
      }
    }

    return { deletedCount, errors };
  },

  /**
   * Get the list of stashes created by MetaRalph checkpoints
   *
   * @param project - The project
   * @returns List of MetaRalph stashes
   */
  async listMetaRalphStashes(
    project: Project
  ): Promise<Array<{ index: number; message: string }>> {
    const result = await runCommand('git', ['stash', 'list'], project.path);

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return [];
    }

    const stashes: Array<{ index: number; message: string }> = [];
    const lines = result.stdout.trim().split('\n');

    for (const line of lines) {
      if (line.includes('metaralph-checkpoint:')) {
        const match = line.match(/^stash@\{(\d+)\}:\s*(.*)$/);
        if (match) {
          stashes.push({
            index: parseInt(match[1], 10),
            message: match[2],
          });
        }
      }
    }

    return stashes;
  },

  /**
   * Clean up old MetaRalph stashes
   *
   * @param project - The project
   * @param keepCount - Number of recent stashes to keep
   * @returns Number of stashes dropped
   */
  async cleanupStashes(project: Project, keepCount: number = 5): Promise<number> {
    const stashes = await this.listMetaRalphStashes(project);

    if (stashes.length <= keepCount) {
      return 0;
    }

    let droppedCount = 0;
    // Drop older stashes (higher indices first to avoid index shifting issues)
    const toDelete = stashes.slice(keepCount).sort((a, b) => b.index - a.index);

    for (const stash of toDelete) {
      const dropResult = await runCommand(
        'git',
        ['stash', 'drop', `stash@{${stash.index}}`],
        project.path
      );
      if (dropResult.exitCode === 0) {
        droppedCount++;
      }
    }

    return droppedCount;
  },
};
