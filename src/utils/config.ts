import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * MetaRalph configuration structure
 */
export interface MetaRalphConfig {
  /** Path to the SQLite database file */
  dbPath: string;
  /** Path to the logs directory */
  logsPath: string;
  /** Maximum number of concurrent worker processes */
  maxConcurrentWorkers: number;
  /** Whether self-improvement features are enabled */
  selfImprovementEnabled: boolean;
  /** Path to the Ralph repository (optional, auto-detected if not set) */
  ralphPath?: string;
  /** Path to the MetaRalph repository (optional, auto-detected if not set) */
  metaRalphPath?: string;
}

/**
 * Get the MetaRalph config directory path
 * @returns The path to ~/.config/metaralph/
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), '.config', 'metaralph');
}

/**
 * Get the path to the config file
 * @returns The path to ~/.config/metaralph/config.json
 */
export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Get the default configuration
 * @returns Default MetaRalph configuration
 */
export function getDefaultConfig(): MetaRalphConfig {
  const configDir = getConfigDir();
  return {
    dbPath: path.join(configDir, 'metaralph.db'),
    logsPath: path.join(configDir, 'logs'),
    maxConcurrentWorkers: 3,
    selfImprovementEnabled: true,
  };
}

/**
 * Ensure the config directory exists
 * Creates ~/.config/metaralph/ if it doesn't exist
 */
function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Validate that a value matches the MetaRalphConfig structure
 * @param value - The value to validate
 * @returns True if valid, throws Error if invalid
 */
function validateConfig(value: unknown): value is MetaRalphConfig {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Config must be an object');
  }

  const config = value as Record<string, unknown>;

  if (typeof config.dbPath !== 'string') {
    throw new Error('Config dbPath must be a string');
  }
  if (typeof config.logsPath !== 'string') {
    throw new Error('Config logsPath must be a string');
  }
  if (typeof config.maxConcurrentWorkers !== 'number' || !Number.isInteger(config.maxConcurrentWorkers) || config.maxConcurrentWorkers < 1) {
    throw new Error('Config maxConcurrentWorkers must be a positive integer');
  }
  if (typeof config.selfImprovementEnabled !== 'boolean') {
    throw new Error('Config selfImprovementEnabled must be a boolean');
  }
  // Optional paths - validate if present
  if (config.ralphPath !== undefined && typeof config.ralphPath !== 'string') {
    throw new Error('Config ralphPath must be a string if provided');
  }
  if (config.metaRalphPath !== undefined && typeof config.metaRalphPath !== 'string') {
    throw new Error('Config metaRalphPath must be a string if provided');
  }

  return true;
}

/**
 * Load MetaRalph configuration from disk
 * Creates the config directory if it doesn't exist.
 * Returns default config if config.json doesn't exist.
 *
 * @returns The loaded configuration
 * @throws Error if config file exists but is invalid
 */
export function loadConfig(): MetaRalphConfig {
  ensureConfigDir();

  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return getDefaultConfig();
  }

  const fileContent = fs.readFileSync(configPath, 'utf-8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(fileContent);
  } catch {
    throw new Error(`Failed to parse config file at ${configPath}: invalid JSON`);
  }

  // Merge with defaults to handle missing fields in existing config
  const defaultConfig = getDefaultConfig();
  const mergedConfig = {
    ...defaultConfig,
    ...(parsed as Record<string, unknown>),
  };

  validateConfig(mergedConfig);

  return mergedConfig;
}

/**
 * Save MetaRalph configuration to disk
 * Creates the config directory if it doesn't exist.
 *
 * @param config - The configuration to save
 * @throws Error if config is invalid
 */
export function saveConfig(config: MetaRalphConfig): void {
  validateConfig(config);
  ensureConfigDir();

  const configPath = getConfigPath();
  const content = JSON.stringify(config, null, 2);

  fs.writeFileSync(configPath, content, 'utf-8');
}
