/**
 * Ralph Spawner - Spawns and monitors Ralph worker processes
 *
 * Responsible for:
 * - Creating prd.json in the target project
 * - Spawning Claude CLI subprocess for native execution
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

      // Build the prompt that tells Claude to act as Ralph agent
      const ralphPrompt = buildRalphPrompt();

      // Determine the CLI tool to use
      const cliTool = options.tool ?? 'claude';

      // Build command arguments for Claude CLI
      const args: string[] = ['--print', '--dangerously-skip-permissions', '-p', ralphPrompt];

      // Spawn the Claude CLI process
      const childProcess = spawn(cliTool, args, {
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
      // Each spawn() call is a single iteration in native mode
      const iterationsUsed = 1;

      // Collect stdout
      childProcess.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
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
 * Build the Ralph agent prompt for Claude CLI
 *
 * This prompt instructs Claude to act as an autonomous Ralph agent,
 * reading prd.json, implementing the next user story, and tracking progress.
 *
 * @returns The Ralph agent prompt string
 */
function buildRalphPrompt(): string {
  return `# Ralph Agent Instructions

You are an autonomous coding agent working on a software project.

## Your Task

1. Read the PRD at \`prd.json\` (in the same directory as this file)
2. Read the progress log at \`progress.txt\` (check Codebase Patterns section first)
3. Check you're on the correct branch from PRD \`branchName\`. If not, check it out or create from main.
4. Pick the **highest priority** user story where \`passes: false\`
5. Implement that single user story
6. Run quality checks (e.g., typecheck, lint, test - use whatever your project requires)
7. Update AGENTS.md files if you discover reusable patterns (see below)
8. If checks pass, commit ALL changes with message: \`feat: [Story ID] - [Story Title]\`
9. Update the PRD to set \`passes: true\` for the completed story
10. Append your progress to \`progress.txt\`

## Progress Report Format

APPEND to progress.txt (never replace, always append):
\`\`\`
## [Date/Time] - [Story ID]
- What was implemented
- Files changed
- **Learnings for future iterations:**
  - Patterns discovered (e.g., "this codebase uses X for Y")
  - Gotchas encountered (e.g., "don't forget to update Z when changing W")
  - Useful context (e.g., "the evaluation panel is in component X")
---
\`\`\`

The learnings section is critical - it helps future iterations avoid repeating mistakes and understand the codebase better.

## Consolidate Patterns

If you discover a **reusable pattern** that future iterations should know, add it to the \`## Codebase Patterns\` section at the TOP of progress.txt (create it if it doesn't exist). This section should consolidate the most important learnings:

\`\`\`
## Codebase Patterns
- Example: Use \`sql<number>\` template for aggregations
- Example: Always use \`IF NOT EXISTS\` for migrations
- Example: Export types from actions.ts for UI components
\`\`\`

Only add patterns that are **general and reusable**, not story-specific details.

## Quality Requirements

- ALL commits must pass your project's quality checks (typecheck, lint, test)
- Do NOT commit broken code
- Keep changes focused and minimal
- Follow existing code patterns

## Stop Condition

After completing a user story, check if ALL stories have \`passes: true\`.

If ALL stories are complete and passing, reply with:
<promise>COMPLETE</promise>

If there are still stories with \`passes: false\`, end your response normally (another iteration will pick up the next story).

## Important

- Work on ONE story per iteration
- Commit frequently
- Keep CI green
- Read the Codebase Patterns section in progress.txt before starting`;
}
