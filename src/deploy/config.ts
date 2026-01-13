/**
 * Deployment Configuration - Defines how projects deploy to infrastructure
 *
 * Supports multiple deployment providers with environment-specific configurations.
 */

/**
 * Supported deployment providers
 */
export type DeploymentProvider =
  | 'coolify'
  | 'vercel'
  | 'netlify'
  | 'railway'
  | 'fly'
  | 'custom';

/**
 * All available deployment providers
 */
export const DEPLOYMENT_PROVIDERS: DeploymentProvider[] = [
  'coolify',
  'vercel',
  'netlify',
  'railway',
  'fly',
  'custom',
];

/**
 * Check if a string is a valid deployment provider
 */
export function isValidProvider(provider: string): provider is DeploymentProvider {
  return DEPLOYMENT_PROVIDERS.includes(provider as DeploymentProvider);
}

/**
 * Environment-specific deployment configuration
 */
export interface EnvironmentConfig {
  /** URL or identifier for the deployment target */
  url?: string;
  /** Branch to deploy from for this environment */
  branch?: string;
  /** Environment variables (key names only, values stored securely elsewhere) */
  envVars?: string[];
  /** Auto-deploy on push to the branch */
  autoDeploy?: boolean;
}

/**
 * Deployment commands configuration
 */
export interface DeploymentCommands {
  /** Build command (e.g., 'npm run build') */
  build?: string;
  /** Start command (e.g., 'npm start') */
  start?: string;
  /** Pre-deploy hook */
  preDeploy?: string;
  /** Post-deploy hook */
  postDeploy?: string;
}

/**
 * Main deployment configuration interface
 */
export interface DeploymentConfig {
  /** Deployment provider */
  provider: DeploymentProvider;
  /** Environment-specific configurations */
  environments: {
    staging?: EnvironmentConfig;
    production?: EnvironmentConfig;
  };
  /** Deployment commands */
  commands?: DeploymentCommands;
  /** Health check URL path (e.g., '/health' or '/api/health') */
  healthCheckUrl?: string;
  /** Docker configuration (for providers that support it) */
  docker?: {
    /** Path to Dockerfile (default: './Dockerfile') */
    dockerfile?: string;
    /** Docker Compose file path */
    composeFile?: string;
    /** Docker build context */
    context?: string;
  };
  /** Provider-specific configuration */
  providerConfig?: Record<string, unknown>;
}

/**
 * Default deployment configuration
 */
export function createDefaultConfig(provider: DeploymentProvider = 'coolify'): DeploymentConfig {
  return {
    provider,
    environments: {
      staging: {
        branch: 'develop',
        autoDeploy: true,
      },
      production: {
        branch: 'main',
        autoDeploy: false,
      },
    },
    commands: {
      build: 'npm run build',
      start: 'npm start',
    },
    healthCheckUrl: '/health',
  };
}

/**
 * Validate a deployment configuration
 *
 * @param config - Configuration to validate
 * @returns Array of validation error messages (empty if valid)
 */
export function validateConfig(config: DeploymentConfig): string[] {
  const errors: string[] = [];

  if (!config.provider) {
    errors.push('Provider is required');
  } else if (!isValidProvider(config.provider)) {
    errors.push(`Invalid provider: ${config.provider}. Must be one of: ${DEPLOYMENT_PROVIDERS.join(', ')}`);
  }

  if (!config.environments) {
    errors.push('Environments configuration is required');
  }

  return errors;
}

/**
 * Merge a partial config with defaults
 *
 * @param partial - Partial configuration to merge
 * @param provider - Default provider if not specified
 * @returns Complete deployment configuration
 */
export function mergeWithDefaults(
  partial: Partial<DeploymentConfig>,
  provider: DeploymentProvider = 'coolify'
): DeploymentConfig {
  const defaults = createDefaultConfig(provider);
  return {
    ...defaults,
    ...partial,
    environments: {
      ...defaults.environments,
      ...partial.environments,
      staging: {
        ...defaults.environments.staging,
        ...partial.environments?.staging,
      },
      production: {
        ...defaults.environments.production,
        ...partial.environments?.production,
      },
    },
    commands: {
      ...defaults.commands,
      ...partial.commands,
    },
    docker: partial.docker ? { ...partial.docker } : undefined,
    providerConfig: partial.providerConfig ? { ...partial.providerConfig } : undefined,
  };
}

/**
 * Serialize deployment config to JSON string for storage
 */
export function serializeConfig(config: DeploymentConfig): string {
  return JSON.stringify(config);
}

/**
 * Parse deployment config from JSON string
 *
 * @param json - JSON string to parse
 * @returns Parsed config or null if invalid
 */
export function parseConfig(json: string | null): DeploymentConfig | null {
  if (!json) {
    return null;
  }
  try {
    const parsed = JSON.parse(json) as DeploymentConfig;
    // Basic validation
    if (!parsed.provider || !parsed.environments) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
