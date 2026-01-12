import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Log levels supported by the Logger
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Configuration options for the Logger
 */
export interface LoggerOptions {
  /** Minimum log level to output (default: 'info') */
  level?: LogLevel;
  /** Optional file path to write logs to */
  logFilePath?: string;
}

/**
 * Numeric priority of log levels (lower = more verbose)
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Structured logger utility for MetaRalph operations.
 * Logs to stdout by default, with optional file logging.
 * Each log entry includes ISO timestamp and log level.
 */
export class Logger {
  private level: LogLevel;
  private logFilePath?: string;
  private fileStream?: fs.WriteStream;

  /**
   * Create a new Logger instance
   * @param options - Logger configuration options
   */
  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.logFilePath = options.logFilePath;

    if (this.logFilePath) {
      this.initFileStream(this.logFilePath);
    }
  }

  /**
   * Initialize the file stream for logging
   */
  private initFileStream(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.fileStream = fs.createWriteStream(filePath, { flags: 'a' });
  }

  /**
   * Check if a message at the given level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  /**
   * Format a log entry with timestamp and level
   */
  private formatEntry(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const levelUpper = level.toUpperCase().padEnd(5);
    let entry = `[${timestamp}] [${levelUpper}] ${message}`;

    if (meta && Object.keys(meta).length > 0) {
      entry += ` ${JSON.stringify(meta)}`;
    }

    return entry;
  }

  /**
   * Write a log entry to stdout and optionally to file
   */
  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry = this.formatEntry(level, message, meta);

    // Write to stdout
    if (level === 'error') {
      console.error(entry);
    } else if (level === 'warn') {
      console.warn(entry);
    } else {
      console.log(entry);
    }

    // Write to file if configured
    if (this.fileStream) {
      this.fileStream.write(entry + '\n');
    }
  }

  /**
   * Log a debug message
   * @param message - The message to log
   * @param meta - Optional metadata object
   */
  debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, meta);
  }

  /**
   * Log an info message
   * @param message - The message to log
   * @param meta - Optional metadata object
   */
  info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta);
  }

  /**
   * Log a warning message
   * @param message - The message to log
   * @param meta - Optional metadata object
   */
  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, meta);
  }

  /**
   * Log an error message
   * @param message - The message to log
   * @param meta - Optional metadata object
   */
  error(message: string, meta?: Record<string, unknown>): void {
    this.write('error', message, meta);
  }

  /**
   * Set the minimum log level
   * @param level - The new minimum log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Configure a log file path
   * @param filePath - Path to the log file
   */
  setLogFile(filePath: string): void {
    if (this.fileStream) {
      this.fileStream.end();
    }
    this.logFilePath = filePath;
    this.initFileStream(filePath);
  }

  /**
   * Close the logger and any open file streams
   */
  close(): void {
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = undefined;
    }
  }
}

/**
 * Default logger instance for convenience
 */
export const logger = new Logger();
