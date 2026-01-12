/**
 * Ralph Spawner - Spawns and monitors Ralph worker processes
 *
 * Responsible for:
 * - Creating prd.json in the target project
 * - Spawning ralph.sh subprocess
 * - Capturing stdout/stderr
 * - Detecting completion via '<promise>COMPLETE</promise>'
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Task } from '../queue/task.js';
import { type Project } from '../registry/index.js';
import { ExecutionRepository, type Execution } from './execution.js';
import { TaskRepository } from '../queue/task.js';
import { initDatabase } from '../db/index.js';

/**
 * Result of spawning a Ralph process
 */
export interface SpawnResult {
  success: boolean;
  execution: Execution;
  childProcess?: ChildProcess;
  error?: string;
}

/**
 * Options for spawning Ralph
 */
export interface SpawnOptions {
  maxIterations?: number;
  tool?: 'claude' | 'cursor';
}

/**
 * Completion result from Ralph execution
 */
export interface CompletionResult {
  success: boolean;
  completed: boolean; // True if '<promise>COMPLETE</promise>' detected
  output: string;
  errorOutput: string;
  exitCode: number | null;
  iterationsUsed: number;
}

/**
 * RalphSpawner - Spawns Ralph worker processes for task execution
 */
export const RalphSpawner = {
  /**
   * Spawn a Ralph instance for a task
   *
   * @param task - The task to execute
   * @param project - The project to run Ralph in
   * @param options - Spawn options
   * @returns SpawnResult with child process if successful
   */
  spawn(task: Task, project: Project, options: SpawnOptions = {}): SpawnResult {
    const db = initDatabase();

    try {
      // Validate task has PRD JSON
      if (!task.prdJson) {
        return {
          success: false,
          execution: ExecutionRepository.create({ taskId: task.id, projectId: project.id }, db),
          error: 'Task does not have PRD JSON defined',
        };
      }

      // Create execution record
      const execution = ExecutionRepository.create({ taskId: task.id, projectId: project.id }, db);

      // Write prd.json to project directory
      const prdPath = path.join(project.path, 'prd.json');
      try {
        fs.writeFileSync(prdPath, task.prdJson, 'utf-8');
      } catch (err) {
        ExecutionRepository.update(execution.id, {
          status: 'failed',
          errorLog: `Failed to write prd.json: ${err instanceof Error ? err.message : String(err)}`,
          completedAt: new Date().toISOString(),
        }, db);

        return {
          success: false,
          execution,
          error: `Failed to write prd.json: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      // Find ralph.sh script
      const ralphScript = findRalphScript(project.path);
      if (!ralphScript) {
        ExecutionRepository.update(execution.id, {
          status: 'failed',
          errorLog: 'ralph.sh script not found in project or standard locations',
          completedAt: new Date().toISOString(),
        }, db);

        return {
          success: false,
          execution,
          error: 'ralph.sh script not found',
        };
      }

      // Build command arguments
      const args: string[] = [];
      if (options.tool) {
        args.push('--tool', options.tool);
      }
      if (options.maxIterations) {
        args.push(String(options.maxIterations));
      }

      // Spawn the Ralph process
      const childProcess = spawn(ralphScript, args, {
        cwd: project.path,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      // Update execution with start info
      const now = new Date().toISOString();
      ExecutionRepository.update(execution.id, {
        status: 'running',
        startedAt: now,
      }, db);

      // Update task status
      TaskRepository.updateStatus(task.id, 'running', db);

      return {
        success: true,
        execution: {
          ...execution,
          pid: childProcess.pid ?? null,
          status: 'running',
          startedAt: now,
        },
        childProcess,
      };
    } finally {
      db.close();
    }
  },

  /**
   * Monitor a spawned Ralph process and collect results
   *
   * @param execution - The execution record
   * @param childProcess - The spawned child process
   * @returns Promise resolving to completion result
   */
  async monitor(execution: Execution, childProcess: ChildProcess): Promise<CompletionResult> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let iterationsUsed = 0;

      // Collect stdout
      childProcess.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;

        // Count iterations (Ralph outputs iteration markers)
        const iterationMatches = chunk.match(/iteration \d+/gi);
        if (iterationMatches) {
          iterationsUsed = Math.max(iterationsUsed, iterationMatches.length);
        }
      });

      // Collect stderr
      childProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle process exit
      childProcess.on('close', (code) => {
        const db = initDatabase();

        try {
          const completed = stdout.includes('<promise>COMPLETE</promise>');
          const success = code === 0 || completed;

          // Update execution record
          ExecutionRepository.update(execution.id, {
            status: success ? 'completed' : 'failed',
            ralphOutput: stdout,
            errorLog: stderr || undefined,
            exitCode: code ?? undefined,
            iterationsUsed,
            completedAt: new Date().toISOString(),
          }, db);

          // Update task status
          const task = TaskRepository.findById(execution.taskId, db);
          if (task) {
            TaskRepository.updateStatus(task.id, success ? 'completed' : 'failed', db);
          }

          resolve({
            success,
            completed,
            output: stdout,
            errorOutput: stderr,
            exitCode: code,
            iterationsUsed,
          });
        } finally {
          db.close();
        }
      });

      // Handle process error
      childProcess.on('error', (err) => {
        const db = initDatabase();

        try {
          ExecutionRepository.update(execution.id, {
            status: 'failed',
            errorLog: err.message,
            completedAt: new Date().toISOString(),
          }, db);

          const task = TaskRepository.findById(execution.taskId, db);
          if (task) {
            TaskRepository.updateStatus(task.id, 'failed', db);
          }

          resolve({
            success: false,
            completed: false,
            output: stdout,
            errorOutput: err.message,
            exitCode: null,
            iterationsUsed,
          });
        } finally {
          db.close();
        }
      });
    });
  },

  /**
   * Check if Ralph output indicates successful completion
   *
   * @param output - The stdout from Ralph
   * @returns True if '<promise>COMPLETE</promise>' was detected
   */
  isComplete(output: string): boolean {
    return output.includes('<promise>COMPLETE</promise>');
  },
};

/**
 * Find the ralph.sh script in the project or standard locations
 *
 * @param projectPath - Path to the project
 * @returns Path to ralph.sh or undefined if not found
 */
function findRalphScript(projectPath: string): string | undefined {
  // Check standard locations in order of preference
  const locations = [
    // Project-local locations
    path.join(projectPath, 'ralph.sh'),
    path.join(projectPath, 'scripts', 'ralph.sh'),
    path.join(projectPath, 'scripts', 'ralph', 'ralph.sh'),
    // User-level location
    path.join(process.env.HOME ?? '', 'ralph.sh'),
    path.join(process.env.HOME ?? '', 'scripts', 'ralph.sh'),
  ];

  for (const location of locations) {
    if (fs.existsSync(location)) {
      // Verify it's executable
      try {
        fs.accessSync(location, fs.constants.X_OK);
        return location;
      } catch {
        // Not executable, try to make it executable
        try {
          fs.chmodSync(location, 0o755);
          return location;
        } catch {
          // Can't make executable, skip this location
          continue;
        }
      }
    }
  }

  return undefined;
}
