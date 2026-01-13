/**
 * Daemon Runner - The actual daemon process entry point
 *
 * This module is spawned as a detached process by the daemon lifecycle manager.
 * It runs the QueueManager to continuously process the work queue.
 */

import { QueueManager } from '../queue/index.js';
import { Logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import { registerSelfProjects } from '../self-improve/self-registration.js';
import * as path from 'node:path';

/**
 * Daemon runner instance
 */
let queueManager: QueueManager | null = null;
let logger: Logger | null = null;

/**
 * Initialize and start the daemon runner
 */
export function startRunner(): void {
  const config = loadConfig();

  // Initialize logger
  logger = new Logger({
    level: 'info',
    logFilePath: path.join(config.logsPath, 'daemon.log'),
  });

  logger.info('Daemon runner starting');

  // Auto-register self-managed projects (Ralph and MetaRalph)
  if (config.selfImprovementEnabled) {
    logger.info('Registering self-managed projects');
    const selfRegResult = registerSelfProjects();

    if (selfRegResult.ralphRegistered) {
      logger.info('Ralph registered as self-managed project', { path: selfRegResult.ralphPath });
    }
    if (selfRegResult.metaRalphRegistered) {
      logger.info('MetaRalph registered as self-managed project', { path: selfRegResult.metaRalphPath });
    }
    if (selfRegResult.errors.length > 0) {
      logger.warn('Self-registration warnings', { errors: selfRegResult.errors });
    }
  }

  // Initialize QueueManager
  queueManager = new QueueManager();

  // Set up event listeners
  queueManager.on('task:scheduled', (task, result) => {
    logger?.info('Task scheduled', {
      taskId: task.id,
      taskTitle: task.title,
      projectId: task.projectId,
      message: result.message,
    });
  });

  queueManager.on('task:completed', (task) => {
    logger?.info('Task completed', {
      taskId: task.id,
      taskTitle: task.title,
      projectId: task.projectId,
    });
  });

  queueManager.on('task:failed', (task, error) => {
    logger?.error('Task failed', {
      taskId: task.id,
      taskTitle: task.title,
      projectId: task.projectId,
      error,
    });
  });

  // Start the scheduling loop
  queueManager.start();

  logger.info('Daemon runner started - scheduling loop active');
}

/**
 * Stop the daemon runner gracefully
 */
export function stopRunner(): void {
  logger?.info('Daemon runner stopping');

  if (queueManager) {
    const stoppedWorkers = queueManager.stopAll();
    logger?.info('Daemon runner stopped', { stoppedWorkers });
    queueManager = null;
  }
}

/**
 * Get the current QueueManager instance (for testing/debugging)
 */
export function getQueueManager(): QueueManager | null {
  return queueManager;
}

// When this module is run directly as the daemon process
if (process.argv[1]?.endsWith('runner.js') || process.argv[1]?.endsWith('runner.ts')) {
  // Set up signal handlers
  process.on('SIGTERM', () => {
    stopRunner();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    stopRunner();
    process.exit(0);
  });

  // Start the runner
  startRunner();
}
