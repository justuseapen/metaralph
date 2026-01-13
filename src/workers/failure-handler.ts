/**
 * Failure Handler - Manages retry logic for failed Ralph executions
 *
 * Implements exponential backoff for retries (up to 2 retries per task).
 * Tracks retry counts and determines when to give up on a task.
 */

import { type Task, TaskRepository, type TaskStatus } from '../queue/task.js';
import { type Execution, ExecutionRepository } from './execution.js';
import { initDatabase, type DatabaseInstance } from '../db/index.js';

/**
 * Maximum number of retries allowed per task
 */
export const MAX_RETRIES = 2;

/**
 * Base delay for exponential backoff (in milliseconds)
 */
export const BASE_RETRY_DELAY_MS = 5000; // 5 seconds

/**
 * Result of a failure handling operation
 */
export interface FailureHandlingResult {
  /** Whether a retry should be attempted */
  shouldRetry: boolean;
  /** The retry number (1 or 2), or 0 if no retry */
  retryNumber: number;
  /** Delay before retry in milliseconds */
  delayMs: number;
  /** Message describing the decision */
  message: string;
}

/**
 * In-memory store for retry counts (resets on daemon restart)
 * Key: taskId, Value: number of retries attempted
 */
const retryCounts = new Map<string, number>();

/**
 * Get the current retry count for a task
 *
 * @param taskId - The task ID
 * @returns Current retry count (0 if not retried yet)
 */
export function getRetryCount(taskId: string): number {
  return retryCounts.get(taskId) ?? 0;
}

/**
 * Increment the retry count for a task
 *
 * @param taskId - The task ID
 * @returns The new retry count
 */
export function incrementRetryCount(taskId: string): number {
  const current = getRetryCount(taskId);
  const newCount = current + 1;
  retryCounts.set(taskId, newCount);
  return newCount;
}

/**
 * Clear the retry count for a task (used on success)
 *
 * @param taskId - The task ID
 */
export function clearRetryCount(taskId: string): void {
  retryCounts.delete(taskId);
}

/**
 * Calculate the delay for exponential backoff
 *
 * @param retryNumber - The retry attempt number (1, 2, ...)
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(retryNumber: number): number {
  // Exponential backoff: baseDelay * 2^(retryNumber - 1)
  // Retry 1: 5 seconds
  // Retry 2: 10 seconds
  return BASE_RETRY_DELAY_MS * Math.pow(2, retryNumber - 1);
}

/**
 * Handle a failed task execution
 *
 * Determines whether to retry the task and calculates the backoff delay.
 *
 * @param task - The task that failed
 * @param execution - The failed execution
 * @param error - Error message or reason for failure
 * @returns Result indicating whether to retry and with what delay
 */
export function handleFailure(
  task: Task,
  execution: Execution,
  error: string
): FailureHandlingResult {
  const currentRetries = getRetryCount(task.id);

  // Check if we've exceeded retry limit
  if (currentRetries >= MAX_RETRIES) {
    return {
      shouldRetry: false,
      retryNumber: 0,
      delayMs: 0,
      message: `Task ${task.id} has exceeded max retries (${MAX_RETRIES}). Marking as failed.`,
    };
  }

  // Increment retry count
  const nextRetry = incrementRetryCount(task.id);
  const delay = calculateBackoffDelay(nextRetry);

  return {
    shouldRetry: true,
    retryNumber: nextRetry,
    delayMs: delay,
    message: `Task ${task.id} will be retried (attempt ${nextRetry}/${MAX_RETRIES}) after ${delay}ms. Error: ${error}`,
  };
}

/**
 * Mark a task as permanently failed (no more retries)
 *
 * @param taskId - The task ID
 * @param db - Optional database instance
 */
export function markPermanentlyFailed(taskId: string, db?: DatabaseInstance): void {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    TaskRepository.updateStatus(taskId, 'failed', database);
    clearRetryCount(taskId);
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * Reset a task for retry (set status back to queued)
 *
 * @param taskId - The task ID
 * @param db - Optional database instance
 */
export function resetForRetry(taskId: string, db?: DatabaseInstance): void {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    TaskRepository.updateStatus(taskId, 'queued', database);
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * Handle successful task completion
 *
 * Clears retry count and marks task as completed.
 *
 * @param taskId - The task ID
 * @param db - Optional database instance
 */
export function handleSuccess(taskId: string, db?: DatabaseInstance): void {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    TaskRepository.updateStatus(taskId, 'completed', database);
    clearRetryCount(taskId);
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * FailureHandler class - Object-oriented interface for failure handling
 */
export class FailureHandler {
  /**
   * Handle a failed execution and determine next steps
   *
   * @param task - The failed task
   * @param execution - The failed execution record
   * @param error - Error message
   * @returns Result with retry decision
   */
  handleFailedExecution(
    task: Task,
    execution: Execution,
    error: string
  ): FailureHandlingResult {
    return handleFailure(task, execution, error);
  }

  /**
   * Mark task as permanently failed
   */
  markFailed(taskId: string, db?: DatabaseInstance): void {
    markPermanentlyFailed(taskId, db);
  }

  /**
   * Reset task for retry attempt
   */
  resetForRetry(taskId: string, db?: DatabaseInstance): void {
    resetForRetry(taskId, db);
  }

  /**
   * Handle successful completion
   */
  handleSuccess(taskId: string, db?: DatabaseInstance): void {
    handleSuccess(taskId, db);
  }

  /**
   * Get the current retry count for a task
   */
  getRetryCount(taskId: string): number {
    return getRetryCount(taskId);
  }
}
