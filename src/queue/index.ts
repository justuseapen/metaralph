/**
 * Queue Manager - Manages the work queue scheduling loop
 *
 * The QueueManager continuously processes the work queue, scheduling tasks
 * to be executed by Ralph workers via the WorkerOrchestrator.
 */

import { EventEmitter } from 'node:events';
import { type Task, TaskRepository } from './task.js';
import { WorkerOrchestrator, type ScheduleResult } from '../workers/index.js';
import { initDatabase, type DatabaseInstance } from '../db/index.js';

/**
 * Scheduling interval in milliseconds (5 seconds)
 */
const SCHEDULING_INTERVAL_MS = 5000;

/**
 * Events emitted by the QueueManager
 */
export interface QueueManagerEvents {
  'task:scheduled': (task: Task, result: ScheduleResult) => void;
  'task:completed': (task: Task) => void;
  'task:failed': (task: Task, error: string) => void;
}

/**
 * Status of the QueueManager
 */
export interface QueueManagerStatus {
  running: boolean;
  tasksScheduled: number;
  tasksCompleted: number;
  tasksFailed: number;
  lastScheduleCheck: Date | null;
}

/**
 * QueueManager - Manages the work queue scheduling loop
 *
 * Continuously checks for available tasks and schedules them for execution
 * via the WorkerOrchestrator.
 */
export class QueueManager extends EventEmitter {
  private workerOrchestrator: WorkerOrchestrator;
  private running: boolean = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private tasksScheduled: number = 0;
  private tasksCompleted: number = 0;
  private tasksFailed: number = 0;
  private lastScheduleCheck: Date | null = null;

  constructor(workerOrchestrator?: WorkerOrchestrator) {
    super();
    this.workerOrchestrator = workerOrchestrator ?? new WorkerOrchestrator();
    this.setupWorkerEventListeners();
  }

  /**
   * Set up event listeners for worker completion/failure events
   */
  private setupWorkerEventListeners(): void {
    // Listen for worker completion events
    this.workerOrchestrator.on('worker:completed', (task: Task) => {
      this.tasksCompleted++;
      // Update task status to completed
      TaskRepository.updateStatus(task.id, 'completed');
      this.emit('task:completed', task);
    });

    // Listen for worker failure events
    this.workerOrchestrator.on('worker:failed', (task: Task, error: string) => {
      this.tasksFailed++;
      // Task status is already updated by failure handler
      this.emit('task:failed', task, error);
    });
  }

  /**
   * Start the scheduling loop
   *
   * Begins processing the work queue every 5 seconds.
   * Checks for available capacity and schedules pending tasks.
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;

    // Run immediately on start
    this.scheduleNextTasks();

    // Then run every 5 seconds
    this.intervalId = setInterval(() => {
      this.scheduleNextTasks();
    }, SCHEDULING_INTERVAL_MS);
  }

  /**
   * Stop the scheduling loop
   *
   * Stops processing the work queue. Does not stop running workers.
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Stop all workers and the scheduling loop
   *
   * Stops all running workers and the scheduling loop.
   */
  stopAll(): number {
    this.stop();
    return this.workerOrchestrator.stopAllWorkers();
  }

  /**
   * Check if the scheduling loop is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the current status of the QueueManager
   */
  getStatus(): QueueManagerStatus {
    return {
      running: this.running,
      tasksScheduled: this.tasksScheduled,
      tasksCompleted: this.tasksCompleted,
      tasksFailed: this.tasksFailed,
      lastScheduleCheck: this.lastScheduleCheck,
    };
  }

  /**
   * Get the underlying WorkerOrchestrator
   *
   * Useful for checking worker status or manually managing workers.
   */
  getWorkerOrchestrator(): WorkerOrchestrator {
    return this.workerOrchestrator;
  }

  /**
   * Schedule the next available tasks
   *
   * Main scheduling logic:
   * 1. Check if there's capacity for more workers
   * 2. Get next tasks from the queue (ordered by priority)
   * 3. Schedule tasks that can be executed
   */
  private scheduleNextTasks(): void {
    this.lastScheduleCheck = new Date();

    // Check if we have capacity
    if (!this.workerOrchestrator.hasCapacity()) {
      return;
    }

    const db = initDatabase();

    try {
      // Calculate how many slots are available
      const availableSlots =
        this.workerOrchestrator.getMaxWorkers() -
        this.workerOrchestrator.getActiveWorkerCount();

      if (availableSlots <= 0) {
        return;
      }

      // Get next tasks from the queue
      const tasks = TaskRepository.getNextTasks(availableSlots, db);

      if (tasks.length === 0) {
        return;
      }

      // Schedule each task
      for (const task of tasks) {
        // Skip if project is already busy
        if (this.workerOrchestrator.isProjectBusy(task.projectId)) {
          continue;
        }

        // Mark task as running before scheduling
        TaskRepository.updateStatus(task.id, 'running', db);

        // Schedule the task
        this.workerOrchestrator
          .scheduleTask(task)
          .then((result) => {
            if (result.success) {
              this.tasksScheduled++;
              this.emit('task:scheduled', task, result);
            } else {
              // Scheduling failed - reset task status
              TaskRepository.updateStatus(task.id, 'queued');
            }
          })
          .catch((err) => {
            // Scheduling error - reset task status
            TaskRepository.updateStatus(task.id, 'queued');
            console.error(`Failed to schedule task ${task.id}:`, err);
          });

        // Stop if we've used all available capacity
        if (!this.workerOrchestrator.hasCapacity()) {
          break;
        }
      }
    } finally {
      db.close();
    }
  }
}

// Re-export task module exports
export {
  type Task,
  type TaskType,
  type EffortLevel,
  type TaskStatus,
  type ApprovalStatus,
  type TaskSource,
  type CreateTaskInput,
  TaskRepository,
} from './task.js';

// Re-export approval module exports
export { ApprovalQueue, type ApprovalResult, categorizeTask, getApprovalQueue } from './approval.js';

// Re-export prioritizer exports
export { calculatePriorityScore, TYPE_SCORES, EFFORT_MULTIPLIERS } from './prioritizer.js';
