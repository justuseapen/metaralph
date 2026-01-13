/**
 * Deploy Module - Deployment configuration and providers
 */

export {
  type DeploymentProvider,
  type EnvironmentConfig,
  type DeploymentCommands,
  type DeploymentConfig,
  DEPLOYMENT_PROVIDERS,
  isValidProvider,
  createDefaultConfig,
  validateConfig,
  mergeWithDefaults,
  serializeConfig,
  parseConfig,
} from './config.js';

// Coolify Provider
export {
  CoolifyProvider,
  createCoolifyProviderFromEnv,
  type CoolifyConfig,
  type DeploymentStatus,
  type DeployResult,
  type DeploymentType,
  type LogOptions,
} from './providers/coolify.js';

// Staging Auto-Deploy
export {
  StagingDeployer,
  getDeploymentRecords,
  getLatestDeploymentRecord,
  type DeploymentRecord,
  type StagingDeployResult,
  type StagingDeployerOptions,
  type DeploymentNotificationCallback,
} from './staging.js';
