/**
 * Ralph Command - Native Ralph execution without external scripts
 *
 * Spawns Claude Code CLI instances to execute Ralph loops autonomously.
 * Each iteration spawns a fresh Claude instance that reads prd.json,
 * implements a single user story, and updates progress.txt.
 *
 * Completion is detected via '<promise>COMPLETE</promise>' in output.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { type UserStory } from '../collaboration/prd-builder.js';

/**
 * PRD structure for Ralph execution
 */
export interface RalphPrd {
  project: string;
  branchName: string;
  description: string;
  userStories: UserStory[];
}

/**
 * Options for Ralph execution
 */
export interface RalphOptions {
  /** Maximum iterations before stopping (default: 10) */
  iterations?: number;
  /** Tool to use for execution (default: 'claude') */
  tool?: 'claude' | 'cursor';
  /** Enable parallel story execution (default: false) */
  parallel?: boolean;
  /** Maximum concurrent workers for parallel mode (default: 3) */
  maxWorkers?: number;
}

/**
 * Result of a single Ralph iteration
 */
export interface IterationResult {
  iteration: number;
  success: boolean;
  completed: boolean;
  storiesCompleted: number;
  output: string;
  errorOutput: string;
  exitCode: number | null;
  durationMs: number;
}

/**
 * Final result of Ralph execution
 */
export interface RalphResult {
  success: boolean;
  completed: boolean;
  iterationsUsed: number;
  storiesCompleted: number;
  totalStories: number;
  timeElapsedMs: number;
  error?: string;
  iterations: IterationResult[];
}

/**
 * Validate a prd.json file
 *
 * @param prdPath - Path to prd.json
 * @returns Parsed PRD or error
 */
export function validatePrd(prdPath: string): { valid: true; prd: RalphPrd } | { valid: false; error: string } {
  if (!fs.existsSync(prdPath)) {
    return { valid: false, error: `prd.json not found at ${prdPath}` };
  }

  try {
    const content = fs.readFileSync(prdPath, 'utf-8');
    const prd = JSON.parse(content) as RalphPrd;

    // Validate required fields
    if (!prd.project || typeof prd.project !== 'string') {
      return { valid: false, error: 'prd.json missing or invalid "project" field' };
    }
    if (!prd.branchName || typeof prd.branchName !== 'string') {
      return { valid: false, error: 'prd.json missing or invalid "branchName" field' };
    }
    if (!prd.description || typeof prd.description !== 'string') {
      return { valid: false, error: 'prd.json missing or invalid "description" field' };
    }
    if (!Array.isArray(prd.userStories)) {
      return { valid: false, error: 'prd.json missing or invalid "userStories" array' };
    }

    // Validate user stories
    for (const story of prd.userStories) {
      if (!story.id || typeof story.id !== 'string') {
        return { valid: false, error: `User story missing "id" field` };
      }
      if (!story.title || typeof story.title !== 'string') {
        return { valid: false, error: `User story ${story.id} missing "title" field` };
      }
      if (!Array.isArray(story.acceptanceCriteria)) {
        return { valid: false, error: `User story ${story.id} missing "acceptanceCriteria" array` };
      }
    }

    return { valid: true, prd };
  } catch (err) {
    return { valid: false, error: `Failed to parse prd.json: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Count completed stories in a PRD
 */
export function countCompletedStories(prd: RalphPrd): number {
  return prd.userStories.filter(story => story.passes === true).length;
}

/**
 * Check if all stories are complete
 */
export function allStoriesComplete(prd: RalphPrd): boolean {
  return prd.userStories.every(story => story.passes === true);
}

/**
 * Spawn a Claude CLI instance for one Ralph iteration
 *
 * @param projectPath - Path to the project
 * @param tool - CLI tool to use ('claude' or 'cursor')
 * @returns Child process
 */
function spawnClaudeCli(projectPath: string, tool: 'claude' | 'cursor'): ChildProcess {
  // Build the prompt that tells Claude to act as Ralph agent
  const ralphPrompt = `# Ralph Agent Instructions

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

  // Spawn the Claude CLI with the Ralph prompt
  const child = spawn(tool, ['--print', '--dangerously-skip-permissions', '-p', ralphPrompt], {
    cwd: projectPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  return child;
}

/**
 * Run a single Ralph iteration
 *
 * @param projectPath - Path to the project
 * @param iteration - Current iteration number
 * @param tool - CLI tool to use
 * @returns Iteration result
 */
async function runIteration(
  projectPath: string,
  iteration: number,
  tool: 'claude' | 'cursor'
): Promise<IterationResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const child = spawnClaudeCli(projectPath, tool);
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      // Stream output in real-time
      process.stdout.write(chunk);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      process.stderr.write(chunk);
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      const completed = stdout.includes('<promise>COMPLETE</promise>');

      // Re-read PRD to count completed stories
      const prdPath = path.join(projectPath, 'prd.json');
      const prdResult = validatePrd(prdPath);
      const storiesCompleted = prdResult.valid ? countCompletedStories(prdResult.prd) : 0;

      resolve({
        iteration,
        success: code === 0 || completed,
        completed,
        storiesCompleted,
        output: stdout,
        errorOutput: stderr,
        exitCode: code,
        durationMs,
      });
    });

    child.on('error', (err) => {
      const durationMs = Date.now() - startTime;
      resolve({
        iteration,
        success: false,
        completed: false,
        storiesCompleted: 0,
        output: stdout,
        errorOutput: err.message,
        exitCode: null,
        durationMs,
      });
    });
  });
}

/**
 * Execute Ralph loop - spawns Claude CLI iterations until complete or max iterations
 *
 * @param projectPath - Path to the project directory (default: current directory)
 * @param options - Execution options
 * @returns Final execution result
 */
export async function executeRalph(
  projectPath: string = process.cwd(),
  options: RalphOptions = {}
): Promise<RalphResult> {
  const {
    iterations: maxIterations = 10,
    tool = 'claude',
    parallel = false,
    maxWorkers = 3,
  } = options;

  const startTime = Date.now();
  const iterationResults: IterationResult[] = [];

  // Validate prd.json exists
  const prdPath = path.join(projectPath, 'prd.json');
  const prdResult = validatePrd(prdPath);

  if (!prdResult.valid) {
    return {
      success: false,
      completed: false,
      iterationsUsed: 0,
      storiesCompleted: 0,
      totalStories: 0,
      timeElapsedMs: Date.now() - startTime,
      error: prdResult.error,
      iterations: [],
    };
  }

  const prd = prdResult.prd;
  const totalStories = prd.userStories.length;

  console.log(`\nMetaRalph - Native Ralph Execution`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Project:      ${prd.project}`);
  console.log(`Branch:       ${prd.branchName}`);
  console.log(`Stories:      ${totalStories}`);
  console.log(`Max iters:    ${maxIterations}`);
  console.log(`Tool:         ${tool}`);
  console.log(`Parallel:     ${parallel ? `Yes (${maxWorkers} workers)` : 'No'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Check if already complete
  if (allStoriesComplete(prd)) {
    console.log(`✓ All stories already complete!`);
    return {
      success: true,
      completed: true,
      iterationsUsed: 0,
      storiesCompleted: totalStories,
      totalStories,
      timeElapsedMs: Date.now() - startTime,
      iterations: [],
    };
  }

  // Parallel mode is a placeholder for future implementation (US-004)
  if (parallel) {
    console.log(`⚠ Parallel mode not yet implemented. Running sequentially.`);
  }

  // Sequential execution loop
  for (let i = 1; i <= maxIterations; i++) {
    console.log(`\n──────────────────────────────────────────────────────────────`);
    console.log(`Iteration ${i}/${maxIterations}`);
    console.log(`──────────────────────────────────────────────────────────────\n`);

    const result = await runIteration(projectPath, i, tool);
    iterationResults.push(result);

    // Check for completion
    if (result.completed) {
      console.log(`\n✓ <promise>COMPLETE</promise> detected!`);

      // Final status
      const finalPrdResult = validatePrd(prdPath);
      const finalStoriesCompleted = finalPrdResult.valid
        ? countCompletedStories(finalPrdResult.prd)
        : result.storiesCompleted;

      return {
        success: true,
        completed: true,
        iterationsUsed: i,
        storiesCompleted: finalStoriesCompleted,
        totalStories,
        timeElapsedMs: Date.now() - startTime,
        iterations: iterationResults,
      };
    }

    // Check if iteration failed
    if (!result.success) {
      console.log(`\n⚠ Iteration ${i} failed with exit code ${result.exitCode}`);
      // Continue to next iteration - failures can be transient
    }

    // Re-check PRD to see if all stories are now complete
    const currentPrdResult = validatePrd(prdPath);
    if (currentPrdResult.valid && allStoriesComplete(currentPrdResult.prd)) {
      console.log(`\n✓ All stories complete (detected via prd.json check)`);

      return {
        success: true,
        completed: true,
        iterationsUsed: i,
        storiesCompleted: totalStories,
        totalStories,
        timeElapsedMs: Date.now() - startTime,
        iterations: iterationResults,
      };
    }
  }

  // Max iterations reached without completion
  const finalPrdResult = validatePrd(prdPath);
  const finalStoriesCompleted = finalPrdResult.valid
    ? countCompletedStories(finalPrdResult.prd)
    : 0;

  console.log(`\n⚠ Max iterations (${maxIterations}) reached without completion.`);
  console.log(`  Stories completed: ${finalStoriesCompleted}/${totalStories}`);

  return {
    success: false,
    completed: false,
    iterationsUsed: maxIterations,
    storiesCompleted: finalStoriesCompleted,
    totalStories,
    timeElapsedMs: Date.now() - startTime,
    iterations: iterationResults,
  };
}

/**
 * Format duration for display
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Display final summary
 */
export function displaySummary(result: RalphResult): void {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Ralph Execution Summary`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Status:           ${result.completed ? '✓ COMPLETE' : '✗ INCOMPLETE'}`);
  console.log(`Iterations used:  ${result.iterationsUsed}`);
  console.log(`Stories:          ${result.storiesCompleted}/${result.totalStories} completed`);
  console.log(`Time elapsed:     ${formatDuration(result.timeElapsedMs)}`);

  if (result.error) {
    console.log(`Error:            ${result.error}`);
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}
