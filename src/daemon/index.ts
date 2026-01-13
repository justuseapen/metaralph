/**
 * MetaRalph Daemon Lifecycle Management
 *
 * Handles starting, stopping, and monitoring the MetaRalph daemon process.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getConfigDir } from '../utils/config.js';
import { Logger } from '../utils/logger.js';

// Get the directory of this module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Status information for the daemon
 */
export interface DaemonStatus {
  /** Whether the daemon is currently running */
  running: boolean;
  /** Process ID if running, null otherwise */
  pid: number | null;
  /** Uptime in seconds if running, null otherwise */
  uptime: number | null;
  /** Timestamp when the daemon was started, null if not running */
  startedAt: Date | null;
}

/**
 * Get the path to the PID file
 * @returns The path to ~/.config/metaralph/metaralph.pid
 */
export function getPidFilePath(): string {
  return path.join(getConfigDir(), 'metaralph.pid');
}

/**
 * Get the path to the daemon start time file
 * @returns The path to ~/.config/metaralph/metaralph.started
 */
function getStartTimeFilePath(): string {
  return path.join(getConfigDir(), 'metaralph.started');
}

/**
 * Check if a process with the given PID is running
 * @param pid - The process ID to check
 * @returns True if the process is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 doesn't actually send a signal, but checks if process exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write the PID file for the daemon
 * @param pid - The process ID to write
 */
function writePidFile(pid: number): void {
  const pidPath = getPidFilePath();
  const configDir = getConfigDir();

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(pidPath, pid.toString(), 'utf-8');
}

/**
 * Write the start time file for the daemon
 */
function writeStartTimeFile(): void {
  const startTimePath = getStartTimeFilePath();
  fs.writeFileSync(startTimePath, new Date().toISOString(), 'utf-8');
}

/**
 * Read the PID from the PID file
 * @returns The PID if file exists and is valid, null otherwise
 */
function readPidFile(): number | null {
  const pidPath = getPidFilePath();

  if (!fs.existsSync(pidPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Read the start time from the start time file
 * @returns The start time if file exists and is valid, null otherwise
 */
function readStartTimeFile(): Date | null {
  const startTimePath = getStartTimeFilePath();

  if (!fs.existsSync(startTimePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(startTimePath, 'utf-8').trim();
    const date = new Date(content);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Remove the PID and start time files
 */
function cleanupPidFiles(): void {
  const pidPath = getPidFilePath();
  const startTimePath = getStartTimeFilePath();

  if (fs.existsSync(pidPath)) {
    fs.unlinkSync(pidPath);
  }
  if (fs.existsSync(startTimePath)) {
    fs.unlinkSync(startTimePath);
  }
}

/**
 * Get the status of the MetaRalph daemon
 * @returns Status information about the daemon
 */
export function getDaemonStatus(): DaemonStatus {
  const pid = readPidFile();

  if (pid === null || !isProcessRunning(pid)) {
    // Clean up stale PID files
    if (pid !== null) {
      cleanupPidFiles();
    }

    return {
      running: false,
      pid: null,
      uptime: null,
      startedAt: null,
    };
  }

  const startedAt = readStartTimeFile();
  const uptime = startedAt ? Math.floor((Date.now() - startedAt.getTime()) / 1000) : null;

  return {
    running: true,
    pid,
    uptime,
    startedAt,
  };
}

/**
 * Start the MetaRalph daemon
 *
 * The daemon runs as a detached background process.
 *
 * @param logger - Optional logger instance for logging events
 * @returns Object with success status and message
 */
export function startDaemon(logger?: Logger): { success: boolean; message: string } {
  const status = getDaemonStatus();

  if (status.running) {
    return {
      success: false,
      message: `Daemon is already running with PID ${status.pid}`,
    };
  }

  // Ensure config directory exists
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Get the path to the runner module (compiled JS)
  const runnerPath = path.join(__dirname, 'runner.js');

  // Spawn the daemon runner as a detached process
  const child = spawn('node', [runnerPath], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'production',
    },
  });

  // Unref to allow parent to exit independently
  child.unref();

  if (child.pid) {
    writePidFile(child.pid);
    writeStartTimeFile();

    if (logger) {
      logger.info('MetaRalph daemon started', { pid: child.pid });
    }

    return {
      success: true,
      message: `Daemon started with PID ${child.pid}`,
    };
  }

  return {
    success: false,
    message: 'Failed to start daemon process',
  };
}

/**
 * Stop the MetaRalph daemon
 *
 * Sends SIGTERM to the daemon process.
 *
 * @param logger - Optional logger instance for logging events
 * @returns Object with success status and message
 */
export function stopDaemon(logger?: Logger): { success: boolean; message: string } {
  const status = getDaemonStatus();

  if (!status.running || status.pid === null) {
    return {
      success: false,
      message: 'Daemon is not running',
    };
  }

  try {
    process.kill(status.pid, 'SIGTERM');

    // Wait a moment for the process to terminate
    // Use a simple check instead of blocking
    let terminated = false;
    const maxWait = 3000; // 3 seconds
    const checkInterval = 100;
    let waited = 0;

    while (waited < maxWait) {
      if (!isProcessRunning(status.pid)) {
        terminated = true;
        break;
      }
      // Synchronous sleep using a busy wait (not ideal but works for CLI)
      const start = Date.now();
      while (Date.now() - start < checkInterval) {
        // busy wait
      }
      waited += checkInterval;
    }

    if (terminated) {
      cleanupPidFiles();

      if (logger) {
        logger.info('MetaRalph daemon stopped', { pid: status.pid });
      }

      return {
        success: true,
        message: `Daemon (PID ${status.pid}) stopped successfully`,
      };
    } else {
      // Process didn't terminate gracefully, try SIGKILL
      try {
        process.kill(status.pid, 'SIGKILL');
        cleanupPidFiles();

        if (logger) {
          logger.warn('MetaRalph daemon killed forcefully', { pid: status.pid });
        }

        return {
          success: true,
          message: `Daemon (PID ${status.pid}) killed forcefully`,
        };
      } catch {
        return {
          success: false,
          message: `Failed to kill daemon (PID ${status.pid})`,
        };
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    // If process no longer exists, clean up
    if (!isProcessRunning(status.pid)) {
      cleanupPidFiles();
      return {
        success: true,
        message: 'Daemon was already stopped',
      };
    }

    return {
      success: false,
      message: `Failed to stop daemon: ${errorMessage}`,
    };
  }
}

/**
 * Format uptime in human-readable form
 * @param seconds - Uptime in seconds
 * @returns Formatted string like "2d 5h 30m 15s" or "5m 30s"
 */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

// Re-export runner functions for programmatic use
export { startRunner, stopRunner, getQueueManager } from './runner.js';
