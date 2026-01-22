/**
 * Parallel Scheduler - Orchestrates parallel Claude Code workers
 *
 * Uses DependencyAnalyzer to determine which stories can run concurrently,
 * spawns up to maxWorkers Claude Code instances, and tracks completion/failure.
 * When a story completes, newly ready stories are scheduled.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { DependencyAnalyzer, type StoryStatus } from './dependency-analyzer.js';
import { type UserStory } from '../collaboration/prd-builder.js';
import { type RalphPrd } from '../cli/ralph.js';

/**
 * Worker state tracking
 */
export interface WorkerState {
  workerId: string;
  storyId: string;
  story: UserStory;
  status: 'running' | 'completed' | 'failed';
  childProcess?: ChildProcess;
  startedAt: number;
  completedAt?: number;
  output: string;
  errorOutput: string;
  exitCode?: number | null;
}

/**
 * Story execution state
 */
export interface StoryExecutionState {
  storyId: string;
  status: StoryStatus;
  workerId?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

/**
 * Scheduler status snapshot
 */
export interface SchedulerStatus {
  totalStories: number;
  completed: number;
  failed: number;
  skipped: number;
  running: number;
  queued: number;
  activeWorkers: WorkerState[];
}

/**
 * Final execution summary
 */
export interface ParallelExecutionSummary {
  success: boolean;
  completed: boolean;
  totalStories: number;
  storiesCompleted: number;
  storiesFailed: number;
  storiesSkipped: number;
  totalTimeMs: number;
  batchesExecuted: number;
  maxConcurrency: number;
}

/**
 * Configuration for ParallelScheduler
 */
export interface ParallelSchedulerConfig {
  /** Maximum concurrent workers (default: 3) */
  maxWorkers?: number;
  /** CLI tool to use (default: 'claude') */
  tool?: 'claude' | 'cursor';
  /** Project path */
  projectPath: string;
  /** PRD data */
  prd: RalphPrd;
}

/**
 * Events emitted by ParallelScheduler
 */
export interface ParallelSchedulerEvents {
  'worker:started': (worker: WorkerState) => void;
  'worker:completed': (worker: WorkerState) => void;
  'worker:failed': (worker: WorkerState) => void;
  'batch:completed': (batchNumber: number, storiesCompleted: string[]) => void;
  'story:skipped': (storyId: string, reason: string) => void;
}

/**
 * ParallelScheduler - Orchestrates parallel story execution
 */
export class ParallelScheduler extends EventEmitter {
  private config: Required<Omit<ParallelSchedulerConfig, 'prd'>> & { prd: RalphPrd };
  private analyzer: DependencyAnalyzer;
  private workers: Map<string, WorkerState> = new Map();
  private storyStates: Map<string, StoryExecutionState> = new Map();
  private completedStories: Set<string> = new Set();
  private failedStories: Set<string> = new Set();
  private skippedStories: Set<string> = new Set();
  private nextWorkerId = 1;
  private batchesExecuted = 0;
  private maxConcurrencyReached = 0;
  private startTime = 0;

  constructor(config: ParallelSchedulerConfig) {
    super();
    this.config = {
      maxWorkers: config.maxWorkers ?? 3,
      tool: config.tool ?? 'claude',
      projectPath: config.projectPath,
      prd: config.prd,
    };
    this.analyzer = new DependencyAnalyzer(config.prd.userStories);

    // Initialize story states
    for (const story of config.prd.userStories) {
      this.storyStates.set(story.id, {
        storyId: story.id,
        status: story.passes ? 'completed' : 'pending',
      });

      // Mark already-passing stories as completed
      if (story.passes) {
        this.completedStories.add(story.id);
      }
    }
  }

  /**
   * Run parallel execution until all stories complete or fail
   *
   * @returns Execution summary
   */
  async run(): Promise<ParallelExecutionSummary> {
    this.startTime = Date.now();
    this.batchesExecuted = 0;
    this.maxConcurrencyReached = 0;

    // Main scheduling loop
    while (!this.isComplete()) {
      // Get stories ready to run (dependencies satisfied)
      const readyStories = this.analyzer.getReadyStories(
        this.completedStories,
        this.failedStories
      );

      // Filter out already running stories
      const runningStoryIds = new Set(
        Array.from(this.workers.values())
          .filter(w => w.status === 'running')
          .map(w => w.storyId)
      );

      const storiesNotRunning = readyStories.filter(
        s => !runningStoryIds.has(s.id) && !this.skippedStories.has(s.id)
      );

      // Calculate available slots
      const runningCount = Array.from(this.workers.values())
        .filter(w => w.status === 'running').length;
      const availableSlots = this.config.maxWorkers - runningCount;

      // Spawn workers for ready stories
      const storiesToSpawn = storiesNotRunning.slice(0, availableSlots);

      if (storiesToSpawn.length > 0) {
        this.batchesExecuted++;
        for (const story of storiesToSpawn) {
          this.spawnWorker(story);
        }
      }

      // Track max concurrency
      const currentConcurrency = Array.from(this.workers.values())
        .filter(w => w.status === 'running').length;
      if (currentConcurrency > this.maxConcurrencyReached) {
        this.maxConcurrencyReached = currentConcurrency;
      }

      // Wait for at least one worker to complete
      if (runningCount > 0 || storiesToSpawn.length > 0) {
        await this.waitForWorkerCompletion();
      } else {
        // No workers running and no stories to spawn - check for blocked stories
        this.markBlockedStoriesSkipped();
        break;
      }
    }

    return this.buildSummary();
  }

  /**
   * Get current scheduler status
   */
  getStatus(): SchedulerStatus {
    const activeWorkers = Array.from(this.workers.values())
      .filter(w => w.status === 'running');

    return {
      totalStories: this.analyzer.storyCount,
      completed: this.completedStories.size,
      failed: this.failedStories.size,
      skipped: this.skippedStories.size,
      running: activeWorkers.length,
      queued: this.analyzer.getReadyStories(this.completedStories, this.failedStories)
        .filter(s =>
          !Array.from(this.workers.values()).some(w => w.storyId === s.id && w.status === 'running') &&
          !this.skippedStories.has(s.id)
        ).length,
      activeWorkers,
    };
  }

  /**
   * Spawn a worker for a story
   */
  private spawnWorker(story: UserStory): void {
    const workerId = `worker-${this.nextWorkerId++}`;

    // Update story state
    this.storyStates.set(story.id, {
      storyId: story.id,
      status: 'running',
      workerId,
      startedAt: Date.now(),
    });

    // Create worker state
    const workerState: WorkerState = {
      workerId,
      storyId: story.id,
      story,
      status: 'running',
      startedAt: Date.now(),
      output: '',
      errorOutput: '',
    };

    // Build prompt for this specific story
    const prompt = this.buildWorkerPrompt(story);

    // Spawn Claude CLI process
    const childProcess = spawn(this.config.tool, [
      '--print',
      '--dangerously-skip-permissions',
      '-p',
      prompt,
    ], {
      cwd: this.config.projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    workerState.childProcess = childProcess;
    this.workers.set(workerId, workerState);

    // Collect output
    childProcess.stdout?.on('data', (data: Buffer) => {
      workerState.output += data.toString();
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      workerState.errorOutput += data.toString();
    });

    // Handle completion
    childProcess.on('close', (code) => {
      this.handleWorkerCompletion(workerId, code);
    });

    childProcess.on('error', (err) => {
      this.handleWorkerError(workerId, err);
    });

    // Emit event
    this.emit('worker:started', workerState);
  }

  /**
   * Handle worker completion
   */
  private handleWorkerCompletion(workerId: string, exitCode: number | null): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    worker.completedAt = Date.now();
    worker.exitCode = exitCode;

    // Check if story was completed (look for markers in output or re-read PRD)
    const completed = this.checkStoryCompletion(worker);

    if (completed) {
      worker.status = 'completed';
      this.completedStories.add(worker.storyId);
      this.storyStates.set(worker.storyId, {
        storyId: worker.storyId,
        status: 'completed',
        workerId,
        startedAt: worker.startedAt,
        completedAt: worker.completedAt,
      });
      this.emit('worker:completed', worker);
    } else {
      worker.status = 'failed';
      this.failedStories.add(worker.storyId);
      this.storyStates.set(worker.storyId, {
        storyId: worker.storyId,
        status: 'failed',
        workerId,
        startedAt: worker.startedAt,
        completedAt: worker.completedAt,
        error: worker.errorOutput || `Exit code: ${exitCode}`,
      });
      this.emit('worker:failed', worker);

      // Mark dependent stories as skipped
      this.skipDependentStories(worker.storyId);
    }
  }

  /**
   * Handle worker error
   */
  private handleWorkerError(workerId: string, error: Error): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    worker.completedAt = Date.now();
    worker.status = 'failed';
    worker.errorOutput += error.message;

    this.failedStories.add(worker.storyId);
    this.storyStates.set(worker.storyId, {
      storyId: worker.storyId,
      status: 'failed',
      workerId,
      startedAt: worker.startedAt,
      completedAt: worker.completedAt,
      error: error.message,
    });

    this.emit('worker:failed', worker);

    // Mark dependent stories as skipped
    this.skipDependentStories(worker.storyId);
  }

  /**
   * Check if a story was completed successfully
   */
  private checkStoryCompletion(worker: WorkerState): boolean {
    // First check for explicit completion marker
    if (worker.output.includes('<promise>COMPLETE</promise>')) {
      return true;
    }

    // Re-read prd.json to check if story now passes
    const prdPath = path.join(this.config.projectPath, 'prd.json');
    try {
      const content = fs.readFileSync(prdPath, 'utf-8');
      const prd = JSON.parse(content) as RalphPrd;
      const story = prd.userStories.find(s => s.id === worker.storyId);
      return story?.passes === true;
    } catch {
      return false;
    }
  }

  /**
   * Skip stories that depend on a failed story
   */
  private skipDependentStories(failedStoryId: string): void {
    const dependents = this.analyzer.getDependents(failedStoryId);

    for (const depId of dependents) {
      if (!this.completedStories.has(depId) && !this.failedStories.has(depId) && !this.skippedStories.has(depId)) {
        this.skippedStories.add(depId);
        this.storyStates.set(depId, {
          storyId: depId,
          status: 'skipped',
          error: `Dependency ${failedStoryId} failed`,
        });
        this.emit('story:skipped', depId, `Dependency ${failedStoryId} failed`);

        // Recursively skip dependents
        this.skipDependentStories(depId);
      }
    }
  }

  /**
   * Mark stories blocked by cycles or missing deps as skipped
   */
  private markBlockedStoriesSkipped(): void {
    for (const story of this.analyzer.getAllStories()) {
      if (!this.completedStories.has(story.id) &&
          !this.failedStories.has(story.id) &&
          !this.skippedStories.has(story.id)) {
        this.skippedStories.add(story.id);
        this.storyStates.set(story.id, {
          storyId: story.id,
          status: 'skipped',
          error: 'Blocked by unresolved dependencies',
        });
        this.emit('story:skipped', story.id, 'Blocked by unresolved dependencies');
      }
    }
  }

  /**
   * Wait for at least one worker to complete
   */
  private waitForWorkerCompletion(): Promise<void> {
    return new Promise((resolve) => {
      const checkComplete = () => {
        const hasRunning = Array.from(this.workers.values())
          .some(w => w.status === 'running');

        if (!hasRunning) {
          resolve();
          return;
        }

        // Check if any worker just completed
        const justCompleted = Array.from(this.workers.values())
          .filter(w => w.status !== 'running' && w.completedAt && w.completedAt > this.startTime);

        if (justCompleted.length > 0) {
          resolve();
          return;
        }

        // Poll every 100ms
        setTimeout(checkComplete, 100);
      };

      checkComplete();
    });
  }

  /**
   * Check if execution is complete
   */
  private isComplete(): boolean {
    const processed = this.completedStories.size + this.failedStories.size + this.skippedStories.size;
    return processed >= this.analyzer.storyCount;
  }

  /**
   * Build summary of execution
   */
  private buildSummary(): ParallelExecutionSummary {
    const totalTimeMs = Date.now() - this.startTime;
    const allSucceeded = this.failedStories.size === 0 && this.skippedStories.size === 0;

    // Check if all originally non-passing stories are now complete
    const originalIncomplete = this.config.prd.userStories.filter(s => !s.passes);
    const completed = originalIncomplete.every(s => this.completedStories.has(s.id));

    return {
      success: allSucceeded,
      completed,
      totalStories: this.analyzer.storyCount,
      storiesCompleted: this.completedStories.size,
      storiesFailed: this.failedStories.size,
      storiesSkipped: this.skippedStories.size,
      totalTimeMs,
      batchesExecuted: this.batchesExecuted,
      maxConcurrency: this.maxConcurrencyReached,
    };
  }

  /**
   * Build prompt for a single story worker
   */
  private buildWorkerPrompt(story: UserStory): string {
    return `# Ralph Agent Instructions - Single Story Mode

You are an autonomous coding agent working on a single user story.

## Your Story

Story ID: ${story.id}
Title: ${story.title}
Description: ${story.description}

### Acceptance Criteria:
${story.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${story.notes ? `### Notes:\n${story.notes}\n` : ''}

## Your Task

1. Read the PRD at \`prd.json\` for project context
2. Read the progress log at \`progress.txt\` (check Codebase Patterns section first)
3. Check you're on the correct branch from PRD \`branchName\`. If not, check it out or create from main.
4. **Implement ONLY story ${story.id}** - do not work on other stories
5. Run quality checks (e.g., typecheck, lint, test - use whatever your project requires)
6. If checks pass, commit ALL changes with message: \`feat: [${story.id}] - ${story.title}\`
7. Update the PRD to set \`passes: true\` for story ${story.id}
8. Append your progress to \`progress.txt\`

## Progress Report Format

APPEND to progress.txt (never replace, always append):
\`\`\`
## [Date/Time] - ${story.id}
- What was implemented
- Files changed
- **Learnings for future iterations:**
  - Patterns discovered (e.g., "this codebase uses X for Y")
  - Gotchas encountered (e.g., "don't forget to update Z when changing W")
  - Useful context (e.g., "the evaluation panel is in component X")
---
\`\`\`

## Stop Condition

After completing story ${story.id}, check if ALL stories in prd.json have \`passes: true\`.

If ALL stories are complete, reply with:
<promise>COMPLETE</promise>

Otherwise, end normally (another worker is handling other stories).

## Important

- Work ONLY on story ${story.id}
- Commit frequently
- Keep CI green
- Do NOT modify other stories
- Read the Codebase Patterns section in progress.txt before starting`;
  }
}
