/**
 * Loop Runner - Spawns and monitors Ralph loop processes
 *
 * Responsible for:
 * - Starting Ralph loops as subprocess
 * - Capturing output and storing in loop_iterations
 * - Tracking completion via '<promise>COMPLETE</promise>'
 * - Handling pause/stop controls
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getProject, type Project } from '../registry/index.js';
import { initDatabase } from '../db/index.js';
import {
  LoopRepository,
  LoopIterationRepository,
  type Loop,
  type LoopIteration,
} from './repository.js';

/**
 * Result of starting a loop
 */
export interface StartLoopResult {
  success: boolean;
  loop?: Loop;
  childProcess?: ChildProcess;
  error?: string;
}

/**
 * Options for starting a loop
 */
export interface StartLoopOptions {
  tool?: 'claude' | 'cursor';
}

/**
 * Active loop process tracking
 */
interface ActiveLoop {
  loop: Loop;
  childProcess: ChildProcess;
  currentIteration: LoopIteration | null;
  output: string;
  paused: boolean;
}

/**
 * Map of active loop processes by loop ID
 */
const activeLoops = new Map<string, ActiveLoop>();

/**
 * LoopRunner - Manages Ralph loop execution
 */
export const LoopRunner = {
  /**
   * Start a Ralph loop for a project
   *
   * @param loopId - The loop ID to start
   * @param options - Start options
   * @returns StartLoopResult with child process if successful
   */
  start(loopId: string, options: StartLoopOptions = {}): StartLoopResult {
    const db = initDatabase();

    try {
      // Find the loop
      const loop = LoopRepository.findById(loopId, db);
      if (!loop) {
        return {
          success: false,
          error: `Loop not found: ${loopId}`,
        };
      }

      // Check if loop is already running
      if (loop.status === 'running') {
        return {
          success: false,
          loop,
          error: 'Loop is already running',
        };
      }

      // Get the project
      const project = getProject(loop.projectId, db);
      if (!project) {
        return {
          success: false,
          loop,
          error: `Project not found: ${loop.projectId}`,
        };
      }

      // Verify PRD file exists
      const prdPath = path.join(project.path, loop.prdPath);
      if (!fs.existsSync(prdPath)) {
        return {
          success: false,
          loop,
          error: `PRD file not found: ${prdPath}`,
        };
      }

      // Find ralph.sh script
      const ralphScript = findRalphScript(project.path);
      if (!ralphScript) {
        return {
          success: false,
          loop,
          error: 'ralph.sh script not found in project or standard locations',
        };
      }

      // Build command arguments
      const args: string[] = [];
      if (options.tool) {
        args.push('--tool', options.tool);
      }
      args.push(String(loop.maxIterations));

      // Spawn the Ralph process
      const childProcess = spawn(ralphScript, args, {
        cwd: project.path,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      // Update loop status to running
      LoopRepository.updateStatus(loopId, 'running', db);

      // Track this active loop
      const activeLoop: ActiveLoop = {
        loop: { ...loop, status: 'running' },
        childProcess,
        currentIteration: null,
        output: '',
        paused: false,
      };
      activeLoops.set(loopId, activeLoop);

      // Set up output monitoring
      monitorLoopProcess(loopId, childProcess, project);

      return {
        success: true,
        loop: activeLoop.loop,
        childProcess,
      };
    } finally {
      db.close();
    }
  },

  /**
   * Pause a running loop (takes effect after current iteration)
   *
   * @param loopId - The loop ID to pause
   * @returns Success status
   */
  pause(loopId: string): boolean {
    const activeLoop = activeLoops.get(loopId);
    if (!activeLoop) {
      return false;
    }

    // Mark as paused - will stop after current iteration
    activeLoop.paused = true;
    LoopRepository.updateStatus(loopId, 'paused');
    return true;
  },

  /**
   * Resume a paused loop
   *
   * @param loopId - The loop ID to resume
   * @param options - Start options
   * @returns StartLoopResult
   */
  resume(loopId: string, options: StartLoopOptions = {}): StartLoopResult {
    const db = initDatabase();

    try {
      const loop = LoopRepository.findById(loopId, db);
      if (!loop) {
        return {
          success: false,
          error: `Loop not found: ${loopId}`,
        };
      }

      if (loop.status !== 'paused') {
        return {
          success: false,
          loop,
          error: `Loop is not paused (status: ${loop.status})`,
        };
      }

      // Resume by starting again (Ralph will continue from where it left off via prd.json)
      return this.start(loopId, options);
    } finally {
      db.close();
    }
  },

  /**
   * Stop a running loop immediately
   *
   * @param loopId - The loop ID to stop
   * @param reason - Optional reason for stopping
   * @returns Success status
   */
  stop(loopId: string, reason?: string): boolean {
    const activeLoop = activeLoops.get(loopId);
    if (activeLoop) {
      // Kill the process
      activeLoop.childProcess.kill('SIGTERM');
      activeLoops.delete(loopId);
    }

    // Update status in database
    const db = initDatabase();
    try {
      const loop = LoopRepository.findById(loopId, db);
      if (loop && (loop.status === 'running' || loop.status === 'paused')) {
        LoopRepository.updateStatus(loopId, 'stopped', db);

        // If there's a current iteration, mark it as failed
        const iterations = LoopIterationRepository.findByLoop(loopId, db);
        const runningIteration = iterations.find(i => i.status === 'running');
        if (runningIteration) {
          LoopIterationRepository.update(runningIteration.id, {
            status: 'failed',
            output: reason ? `Stopped: ${reason}` : 'Stopped by user',
          }, db);
        }

        return true;
      }
    } finally {
      db.close();
    }

    return false;
  },

  /**
   * Get active loop info
   *
   * @param loopId - The loop ID
   * @returns Active loop info or undefined
   */
  getActive(loopId: string): ActiveLoop | undefined {
    return activeLoops.get(loopId);
  },

  /**
   * Check if a loop is actively running
   *
   * @param loopId - The loop ID
   * @returns True if the loop has an active process
   */
  isRunning(loopId: string): boolean {
    return activeLoops.has(loopId);
  },
};

/**
 * Monitor a loop process and update iterations
 */
function monitorLoopProcess(
  loopId: string,
  childProcess: ChildProcess,
  project: Project
): void {
  let currentIterationNum = 0;
  let iterationOutput = '';
  let currentIterationId: string | null = null;

  // Collect stdout
  childProcess.stdout?.on('data', (data: Buffer) => {
    const chunk = data.toString();
    const activeLoop = activeLoops.get(loopId);
    if (activeLoop) {
      activeLoop.output += chunk;
    }
    iterationOutput += chunk;

    // Detect iteration start
    const iterationMatch = chunk.match(/Ralph Iteration (\d+) of (\d+)/);
    if (iterationMatch) {
      const iterationNum = parseInt(iterationMatch[1], 10);

      // If we were tracking a previous iteration, complete it
      if (currentIterationId && currentIterationNum < iterationNum) {
        completeIteration(currentIterationId, iterationOutput);
      }

      // Start new iteration
      currentIterationNum = iterationNum;
      iterationOutput = chunk;
      currentIterationId = startIteration(loopId, iterationNum);

      // Update loop current iteration
      LoopRepository.updateCurrentIteration(loopId, iterationNum);
    }

    // Detect story being worked on
    const storyMatch = chunk.match(/Working on (US-\d+)/i) ||
                       chunk.match(/story.*?(US-\d+)/i) ||
                       chunk.match(/"id":\s*"(US-\d+)"/);
    if (storyMatch && currentIterationId) {
      const db = initDatabase();
      try {
        LoopIterationRepository.update(currentIterationId, {
          storyId: storyMatch[1],
        }, db);
      } finally {
        db.close();
      }
    }

    // Detect commit
    const commitMatch = chunk.match(/\[([a-f0-9]{7,40})\]/) ||
                        chunk.match(/commit ([a-f0-9]{7,40})/i);
    if (commitMatch && currentIterationId) {
      const db = initDatabase();
      try {
        LoopIterationRepository.update(currentIterationId, {
          commitSha: commitMatch[1],
        }, db);
      } finally {
        db.close();
      }
    }
  });

  // Collect stderr
  childProcess.stderr?.on('data', (data: Buffer) => {
    iterationOutput += data.toString();
  });

  // Handle process exit
  childProcess.on('close', (code) => {
    const activeLoop = activeLoops.get(loopId);
    const completed = activeLoop?.output.includes('<promise>COMPLETE</promise>') ?? false;
    const wasPaused = activeLoop?.paused ?? false;

    // Complete the current iteration if any
    if (currentIterationId) {
      completeIteration(
        currentIterationId,
        iterationOutput,
        code === 0 || completed ? 'completed' : 'failed'
      );
    }

    // Update loop status
    const db = initDatabase();
    try {
      if (completed) {
        LoopRepository.updateStatus(loopId, 'completed', db);
      } else if (wasPaused) {
        // Already marked as paused, leave it
      } else if (code !== 0) {
        LoopRepository.updateStatus(loopId, 'failed', db);
      } else {
        // Reached max iterations without completing
        LoopRepository.updateStatus(loopId, 'completed', db);
      }
    } finally {
      db.close();
    }

    // Remove from active loops
    activeLoops.delete(loopId);
  });

  // Handle process error
  childProcess.on('error', (err) => {
    if (currentIterationId) {
      completeIteration(currentIterationId, `Error: ${err.message}`, 'failed');
    }

    LoopRepository.updateStatus(loopId, 'failed');
    activeLoops.delete(loopId);
  });
}

/**
 * Start tracking a new iteration
 */
function startIteration(loopId: string, iterationNumber: number): string {
  const db = initDatabase();
  try {
    const iteration = LoopIterationRepository.create(loopId, iterationNumber, db);
    return iteration.id;
  } finally {
    db.close();
  }
}

/**
 * Complete an iteration with output
 */
function completeIteration(
  iterationId: string,
  output: string,
  status: 'completed' | 'failed' = 'completed'
): void {
  const db = initDatabase();
  try {
    LoopIterationRepository.update(iterationId, {
      status,
      output: output.slice(-10000), // Keep last 10KB of output
    }, db);
  } finally {
    db.close();
  }
}

/**
 * Find the ralph.sh script in the project or standard locations
 */
function findRalphScript(projectPath: string): string | undefined {
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
      try {
        fs.accessSync(location, fs.constants.X_OK);
        return location;
      } catch {
        try {
          fs.chmodSync(location, 0o755);
          return location;
        } catch {
          continue;
        }
      }
    }
  }

  return undefined;
}
