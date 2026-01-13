/**
 * Coolify Deployment Provider
 *
 * Provides integration with Coolify for deploying applications via its REST API.
 * Supports docker-compose and Dockerfile deployments to American Cloud or any
 * server running Coolify.
 */

import type { Project } from '../../registry/index.js';
import type { DeploymentConfig, EnvironmentConfig } from '../config.js';

/**
 * Coolify-specific configuration stored in providerConfig
 */
export interface CoolifyConfig {
  /** Base URL of the Coolify instance (e.g., 'https://coolify.yourdomain.com') */
  baseUrl: string;
  /** API token for authentication */
  apiToken: string;
  /** Application UUID in Coolify */
  applicationUuid?: string;
  /** Webhook URL for triggering deployments (alternative to UUID) */
  webhookUrl?: string;
  /** Server UUID where the application is deployed */
  serverUuid?: string;
}

/**
 * Deployment status response from Coolify
 */
export interface DeploymentStatus {
  /** Unique identifier for the deployment */
  deploymentUuid: string;
  /** Application UUID */
  applicationUuid: string;
  /** Current status */
  status: 'queued' | 'in_progress' | 'finished' | 'failed' | 'cancelled';
  /** Status message */
  message: string;
  /** Timestamp when deployment started */
  startedAt?: string;
  /** Timestamp when deployment finished */
  finishedAt?: string;
  /** Git commit SHA that was deployed */
  commitSha?: string;
}

/**
 * Result of a deploy operation
 */
export interface DeployResult {
  success: boolean;
  message: string;
  deploymentUuid?: string;
  applicationUuid?: string;
}

/**
 * Deployment type specification
 */
export type DeploymentType = 'dockerfile' | 'docker-compose' | 'nixpacks' | 'pack';

/**
 * Options for log retrieval
 */
export interface LogOptions {
  /** Number of lines to retrieve (default: 100) */
  lines?: number;
  /** Whether to stream logs (if true, returns async generator) */
  stream?: boolean;
  /** Log type: 'application' for runtime logs, 'deployment' for build logs */
  type?: 'application' | 'deployment';
  /** Specific deployment UUID for deployment logs */
  deploymentUuid?: string;
}

/**
 * CoolifyProvider - Deployment provider for Coolify PaaS
 *
 * Integrates with Coolify's REST API to manage deployments.
 */
export class CoolifyProvider {
  private config: CoolifyConfig;
  private deployConfig?: DeploymentConfig;

  constructor(config: CoolifyConfig) {
    this.config = config;
  }

  /**
   * Initialize provider with deployment configuration from project
   */
  initWithDeployConfig(deployConfig: DeploymentConfig): void {
    this.deployConfig = deployConfig;
    // Merge providerConfig if present
    if (deployConfig.providerConfig) {
      const coolifyConfig = deployConfig.providerConfig as Partial<CoolifyConfig>;
      this.config = {
        ...this.config,
        ...coolifyConfig,
      };
    }
  }

  /**
   * Create provider from project's deploy_config
   */
  static fromProject(project: Project): CoolifyProvider | null {
    if (!project.deploy_config) {
      return null;
    }

    try {
      const deployConfig = JSON.parse(project.deploy_config) as DeploymentConfig;
      if (deployConfig.provider !== 'coolify') {
        return null;
      }

      const coolifyConfig = deployConfig.providerConfig as CoolifyConfig | undefined;
      if (!coolifyConfig?.baseUrl || !coolifyConfig?.apiToken) {
        return null;
      }

      const provider = new CoolifyProvider(coolifyConfig);
      provider.initWithDeployConfig(deployConfig);
      return provider;
    } catch {
      return null;
    }
  }

  /**
   * Make an authenticated API request to Coolify
   */
  private async apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ ok: boolean; data?: T; error?: string; status: number }> {
    const url = `${this.config.baseUrl}/api/v1${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...options.headers,
        },
      });

      const status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        return {
          ok: false,
          error: `HTTP ${status}: ${errorText}`,
          status,
        };
      }

      // Some endpoints return empty responses
      const text = await response.text();
      if (!text) {
        return { ok: true, status };
      }

      const data = JSON.parse(text) as T;
      return { ok: true, data, status };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message, status: 0 };
    }
  }

  /**
   * Get the environment-specific configuration
   */
  private getEnvironmentConfig(environment: 'staging' | 'production'): EnvironmentConfig | undefined {
    return this.deployConfig?.environments[environment];
  }

  /**
   * Trigger a deployment to Coolify
   */
  async deploy(
    project: Project,
    environment: 'staging' | 'production',
    options: {
      force?: boolean;
      prId?: number;
    } = {}
  ): Promise<DeployResult> {
    // Try webhook URL first if available
    if (this.config.webhookUrl) {
      return this.deployViaWebhook(options.force);
    }

    // Fall back to UUID-based deployment
    if (!this.config.applicationUuid) {
      return {
        success: false,
        message: 'No application UUID or webhook URL configured for Coolify deployment',
      };
    }

    return this.deployViaUuid(this.config.applicationUuid, options);
  }

  /**
   * Deploy using webhook URL
   */
  private async deployViaWebhook(force?: boolean): Promise<DeployResult> {
    const url = new URL(this.config.webhookUrl!);
    if (force) {
      url.searchParams.set('force', 'true');
    }

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          message: `Webhook deployment failed: ${errorText}`,
        };
      }

      const result = await response.json() as { message?: string; deployment_uuid?: string };
      return {
        success: true,
        message: result.message || 'Deployment triggered via webhook',
        deploymentUuid: result.deployment_uuid,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Webhook deployment failed: ${message}`,
      };
    }
  }

  /**
   * Deploy using application UUID via the deploy endpoint
   */
  private async deployViaUuid(
    uuid: string,
    options: { force?: boolean; prId?: number }
  ): Promise<DeployResult> {
    const params = new URLSearchParams();
    params.set('uuid', uuid);
    if (options.force) {
      params.set('force', 'true');
    }
    if (options.prId !== undefined) {
      params.set('pr', String(options.prId));
    }

    const response = await this.apiRequest<{
      deployments?: Array<{
        message: string;
        resource_uuid: string;
        deployment_uuid: string;
      }>;
    }>(`/deploy?${params.toString()}`);

    if (!response.ok) {
      return {
        success: false,
        message: response.error || 'Deployment failed',
      };
    }

    const deployment = response.data?.deployments?.[0];
    return {
      success: true,
      message: deployment?.message || 'Deployment triggered',
      deploymentUuid: deployment?.deployment_uuid,
      applicationUuid: deployment?.resource_uuid || uuid,
    };
  }

  /**
   * Get the current deployment status
   */
  async getStatus(deploymentUuid?: string): Promise<DeploymentStatus | null> {
    // If specific deployment UUID provided, get that deployment
    if (deploymentUuid) {
      const response = await this.apiRequest<{
        uuid: string;
        application_uuid: string;
        status: string;
        message?: string;
        created_at?: string;
        finished_at?: string;
        commit?: string;
      }>(`/deployments/${deploymentUuid}`);

      if (!response.ok || !response.data) {
        return null;
      }

      return this.mapDeploymentStatus(response.data);
    }

    // Get latest deployment for the application
    if (!this.config.applicationUuid) {
      return null;
    }

    const response = await this.apiRequest<Array<{
      uuid: string;
      application_uuid: string;
      status: string;
      message?: string;
      created_at?: string;
      finished_at?: string;
      commit?: string;
    }>>(`/applications/${this.config.applicationUuid}/deployments`);

    if (!response.ok || !response.data || response.data.length === 0) {
      return null;
    }

    // Return the most recent deployment
    return this.mapDeploymentStatus(response.data[0]);
  }

  /**
   * Map Coolify API response to DeploymentStatus
   */
  private mapDeploymentStatus(data: {
    uuid: string;
    application_uuid: string;
    status: string;
    message?: string;
    created_at?: string;
    finished_at?: string;
    commit?: string;
  }): DeploymentStatus {
    // Map Coolify status strings to our enum
    let status: DeploymentStatus['status'] = 'in_progress';
    const rawStatus = data.status?.toLowerCase();
    if (rawStatus === 'finished' || rawStatus === 'success') {
      status = 'finished';
    } else if (rawStatus === 'failed' || rawStatus === 'error') {
      status = 'failed';
    } else if (rawStatus === 'cancelled' || rawStatus === 'canceled') {
      status = 'cancelled';
    } else if (rawStatus === 'queued' || rawStatus === 'pending') {
      status = 'queued';
    }

    return {
      deploymentUuid: data.uuid,
      applicationUuid: data.application_uuid,
      status,
      message: data.message || `Deployment ${status}`,
      startedAt: data.created_at,
      finishedAt: data.finished_at,
      commitSha: data.commit,
    };
  }

  /**
   * Get deployment or application logs
   */
  async getLogs(options: LogOptions = {}): Promise<string> {
    const { lines = 100, type = 'application', deploymentUuid } = options;

    // For deployment/build logs
    if (type === 'deployment') {
      if (deploymentUuid) {
        // Get specific deployment logs
        const response = await this.apiRequest<{ logs?: string }>(
          `/deployments/${deploymentUuid}/logs`
        );
        return response.data?.logs || '';
      }

      // Get latest deployment logs
      const status = await this.getStatus();
      if (status?.deploymentUuid) {
        const response = await this.apiRequest<{ logs?: string }>(
          `/deployments/${status.deploymentUuid}/logs`
        );
        return response.data?.logs || '';
      }

      return '';
    }

    // For application runtime logs
    if (!this.config.applicationUuid) {
      return '';
    }

    const response = await this.apiRequest<{ logs?: string }>(
      `/applications/${this.config.applicationUuid}/logs?lines=${lines}`
    );

    return response.data?.logs || '';
  }

  /**
   * Start the application
   */
  async start(): Promise<DeployResult> {
    if (!this.config.applicationUuid) {
      return {
        success: false,
        message: 'No application UUID configured',
      };
    }

    const response = await this.apiRequest(`/applications/${this.config.applicationUuid}/start`);
    return {
      success: response.ok,
      message: response.ok ? 'Application started' : (response.error || 'Failed to start'),
      applicationUuid: this.config.applicationUuid,
    };
  }

  /**
   * Stop the application
   */
  async stop(): Promise<DeployResult> {
    if (!this.config.applicationUuid) {
      return {
        success: false,
        message: 'No application UUID configured',
      };
    }

    const response = await this.apiRequest(`/applications/${this.config.applicationUuid}/stop`);
    return {
      success: response.ok,
      message: response.ok ? 'Application stopped' : (response.error || 'Failed to stop'),
      applicationUuid: this.config.applicationUuid,
    };
  }

  /**
   * Restart the application
   */
  async restart(): Promise<DeployResult> {
    if (!this.config.applicationUuid) {
      return {
        success: false,
        message: 'No application UUID configured',
      };
    }

    const response = await this.apiRequest(`/applications/${this.config.applicationUuid}/restart`);
    return {
      success: response.ok,
      message: response.ok ? 'Application restarted' : (response.error || 'Failed to restart'),
      applicationUuid: this.config.applicationUuid,
    };
  }

  /**
   * Check if the Coolify instance is reachable and credentials are valid
   */
  async validateConnection(): Promise<{ valid: boolean; message: string }> {
    const response = await this.apiRequest<{ team?: { name: string } }>('/teams/current');

    if (!response.ok) {
      if (response.status === 401) {
        return { valid: false, message: 'Invalid API token' };
      }
      return { valid: false, message: response.error || 'Connection failed' };
    }

    return { valid: true, message: 'Connection successful' };
  }

  /**
   * Get information about the deployment type used
   */
  getDeploymentType(): DeploymentType {
    // Check docker configuration
    if (this.deployConfig?.docker?.composeFile) {
      return 'docker-compose';
    }
    if (this.deployConfig?.docker?.dockerfile) {
      return 'dockerfile';
    }
    // Default to nixpacks (Coolify's default)
    return 'nixpacks';
  }

  /**
   * Check if this is a docker-compose deployment
   */
  isDockerCompose(): boolean {
    return this.getDeploymentType() === 'docker-compose';
  }

  /**
   * Check if this is a Dockerfile deployment
   */
  isDockerfile(): boolean {
    return this.getDeploymentType() === 'dockerfile';
  }
}

/**
 * Helper to create a CoolifyProvider from environment variables
 */
export function createCoolifyProviderFromEnv(): CoolifyProvider | null {
  const baseUrl = process.env.COOLIFY_BASE_URL;
  const apiToken = process.env.COOLIFY_API_TOKEN;
  const applicationUuid = process.env.COOLIFY_APP_UUID;
  const webhookUrl = process.env.COOLIFY_WEBHOOK_URL;

  if (!baseUrl || !apiToken) {
    return null;
  }

  return new CoolifyProvider({
    baseUrl,
    apiToken,
    applicationUuid,
    webhookUrl,
  });
}
