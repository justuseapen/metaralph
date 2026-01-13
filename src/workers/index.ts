/**
 * Worker Orchestrator - Manages concurrent Ralph worker execution
 *
 * Enforces concurrency limits (maxConcurrentWorkers from config)
 * and ensures only one worker per project at a time.
 */

import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { type Task, TaskRepository } from '../queue/task.js';
import { type Project, getProject } from '../registry/index.js';
import { type Execution, ExecutionRepository } from './execution.js';
import { RalphSpawner, type CompletionResult } from './ralph-spawner.js';
import {
  FailureHandler,
  calculateBackoffDelay,
  MAX_RETRIES,
} from './failure-handler.js';
import { loadConfig } from '../utils/config.js';
import { initDatabase, type DatabaseInstance } from '../db/index.js';

/**
 * Represents an active worker with its associated metadata
 */
export interface ActiveWorker {
  /** The task being executed */
  task: Task;
  /** The project the task belongs to */
  project: Project;
  /** The execution record */
  execution: Execution;
  /** The child process running Ralph */
  childProcess: ChildProcess;
  /** Timestamp when the worker started */
  startedAt: Date;
  /** Promise that resolves when the worker completes */
  completionPromise: Promise<CompletionResult>;
}

/**
 * Status information for a worker
 */
export interface WorkerStatus {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  executionId: string;
  pid: number | null;
  startedAt: Date;
  elapsedSeconds: number;
}

/**
 * Result of scheduling a task
 */
export interface ScheduleResult {
  success: boolean;
  message: string;
  worker?: ActiveWorker;
}

/**
 * Events emitted by the WorkerOrchestrator
 */
export interface WorkerOrchestratorEvents {
  'worker:started': (worker: ActiveWorker) => void;
  'worker:completed': (task: Task, result: CompletionResult) => void;
  'worker:failed': (task: Task, error: string) => void;
  'worker:retry': (task: Task, retryNumber: number, delayMs: number) => void;
}

/**
 * WorkerOrchestrator - Manages concurrent Ralph worker processes
 */
export class WorkerOrchestrator extends EventEmitter {
  private activeWorkers: Map<string, ActiveWorker> = new Map();
  private projectLocks: Set<string> = new Set();
  private failureHandler: FailureHandler;
  private maxConcurrentWorkers: number;

  constructor() {
    super();
    this.failureHandler = new FailureHandler();
    const config = loadConfig();
    this.maxConcurrentWorkers = config.maxConcurrentWorkers;
  }

  /**
   * Get the number of currently active workers
   */
  getActiveWorkerCount(): number {
    return this.activeWorkers.size;
  }

  /**
   * Get the maximum allowed concurrent workers
   */
  getMaxWorkers(): number {
    return this.maxConcurrentWorkers;
  }

  /**
   * Check if there's capacity for more workers
   */
  hasCapacity(): boolean {
    return this.activeWorkers.size < this.maxConcurrentWorkers;
  }

  /**
   * Check if a project currently has an active worker
   *
   * @param projectId - The project ID to check
   */
  isProjectBusy(projectId: string): boolean {
    return this.projectLocks.has(projectId);
  }

  /**
   * Get status of all active workers
   */
  getWorkerStatuses(): WorkerStatus[] {
    const now = Date.now();
    const statuses: WorkerStatus[] = [];

    for (const worker of this.activeWorkers.values()) {
      statuses.push({
        taskId: worker.task.id,
        taskTitle: worker.task.title,
        projectId: worker.project.id,
        projectName: worker.project.name,
        executionId: worker.execution.id,
        pid: worker.execution.pid,
        startedAt: worker.startedAt,
        elapsedSeconds: Math.floor((now - worker.startedAt.getTime()) / 1000),
      });
    }

    return statuses;
  }

  /**
   * Get a specific worker by task ID
   */
  getWorker(taskId: string): ActiveWorker | undefined {
    return this.activeWorkers.get(taskId);
  }

  /**
   * Schedule a task for execution
   *
   * Checks capacity and project locks before spawning a worker.
   *
   * @param task - The task to execute
   * @returns Result indicating success or failure
   */
  async scheduleTask(task: Task): Promise<ScheduleResult> {
    // Check capacity
    if (!this.hasCapacity()) {
      return {
        success: false,
        message: `No capacity available (${this.activeWorkers.size}/${this.maxConcurrentWorkers} workers active)`,
      };
    }

    // Get project
    const project = getProject(task.projectId);
    if (!project) {
      return {
        success: false,
        message: `Project not found: ${task.projectId}`,
      };
    }

    // Check if project is already busy
    if (this.isProjectBusy(task.projectId)) {
      return {
        success: false,
        message: `Project ${project.name} already has an active worker`,
      };
    }

    // Lock the project
    this.projectLocks.add(task.projectId);

    // Spawn the Ralph worker
    const spawnResult = RalphSpawner.spawn(task, project, {
      tool: 'claude',
      maxIterations: 10,
    });

    if (!spawnResult.success || !spawnResult.childProcess) {
      // Release project lock on failure
      this.projectLocks.delete(task.projectId);
      return {
        success: false,
        message: spawnResult.error ?? 'Failed to spawn Ralph worker',
      };
    }

    // Create active worker entry
    const completionPromise = RalphSpawner.monitor(
      spawnResult.execution,
      spawnResult.childProcess
    );

    const worker: ActiveWorker = {
      task,
      project,
      execution: spawnResult.execution,
      childProcess: spawnResult.childProcess,
      startedAt: new Date(),
      completionPromise,
    };

    // Store the worker
    this.activeWorkers.set(task.id, worker);

    // Emit started event
    this.emit('worker:started', worker);

    // Monitor for completion
    this.monitorWorker(worker);

    return {
      success: true,
      message: `Worker started for task "${task.title}" in project "${project.name}"`,
      worker,
    };
  }

  /**
   * Monitor a worker for completion and handle results
   */
  private async monitorWorker(worker: ActiveWorker): Promise<void> {
    try {
      const result = await worker.completionPromise;

      // Remove worker and release project lock
      this.activeWorkers.delete(worker.task.id);
      this.projectLocks.delete(worker.project.id);

      if (result.success) {
        // Handle success
        this.failureHandler.handleSuccess(worker.task.id);
        this.emit('worker:completed', worker.task, result);
      } else {
        // Handle failure - determine if we should retry
        const failureResult = this.failureHandler.handleFailedExecution(
          worker.task,
          worker.execution,
          result.errorOutput || 'Unknown error'
        );

        if (failureResult.shouldRetry) {
          // Schedule retry after delay
          this.emit(
            'worker:retry',
            worker.task,
            failureResult.retryNumber,
            failureResult.delayMs
          );

          // Reset task for retry
          this.failureHandler.resetForRetry(worker.task.id);

          // Schedule retry after backoff delay
          setTimeout(() => {
            // Re-fetch task to get updated state
            const db = initDatabase();
            try {
              const updatedTask = TaskRepository.findById(worker.task.id, db);
              if (updatedTask && updatedTask.status === 'queued') {
                this.scheduleTask(updatedTask).catch((err) => {
                  console.error('Retry scheduling failed:', err);
                });
              }
            } finally {
              db.close();
            }
          }, failureResult.delayMs);
        } else {
          // No more retries - mark as permanently failed
          this.failureHandler.markFailed(worker.task.id);
          this.emit('worker:failed', worker.task, failureResult.message);
        }
      }
    } catch (err) {
      // Unexpected error - clean up
      this.activeWorkers.delete(worker.task.id);
      this.projectLocks.delete(worker.project.id);

      const errorMessage = err instanceof Error ? err.message : String(err);
      this.failureHandler.markFailed(worker.task.id);
      this.emit('worker:failed', worker.task, `Unexpected error: ${errorMessage}`);
    }
  }

  /**
   * Stop a specific worker by task ID
   *
   * @param taskId - The task ID of the worker to stop
   * @returns True if worker was stopped
   */
  stopWorker(taskId: string): boolean {
    const worker = this.activeWorkers.get(taskId);
    if (!worker) {
      return false;
    }

    // Kill the child process
    if (worker.childProcess && !worker.childProcess.killed) {
      worker.childProcess.kill('SIGTERM');
    }

    // Clean up
    this.activeWorkers.delete(taskId);
    this.projectLocks.delete(worker.project.id);

    // Update task status
    TaskRepository.updateStatus(taskId, 'failed');

    return true;
  }

  /**
   * Stop all active workers
   *
   * @returns Number of workers stopped
   */
  stopAllWorkers(): number {
    let stopped = 0;

    for (const taskId of this.activeWorkers.keys()) {
      if (this.stopWorker(taskId)) {
        stopped++;
      }
    }

    return stopped;
  }

  /**
   * Check if any workers are active
   */
  hasActiveWorkers(): boolean {
    return this.activeWorkers.size > 0;
  }
}

// Export types and classes
export { Execution, ExecutionRepository } from './execution.js';
export { RalphSpawner, type SpawnResult, type CompletionResult } from './ralph-spawner.js';
export {
  FailureHandler,
  handleFailure,
  handleSuccess,
  markPermanentlyFailed,
  resetForRetry,
  getRetryCount,
  calculateBackoffDelay,
  MAX_RETRIES,
} from './failure-handler.js';
