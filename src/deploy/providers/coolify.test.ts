/**
 * Tests for coolify.ts - Coolify Deployment Provider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CoolifyProvider,
  createCoolifyProviderFromEnv,
  type CoolifyConfig,
  type DeploymentStatus,
} from './coolify.js';
import type { Project } from '../../registry/index.js';
import type { DeploymentConfig } from '../config.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('coolify.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMockConfig = (overrides?: Partial<CoolifyConfig>): CoolifyConfig => ({
    baseUrl: 'https://coolify.example.com',
    apiToken: 'test-api-token',
    applicationUuid: 'app-uuid-123',
    ...overrides,
  });

  const createMockProject = (overrides?: Partial<Project>): Project => ({
    id: 'project-123',
    name: 'TestProject',
    path: '/path/to/project',
    group_id: null,
    deploy_config: null,
    added_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

  const createMockDeployConfig = (overrides?: Partial<DeploymentConfig>): DeploymentConfig => ({
    provider: 'coolify',
    environments: {
      staging: { branch: 'develop', autoDeploy: true },
      production: { branch: 'main', autoDeploy: false },
    },
    ...overrides,
  });

  describe('CoolifyProvider constructor', () => {
    it('should create a provider with the given config', () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);
      expect(provider).toBeInstanceOf(CoolifyProvider);
    });
  });

  describe('initWithDeployConfig', () => {
    it('should merge providerConfig with existing config', () => {
      const config = createMockConfig({ applicationUuid: 'original-uuid' });
      const provider = new CoolifyProvider(config);

      const deployConfig = createMockDeployConfig({
        providerConfig: {
          applicationUuid: 'new-uuid',
          serverUuid: 'server-123',
        },
      });

      provider.initWithDeployConfig(deployConfig);

      // Check deployment type (uses merged config)
      expect(provider.getDeploymentType()).toBe('nixpacks');
    });

    it('should handle deployConfig without providerConfig', () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);
      const deployConfig = createMockDeployConfig();

      provider.initWithDeployConfig(deployConfig);
      expect(provider.getDeploymentType()).toBe('nixpacks');
    });
  });

  describe('fromProject', () => {
    it('should return null when project has no deploy_config', () => {
      const project = createMockProject({ deploy_config: null });
      const provider = CoolifyProvider.fromProject(project);
      expect(provider).toBeNull();
    });

    it('should return null when provider is not coolify', () => {
      const deployConfig: DeploymentConfig = {
        provider: 'vercel',
        environments: {},
      };
      const project = createMockProject({
        deploy_config: JSON.stringify(deployConfig),
      });

      const provider = CoolifyProvider.fromProject(project);
      expect(provider).toBeNull();
    });

    it('should return null when coolifyConfig is missing baseUrl', () => {
      const deployConfig: DeploymentConfig = {
        provider: 'coolify',
        environments: {},
        providerConfig: {
          apiToken: 'test-token',
        },
      };
      const project = createMockProject({
        deploy_config: JSON.stringify(deployConfig),
      });

      const provider = CoolifyProvider.fromProject(project);
      expect(provider).toBeNull();
    });

    it('should return null when coolifyConfig is missing apiToken', () => {
      const deployConfig: DeploymentConfig = {
        provider: 'coolify',
        environments: {},
        providerConfig: {
          baseUrl: 'https://coolify.example.com',
        },
      };
      const project = createMockProject({
        deploy_config: JSON.stringify(deployConfig),
      });

      const provider = CoolifyProvider.fromProject(project);
      expect(provider).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const project = createMockProject({
        deploy_config: 'not valid json',
      });

      const provider = CoolifyProvider.fromProject(project);
      expect(provider).toBeNull();
    });

    it('should return a configured provider for valid coolify config', () => {
      const deployConfig: DeploymentConfig = {
        provider: 'coolify',
        environments: {},
        providerConfig: {
          baseUrl: 'https://coolify.example.com',
          apiToken: 'test-token',
          applicationUuid: 'app-uuid',
        },
      };
      const project = createMockProject({
        deploy_config: JSON.stringify(deployConfig),
      });

      const provider = CoolifyProvider.fromProject(project);
      expect(provider).toBeInstanceOf(CoolifyProvider);
    });
  });

  describe('deploy', () => {
    it('should deploy via webhook when webhookUrl is configured', async () => {
      const config = createMockConfig({
        webhookUrl: 'https://coolify.example.com/webhooks/abc123',
        applicationUuid: undefined,
      });
      const provider = new CoolifyProvider(config);
      const project = createMockProject();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: 'Deployment queued', deployment_uuid: 'deploy-123' }),
      });

      const result = await provider.deploy(project, 'staging');

      expect(result.success).toBe(true);
      expect(result.deploymentUuid).toBe('deploy-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://coolify.example.com/webhooks/abc123',
        expect.objectContaining({
          method: 'GET',
          headers: { Authorization: 'Bearer test-api-token' },
        })
      );
    });

    it('should add force parameter to webhook URL when force is true', async () => {
      const config = createMockConfig({
        webhookUrl: 'https://coolify.example.com/webhooks/abc123',
      });
      const provider = new CoolifyProvider(config);
      const project = createMockProject();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: 'Deployment queued' }),
      });

      await provider.deploy(project, 'staging', { force: true });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://coolify.example.com/webhooks/abc123?force=true',
        expect.any(Object)
      );
    });

    it('should return error when neither webhook nor applicationUuid is configured', async () => {
      const config = createMockConfig({
        webhookUrl: undefined,
        applicationUuid: undefined,
      });
      const provider = new CoolifyProvider(config);
      const project = createMockProject();

      const result = await provider.deploy(project, 'staging');

      expect(result.success).toBe(false);
      expect(result.message).toContain('No application UUID or webhook URL configured');
    });

    it('should deploy via UUID when applicationUuid is configured', async () => {
      const config = createMockConfig({
        webhookUrl: undefined,
        applicationUuid: 'app-uuid-123',
      });
      const provider = new CoolifyProvider(config);
      const project = createMockProject();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              deployments: [
                {
                  message: 'Deployment started',
                  resource_uuid: 'app-uuid-123',
                  deployment_uuid: 'deploy-456',
                },
              ],
            })
          ),
      });

      const result = await provider.deploy(project, 'staging');

      expect(result.success).toBe(true);
      expect(result.deploymentUuid).toBe('deploy-456');
      expect(result.applicationUuid).toBe('app-uuid-123');
    });

    it('should include prId in deploy request when provided', async () => {
      const config = createMockConfig({
        webhookUrl: undefined,
        applicationUuid: 'app-uuid-123',
      });
      const provider = new CoolifyProvider(config);
      const project = createMockProject();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ deployments: [] })),
      });

      await provider.deploy(project, 'staging', { prId: 42 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('pr=42'),
        expect.any(Object)
      );
    });

    it('should handle webhook deployment failure', async () => {
      const config = createMockConfig({
        webhookUrl: 'https://coolify.example.com/webhooks/abc123',
      });
      const provider = new CoolifyProvider(config);
      const project = createMockProject();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Webhook authentication failed'),
      });

      const result = await provider.deploy(project, 'staging');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Webhook deployment failed');
    });

    it('should handle network error during webhook deployment', async () => {
      const config = createMockConfig({
        webhookUrl: 'https://coolify.example.com/webhooks/abc123',
      });
      const provider = new CoolifyProvider(config);
      const project = createMockProject();

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.deploy(project, 'staging');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Network error');
    });

    it('should handle API failure during UUID deployment', async () => {
      const config = createMockConfig({
        webhookUrl: undefined,
        applicationUuid: 'app-uuid-123',
      });
      const provider = new CoolifyProvider(config);
      const project = createMockProject();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error'),
      });

      const result = await provider.deploy(project, 'staging');

      expect(result.success).toBe(false);
      expect(result.message).toContain('HTTP 500');
    });
  });

  describe('getStatus', () => {
    it('should get status by deploymentUuid when provided', async () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              uuid: 'deploy-123',
              application_uuid: 'app-uuid',
              status: 'finished',
              message: 'Deployment complete',
              created_at: '2024-01-01T00:00:00Z',
              finished_at: '2024-01-01T00:05:00Z',
              commit: 'abc123',
            })
          ),
      });

      const status = await provider.getStatus('deploy-123');

      expect(status).not.toBeNull();
      expect(status?.deploymentUuid).toBe('deploy-123');
      expect(status?.status).toBe('finished');
      expect(status?.commitSha).toBe('abc123');
    });

    it('should return null when deployment not found', async () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not found'),
      });

      const status = await provider.getStatus('non-existent');

      expect(status).toBeNull();
    });

    it('should get latest deployment for application when no deploymentUuid provided', async () => {
      const config = createMockConfig({ applicationUuid: 'app-uuid-123' });
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify([
              {
                uuid: 'deploy-latest',
                application_uuid: 'app-uuid-123',
                status: 'in_progress',
              },
              {
                uuid: 'deploy-old',
                application_uuid: 'app-uuid-123',
                status: 'finished',
              },
            ])
          ),
      });

      const status = await provider.getStatus();

      expect(status?.deploymentUuid).toBe('deploy-latest');
    });

    it('should return null when no applicationUuid and no deploymentUuid', async () => {
      const config = createMockConfig({ applicationUuid: undefined });
      const provider = new CoolifyProvider(config);

      const status = await provider.getStatus();

      expect(status).toBeNull();
    });

    it('should return null when no deployments exist', async () => {
      const config = createMockConfig({ applicationUuid: 'app-uuid-123' });
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify([])),
      });

      const status = await provider.getStatus();

      expect(status).toBeNull();
    });
  });

  describe('mapDeploymentStatus', () => {
    it('should map finished status', async () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              uuid: 'deploy-1',
              application_uuid: 'app-1',
              status: 'finished',
            })
          ),
      });

      const status = await provider.getStatus('deploy-1');
      expect(status?.status).toBe('finished');
    });

    it('should map success status to finished', async () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              uuid: 'deploy-1',
              application_uuid: 'app-1',
              status: 'success',
            })
          ),
      });

      const status = await provider.getStatus('deploy-1');
      expect(status?.status).toBe('finished');
    });

    it('should map failed status', async () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              uuid: 'deploy-1',
              application_uuid: 'app-1',
              status: 'failed',
            })
          ),
      });

      const status = await provider.getStatus('deploy-1');
      expect(status?.status).toBe('failed');
    });

    it('should map error status to failed', async () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              uuid: 'deploy-1',
              application_uuid: 'app-1',
              status: 'error',
            })
          ),
      });

      const status = await provider.getStatus('deploy-1');
      expect(status?.status).toBe('failed');
    });

    it('should map cancelled/canceled status', async () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              uuid: 'deploy-1',
              application_uuid: 'app-1',
              status: 'cancelled',
            })
          ),
      });

      const status = await provider.getStatus('deploy-1');
      expect(status?.status).toBe('cancelled');
    });

    it('should map queued/pending status', async () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              uuid: 'deploy-1',
              application_uuid: 'app-1',
              status: 'pending',
            })
          ),
      });

      const status = await provider.getStatus('deploy-1');
      expect(status?.status).toBe('queued');
    });

    it('should default to in_progress for unknown status', async () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              uuid: 'deploy-1',
              application_uuid: 'app-1',
              status: 'unknown-status',
            })
          ),
      });

      const status = await provider.getStatus('deploy-1');
      expect(status?.status).toBe('in_progress');
    });
  });

  describe('getLogs', () => {
    it('should get deployment logs by deploymentUuid', async () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ logs: 'Build output...\nDeploy success' })),
      });

      const logs = await provider.getLogs({ type: 'deployment', deploymentUuid: 'deploy-123' });

      expect(logs).toBe('Build output...\nDeploy success');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://coolify.example.com/api/v1/deployments/deploy-123/logs',
        expect.any(Object)
      );
    });

    it('should get latest deployment logs when no deploymentUuid provided', async () => {
      const config = createMockConfig({ applicationUuid: 'app-uuid-123' });
      const provider = new CoolifyProvider(config);

      // First call to get status
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify([
              { uuid: 'deploy-latest', application_uuid: 'app-uuid-123', status: 'finished' },
            ])
          ),
      });

      // Second call to get logs
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ logs: 'Latest deployment logs' })),
      });

      const logs = await provider.getLogs({ type: 'deployment' });

      expect(logs).toBe('Latest deployment logs');
    });

    it('should return empty string for deployment logs when no status available', async () => {
      const config = createMockConfig({ applicationUuid: undefined });
      const provider = new CoolifyProvider(config);

      const logs = await provider.getLogs({ type: 'deployment' });

      expect(logs).toBe('');
    });

    it('should get application logs', async () => {
      const config = createMockConfig({ applicationUuid: 'app-uuid-123' });
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ logs: 'Application runtime logs...' })),
      });

      const logs = await provider.getLogs({ type: 'application', lines: 50 });

      expect(logs).toBe('Application runtime logs...');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://coolify.example.com/api/v1/applications/app-uuid-123/logs?lines=50',
        expect.any(Object)
      );
    });

    it('should return empty string for application logs when no applicationUuid', async () => {
      const config = createMockConfig({ applicationUuid: undefined });
      const provider = new CoolifyProvider(config);

      const logs = await provider.getLogs({ type: 'application' });

      expect(logs).toBe('');
    });

    it('should use default values for options', async () => {
      const config = createMockConfig({ applicationUuid: 'app-uuid-123' });
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ logs: 'logs' })),
      });

      await provider.getLogs();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://coolify.example.com/api/v1/applications/app-uuid-123/logs?lines=100',
        expect.any(Object)
      );
    });
  });

  describe('start', () => {
    it('should start the application', async () => {
      const config = createMockConfig({ applicationUuid: 'app-uuid-123' });
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

      const result = await provider.start();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Application started');
      expect(result.applicationUuid).toBe('app-uuid-123');
    });

    it('should return error when no applicationUuid configured', async () => {
      const config = createMockConfig({ applicationUuid: undefined });
      const provider = new CoolifyProvider(config);

      const result = await provider.start();

      expect(result.success).toBe(false);
      expect(result.message).toBe('No application UUID configured');
    });

    it('should handle start failure', async () => {
      const config = createMockConfig({ applicationUuid: 'app-uuid-123' });
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      });

      const result = await provider.start();

      expect(result.success).toBe(false);
      expect(result.message).toContain('HTTP 500');
    });
  });

  describe('stop', () => {
    it('should stop the application', async () => {
      const config = createMockConfig({ applicationUuid: 'app-uuid-123' });
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

      const result = await provider.stop();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Application stopped');
      expect(result.applicationUuid).toBe('app-uuid-123');
    });

    it('should return error when no applicationUuid configured', async () => {
      const config = createMockConfig({ applicationUuid: undefined });
      const provider = new CoolifyProvider(config);

      const result = await provider.stop();

      expect(result.success).toBe(false);
      expect(result.message).toBe('No application UUID configured');
    });
  });

  describe('restart', () => {
    it('should restart the application', async () => {
      const config = createMockConfig({ applicationUuid: 'app-uuid-123' });
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

      const result = await provider.restart();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Application restarted');
      expect(result.applicationUuid).toBe('app-uuid-123');
    });

    it('should return error when no applicationUuid configured', async () => {
      const config = createMockConfig({ applicationUuid: undefined });
      const provider = new CoolifyProvider(config);

      const result = await provider.restart();

      expect(result.success).toBe(false);
      expect(result.message).toBe('No application UUID configured');
    });
  });

  describe('validateConnection', () => {
    it('should return valid when connection succeeds', async () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ team: { name: 'TestTeam' } })),
      });

      const result = await provider.validateConnection();

      expect(result.valid).toBe(true);
      expect(result.message).toBe('Connection successful');
    });

    it('should return invalid when token is wrong', async () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      const result = await provider.validateConnection();

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Invalid API token');
    });

    it('should return invalid when connection fails', async () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      const result = await provider.validateConnection();

      expect(result.valid).toBe(false);
      expect(result.message).toContain('HTTP 500');
    });
  });

  describe('getDeploymentType', () => {
    it('should return docker-compose when composeFile is configured', () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);
      provider.initWithDeployConfig(
        createMockDeployConfig({
          docker: { composeFile: 'docker-compose.yml' },
        })
      );

      expect(provider.getDeploymentType()).toBe('docker-compose');
    });

    it('should return dockerfile when dockerfile is configured', () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);
      provider.initWithDeployConfig(
        createMockDeployConfig({
          docker: { dockerfile: 'Dockerfile' },
        })
      );

      expect(provider.getDeploymentType()).toBe('dockerfile');
    });

    it('should return nixpacks as default', () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);
      provider.initWithDeployConfig(createMockDeployConfig());

      expect(provider.getDeploymentType()).toBe('nixpacks');
    });

    it('should return nixpacks when no deployConfig is set', () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);

      expect(provider.getDeploymentType()).toBe('nixpacks');
    });
  });

  describe('isDockerCompose', () => {
    it('should return true for docker-compose deployment', () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);
      provider.initWithDeployConfig(
        createMockDeployConfig({
          docker: { composeFile: 'docker-compose.yml' },
        })
      );

      expect(provider.isDockerCompose()).toBe(true);
    });

    it('should return false for other deployment types', () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);
      provider.initWithDeployConfig(createMockDeployConfig());

      expect(provider.isDockerCompose()).toBe(false);
    });
  });

  describe('isDockerfile', () => {
    it('should return true for dockerfile deployment', () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);
      provider.initWithDeployConfig(
        createMockDeployConfig({
          docker: { dockerfile: 'Dockerfile' },
        })
      );

      expect(provider.isDockerfile()).toBe(true);
    });

    it('should return false for other deployment types', () => {
      const config = createMockConfig();
      const provider = new CoolifyProvider(config);
      provider.initWithDeployConfig(createMockDeployConfig());

      expect(provider.isDockerfile()).toBe(false);
    });
  });

  describe('createCoolifyProviderFromEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return null when COOLIFY_BASE_URL is not set', () => {
      delete process.env.COOLIFY_BASE_URL;
      process.env.COOLIFY_API_TOKEN = 'test-token';

      const provider = createCoolifyProviderFromEnv();

      expect(provider).toBeNull();
    });

    it('should return null when COOLIFY_API_TOKEN is not set', () => {
      process.env.COOLIFY_BASE_URL = 'https://coolify.example.com';
      delete process.env.COOLIFY_API_TOKEN;

      const provider = createCoolifyProviderFromEnv();

      expect(provider).toBeNull();
    });

    it('should return provider with all env vars set', () => {
      process.env.COOLIFY_BASE_URL = 'https://coolify.example.com';
      process.env.COOLIFY_API_TOKEN = 'test-token';
      process.env.COOLIFY_APP_UUID = 'app-uuid-env';
      process.env.COOLIFY_WEBHOOK_URL = 'https://coolify.example.com/webhooks/xyz';

      const provider = createCoolifyProviderFromEnv();

      expect(provider).toBeInstanceOf(CoolifyProvider);
    });

    it('should return provider with only required env vars', () => {
      process.env.COOLIFY_BASE_URL = 'https://coolify.example.com';
      process.env.COOLIFY_API_TOKEN = 'test-token';
      delete process.env.COOLIFY_APP_UUID;
      delete process.env.COOLIFY_WEBHOOK_URL;

      const provider = createCoolifyProviderFromEnv();

      expect(provider).toBeInstanceOf(CoolifyProvider);
    });
  });

  describe('apiRequest error handling', () => {
    it('should handle network errors gracefully', async () => {
      const config = createMockConfig({ applicationUuid: 'app-uuid-123' });
      const provider = new CoolifyProvider(config);

      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await provider.start();

      expect(result.success).toBe(false);
      expect(result.message).toContain('ECONNREFUSED');
    });

    it('should handle non-Error exceptions', async () => {
      const config = createMockConfig({ applicationUuid: 'app-uuid-123' });
      const provider = new CoolifyProvider(config);

      mockFetch.mockRejectedValueOnce('string error');

      const result = await provider.start();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown error');
    });
  });
});
