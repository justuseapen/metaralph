/**
 * Staging Auto-Deploy Module
 *
 * Automatically deploys projects to staging when tasks complete successfully.
 * Integrates with the task completion flow, health checks, and dashboard notifications.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Project } from '../registry/index.js';
import type { Task } from '../queue/task.js';
import { initDatabase, type DatabaseInstance } from '../db/index.js';
import { CoolifyProvider, type DeploymentStatus } from './providers/coolify.js';
import { parseConfig, type DeploymentConfig } from './config.js';

/**
 * Deployment record stored in the database
 */
export interface DeploymentRecord {
  id: string;
  project_id: string;
  task_id: string | null;
  environment: 'staging' | 'production';
  provider: string;
  status: 'pending' | 'in_progress' | 'success' | 'failed' | 'cancelled';
  deployment_uuid: string | null;
  health_check_passed: boolean | null;
  health_check_url: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

/**
 * Result of a staging deployment operation
 */
export interface StagingDeployResult {
  success: boolean;
  message: string;
  deploymentRecord?: DeploymentRecord;
  healthCheckPassed?: boolean | null;
}

/**
 * Options for the staging deployer
 */
export interface StagingDeployerOptions {
  /** Timeout for health check in milliseconds (default: 30000) */
  healthCheckTimeout?: number;
  /** Number of retries for health check (default: 3) */
  healthCheckRetries?: number;
  /** Delay between health check retries in milliseconds (default: 5000) */
  healthCheckDelay?: number;
  /** Whether to wait for deployment to complete before returning (default: true) */
  waitForCompletion?: boolean;
  /** Maximum time to wait for deployment in milliseconds (default: 300000 / 5 min) */
  deploymentTimeout?: number;
}

/**
 * Notification callback for deployment status updates
 */
export type DeploymentNotificationCallback = (
  projectId: string,
  status: DeploymentRecord['status'],
  message: string,
  record: DeploymentRecord
) => void;

/**
 * StagingDeployer - Handles automatic staging deployments on task completion
 *
 * @example
 * ```typescript
 * const deployer = new StagingDeployer();
 *
 * // Register notification callback for dashboard updates
 * deployer.onNotification((projectId, status, message, record) => {
 *   console.log(`[${projectId}] ${status}: ${message}`);
 * });
 *
 * // Trigger deployment on task completion
 * const result = await deployer.onTaskCompleted(task, project);
 * ```
 */
export class StagingDeployer {
  private options: Required<StagingDeployerOptions>;
  private notificationCallbacks: DeploymentNotificationCallback[] = [];

  constructor(options: StagingDeployerOptions = {}) {
    this.options = {
      healthCheckTimeout: options.healthCheckTimeout ?? 30000,
      healthCheckRetries: options.healthCheckRetries ?? 3,
      healthCheckDelay: options.healthCheckDelay ?? 5000,
      waitForCompletion: options.waitForCompletion ?? true,
      deploymentTimeout: options.deploymentTimeout ?? 300000,
    };
  }

  /**
   * Register a callback for deployment notifications
   */
  onNotification(callback: DeploymentNotificationCallback): void {
    this.notificationCallbacks.push(callback);
  }

  /**
   * Remove a notification callback
   */
  offNotification(callback: DeploymentNotificationCallback): void {
    const index = this.notificationCallbacks.indexOf(callback);
    if (index > -1) {
      this.notificationCallbacks.splice(index, 1);
    }
  }

  /**
   * Emit a notification to all registered callbacks
   */
  private notify(
    projectId: string,
    status: DeploymentRecord['status'],
    message: string,
    record: DeploymentRecord
  ): void {
    for (const callback of this.notificationCallbacks) {
      try {
        callback(projectId, status, message, record);
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Check if a project has staging auto-deploy configured
   */
  hasStagingConfig(project: Project): boolean {
    if (!project.deploy_config) {
      return false;
    }

    const config = parseConfig(project.deploy_config);
    if (!config) {
      return false;
    }

    // Check if staging environment is configured with autoDeploy enabled
    return config.environments.staging?.autoDeploy === true;
  }

  /**
   * Handle task completion - triggers staging deployment if configured
   *
   * @param task - The completed task
   * @param project - The project the task belongs to
   * @param db - Optional database instance
   * @returns Result of the deployment operation
   */
  async onTaskCompleted(
    task: Task,
    project: Project,
    db?: DatabaseInstance
  ): Promise<StagingDeployResult> {
    // Check if staging auto-deploy is configured
    if (!this.hasStagingConfig(project)) {
      return {
        success: true,
        message: 'Staging auto-deploy not configured for this project',
      };
    }

    // Trigger the deployment
    return this.deploy(project, task, db);
  }

  /**
   * Deploy a project to staging
   *
   * @param project - The project to deploy
   * @param task - Optional task that triggered the deployment
   * @param db - Optional database instance
   * @returns Result of the deployment operation
   */
  async deploy(
    project: Project,
    task?: Task,
    db?: DatabaseInstance
  ): Promise<StagingDeployResult> {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      // Parse deployment config
      const config = parseConfig(project.deploy_config);
      if (!config) {
        return {
          success: false,
          message: 'Invalid deployment configuration',
        };
      }

      // Create deployment record
      const record = this.createDeploymentRecord(
        project,
        task ?? null,
        config,
        database
      );

      this.notify(project.id, 'pending', 'Deployment initiated', record);

      // Get the provider
      const provider = this.getProvider(project, config);
      if (!provider) {
        const error = 'Failed to initialize deployment provider';
        this.updateDeploymentRecord(record.id, {
          status: 'failed',
          error_message: error,
          completed_at: new Date().toISOString(),
        }, database);
        record.status = 'failed';
        record.error_message = error;
        this.notify(project.id, 'failed', error, record);
        return {
          success: false,
          message: error,
          deploymentRecord: record,
        };
      }

      // Update status to in_progress
      this.updateDeploymentRecord(record.id, { status: 'in_progress' }, database);
      record.status = 'in_progress';
      this.notify(project.id, 'in_progress', 'Deployment in progress', record);

      // Trigger deployment
      const deployResult = await provider.deploy(project, 'staging');

      if (!deployResult.success) {
        const error = deployResult.message || 'Deployment failed';
        this.updateDeploymentRecord(record.id, {
          status: 'failed',
          error_message: error,
          completed_at: new Date().toISOString(),
        }, database);
        record.status = 'failed';
        record.error_message = error;
        this.notify(project.id, 'failed', error, record);
        return {
          success: false,
          message: error,
          deploymentRecord: record,
        };
      }

      // Update with deployment UUID if available
      if (deployResult.deploymentUuid) {
        this.updateDeploymentRecord(record.id, {
          deployment_uuid: deployResult.deploymentUuid,
        }, database);
        record.deployment_uuid = deployResult.deploymentUuid;
      }

      // Wait for deployment to complete if configured
      if (this.options.waitForCompletion) {
        const completionResult = await this.waitForDeploymentCompletion(
          provider,
          deployResult.deploymentUuid
        );

        if (!completionResult.success) {
          this.updateDeploymentRecord(record.id, {
            status: 'failed',
            error_message: completionResult.message,
            completed_at: new Date().toISOString(),
          }, database);
          record.status = 'failed';
          record.error_message = completionResult.message;
          this.notify(project.id, 'failed', completionResult.message, record);
          return {
            success: false,
            message: completionResult.message,
            deploymentRecord: record,
          };
        }
      }

      // Run health check
      const healthCheckUrl = this.getHealthCheckUrl(project, config);
      let healthCheckPassed: boolean | null = null;

      if (healthCheckUrl) {
        this.updateDeploymentRecord(record.id, {
          health_check_url: healthCheckUrl,
        }, database);
        record.health_check_url = healthCheckUrl;

        this.notify(project.id, 'in_progress', 'Running health check', record);
        healthCheckPassed = await this.runHealthCheck(healthCheckUrl);

        this.updateDeploymentRecord(record.id, {
          health_check_passed: healthCheckPassed,
        }, database);
        record.health_check_passed = healthCheckPassed;

        if (!healthCheckPassed) {
          const error = 'Health check failed';
          this.updateDeploymentRecord(record.id, {
            status: 'failed',
            error_message: error,
            completed_at: new Date().toISOString(),
          }, database);
          record.status = 'failed';
          record.error_message = error;
          this.notify(project.id, 'failed', error, record);
          return {
            success: false,
            message: error,
            deploymentRecord: record,
            healthCheckPassed: false,
          };
        }
      }

      // Mark deployment as successful
      this.updateDeploymentRecord(record.id, {
        status: 'success',
        completed_at: new Date().toISOString(),
      }, database);
      record.status = 'success';
      record.completed_at = new Date().toISOString();

      const successMessage = healthCheckPassed
        ? 'Deployment successful, health check passed'
        : 'Deployment successful';
      this.notify(project.id, 'success', successMessage, record);

      return {
        success: true,
        message: successMessage,
        deploymentRecord: record,
        healthCheckPassed,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  }

  /**
   * Create a deployment record in the database
   */
  private createDeploymentRecord(
    project: Project,
    task: Task | null,
    config: DeploymentConfig,
    db: DatabaseInstance
  ): DeploymentRecord {
    // Ensure deployments table exists
    this.ensureDeploymentsTable(db);

    const id = uuidv4();
    const now = new Date().toISOString();

    const record: DeploymentRecord = {
      id,
      project_id: project.id,
      task_id: task?.id ?? null,
      environment: 'staging',
      provider: config.provider,
      status: 'pending',
      deployment_uuid: null,
      health_check_passed: null,
      health_check_url: null,
      error_message: null,
      started_at: now,
      completed_at: null,
      created_at: now,
    };

    db.prepare(`
      INSERT INTO deployments (
        id, project_id, task_id, environment, provider, status,
        deployment_uuid, health_check_passed, health_check_url,
        error_message, started_at, completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.project_id,
      record.task_id,
      record.environment,
      record.provider,
      record.status,
      record.deployment_uuid,
      record.health_check_passed === null ? null : (record.health_check_passed ? 1 : 0),
      record.health_check_url,
      record.error_message,
      record.started_at,
      record.completed_at,
      record.created_at
    );

    return record;
  }

  /**
   * Update a deployment record in the database
   */
  private updateDeploymentRecord(
    id: string,
    updates: Partial<Omit<DeploymentRecord, 'id' | 'created_at'>>,
    db: DatabaseInstance
  ): void {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.deployment_uuid !== undefined) {
      setClauses.push('deployment_uuid = ?');
      values.push(updates.deployment_uuid);
    }
    if (updates.health_check_passed !== undefined) {
      setClauses.push('health_check_passed = ?');
      values.push(updates.health_check_passed === null ? null : (updates.health_check_passed ? 1 : 0));
    }
    if (updates.health_check_url !== undefined) {
      setClauses.push('health_check_url = ?');
      values.push(updates.health_check_url);
    }
    if (updates.error_message !== undefined) {
      setClauses.push('error_message = ?');
      values.push(updates.error_message);
    }
    if (updates.completed_at !== undefined) {
      setClauses.push('completed_at = ?');
      values.push(updates.completed_at);
    }

    if (setClauses.length === 0) {
      return;
    }

    values.push(id);
    db.prepare(`UPDATE deployments SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  }

  /**
   * Ensure the deployments table exists (migration for existing databases)
   */
  private ensureDeploymentsTable(db: DatabaseInstance): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS deployments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_id TEXT,
        environment TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        deployment_uuid TEXT,
        health_check_passed INTEGER,
        health_check_url TEXT,
        error_message TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);
      CREATE INDEX IF NOT EXISTS idx_deployments_task_id ON deployments(task_id);
      CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
    `);
  }

  /**
   * Get the deployment provider for a project
   */
  private getProvider(project: Project, config: DeploymentConfig): CoolifyProvider | null {
    if (config.provider !== 'coolify') {
      // Only Coolify is implemented currently
      return null;
    }

    return CoolifyProvider.fromProject(project);
  }

  /**
   * Get the health check URL for a project
   */
  private getHealthCheckUrl(project: Project, config: DeploymentConfig): string | null {
    const healthCheckPath = config.healthCheckUrl;
    const stagingUrl = config.environments.staging?.url;

    if (!healthCheckPath || !stagingUrl) {
      return null;
    }

    // Combine staging URL with health check path
    const baseUrl = stagingUrl.replace(/\/$/, '');
    const path = healthCheckPath.startsWith('/') ? healthCheckPath : `/${healthCheckPath}`;
    return `${baseUrl}${path}`;
  }

  /**
   * Wait for a deployment to complete
   */
  private async waitForDeploymentCompletion(
    provider: CoolifyProvider,
    deploymentUuid?: string
  ): Promise<{ success: boolean; message: string; status?: DeploymentStatus }> {
    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds

    while (Date.now() - startTime < this.options.deploymentTimeout) {
      const status = await provider.getStatus(deploymentUuid);

      if (!status) {
        await this.sleep(pollInterval);
        continue;
      }

      if (status.status === 'finished') {
        return {
          success: true,
          message: 'Deployment completed successfully',
          status,
        };
      }

      if (status.status === 'failed') {
        return {
          success: false,
          message: status.message || 'Deployment failed',
          status,
        };
      }

      if (status.status === 'cancelled') {
        return {
          success: false,
          message: 'Deployment was cancelled',
          status,
        };
      }

      // Still in progress, wait and poll again
      await this.sleep(pollInterval);
    }

    return {
      success: false,
      message: 'Deployment timed out',
    };
  }

  /**
   * Run a health check against the deployment
   */
  private async runHealthCheck(url: string): Promise<boolean> {
    for (let attempt = 0; attempt < this.options.healthCheckRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          this.options.healthCheckTimeout
        );

        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          return true;
        }
      } catch {
        // Ignore fetch errors, will retry
      }

      // Wait before retrying (unless this is the last attempt)
      if (attempt < this.options.healthCheckRetries - 1) {
        await this.sleep(this.options.healthCheckDelay);
      }
    }

    return false;
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Get deployment records for a project
 *
 * @param projectId - ID of the project
 * @param limit - Maximum number of records to return (default: 10)
 * @param db - Optional database instance
 * @returns Array of deployment records
 */
export function getDeploymentRecords(
  projectId: string,
  limit: number = 10,
  db?: DatabaseInstance
): DeploymentRecord[] {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    // Ensure table exists
    database.exec(`
      CREATE TABLE IF NOT EXISTS deployments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_id TEXT,
        environment TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        deployment_uuid TEXT,
        health_check_passed INTEGER,
        health_check_url TEXT,
        error_message TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
      )
    `);

    const rows = database.prepare(`
      SELECT * FROM deployments
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(projectId, limit) as Array<{
      id: string;
      project_id: string;
      task_id: string | null;
      environment: string;
      provider: string;
      status: string;
      deployment_uuid: string | null;
      health_check_passed: number | null;
      health_check_url: string | null;
      error_message: string | null;
      started_at: string;
      completed_at: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      ...row,
      environment: row.environment as 'staging' | 'production',
      status: row.status as DeploymentRecord['status'],
      health_check_passed: row.health_check_passed === null ? null : row.health_check_passed === 1,
    }));
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * Get the latest deployment record for a project
 *
 * @param projectId - ID of the project
 * @param db - Optional database instance
 * @returns The latest deployment record or undefined
 */
export function getLatestDeploymentRecord(
  projectId: string,
  db?: DatabaseInstance
): DeploymentRecord | undefined {
  const records = getDeploymentRecords(projectId, 1, db);
  return records[0];
}
