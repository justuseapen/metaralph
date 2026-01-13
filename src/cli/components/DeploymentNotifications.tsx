/**
 * Deployment Notifications Component
 *
 * Displays deployment status notifications in the dashboard.
 * Shows recent deployments with their status, health check results, and timing.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { initDatabase } from '../../db/index.js';
import type { DeploymentRecord } from '../../deploy/staging.js';
import { listProjects, type Project } from '../../registry/index.js';

/**
 * Format a timestamp for display
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString();
}

/**
 * Calculate duration between two timestamps
 */
function formatDuration(start: string, end: string | null): string {
  if (!end) {
    const now = Date.now();
    const startTime = new Date(start).getTime();
    const seconds = Math.floor((now - startTime) / 1000);
    return `${seconds}s`;
  }

  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  const seconds = Math.floor((endTime - startTime) / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Get status color for a deployment status
 */
function getStatusColor(status: DeploymentRecord['status']): string {
  switch (status) {
    case 'success':
      return 'green';
    case 'failed':
      return 'red';
    case 'in_progress':
      return 'yellow';
    case 'pending':
      return 'gray';
    case 'cancelled':
      return 'magenta';
    default:
      return 'white';
  }
}

/**
 * Get status icon for a deployment status
 */
function getStatusIcon(status: DeploymentRecord['status']): string {
  switch (status) {
    case 'success':
      return '[OK]';
    case 'failed':
      return '[X]';
    case 'in_progress':
      return '[...]';
    case 'pending':
      return '[?]';
    case 'cancelled':
      return '[-]';
    default:
      return '[ ]';
  }
}

/**
 * Single deployment notification item
 */
function DeploymentItem({
  deployment,
  projectName,
}: {
  deployment: DeploymentRecord;
  projectName: string;
}): React.ReactElement {
  const statusColor = getStatusColor(deployment.status);
  const statusIcon = getStatusIcon(deployment.status);
  const duration = formatDuration(deployment.started_at, deployment.completed_at);
  const time = formatTime(deployment.started_at);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" gap={1}>
        <Text color={statusColor}>{statusIcon}</Text>
        <Text bold>{projectName}</Text>
        <Text color="gray">-</Text>
        <Text color="cyan">{deployment.environment}</Text>
        <Text color="gray">({deployment.provider})</Text>
      </Box>
      <Box flexDirection="row" gap={1} marginLeft={5}>
        <Text color="gray">Started: {time}</Text>
        <Text color="gray">|</Text>
        <Text color="gray">Duration: {duration}</Text>
        {deployment.health_check_passed !== null && (
          <>
            <Text color="gray">|</Text>
            <Text color={deployment.health_check_passed ? 'green' : 'red'}>
              Health: {deployment.health_check_passed ? 'PASS' : 'FAIL'}
            </Text>
          </>
        )}
      </Box>
      {deployment.error_message && (
        <Box marginLeft={5}>
          <Text color="red">Error: {deployment.error_message}</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Props for DeploymentNotifications component
 */
interface DeploymentNotificationsProps {
  /** Maximum number of deployments to show */
  limit?: number;
  /** Only show deployments for this project ID */
  projectId?: string;
  /** Refresh interval in milliseconds (0 to disable) */
  refreshInterval?: number;
}

/**
 * DeploymentNotifications - Shows recent deployment activity
 */
export function DeploymentNotifications({
  limit = 5,
  projectId,
  refreshInterval = 5000,
}: DeploymentNotificationsProps): React.ReactElement {
  const [deployments, setDeployments] = useState<Array<{
    deployment: DeploymentRecord;
    projectName: string;
  }>>([]);
  const [loading, setLoading] = useState(true);

  const loadDeployments = () => {
    try {
      const db = initDatabase();

      // Get projects for name mapping
      const projects = listProjects(db);
      const projectMap = new Map<string, Project>(
        projects.map((p) => [p.id, p])
      );

      // Query deployments
      let query = `
        SELECT * FROM deployments
        ${projectId ? 'WHERE project_id = ?' : ''}
        ORDER BY created_at DESC
        LIMIT ?
      `;

      const params = projectId ? [projectId, limit] : [limit];

      // Check if deployments table exists
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='deployments'"
      ).all() as Array<{ name: string }>;

      if (tables.length === 0) {
        setDeployments([]);
        setLoading(false);
        db.close();
        return;
      }

      const rows = db.prepare(query).all(...params) as Array<{
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

      const result = rows.map((row) => {
        const project = projectMap.get(row.project_id);
        return {
          deployment: {
            ...row,
            environment: row.environment as 'staging' | 'production',
            status: row.status as DeploymentRecord['status'],
            health_check_passed:
              row.health_check_passed === null ? null : row.health_check_passed === 1,
          },
          projectName: project?.name || 'Unknown Project',
        };
      });

      setDeployments(result);
      setLoading(false);
      db.close();
    } catch {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDeployments();

    if (refreshInterval > 0) {
      const interval = setInterval(loadDeployments, refreshInterval);
      return () => clearInterval(interval);
    }
    return;
  }, [projectId, limit, refreshInterval]);

  if (loading) {
    return (
      <Box>
        <Text color="gray">Loading deployments...</Text>
      </Box>
    );
  }

  if (deployments.length === 0) {
    return (
      <Box>
        <Text color="gray">No recent deployments</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="blue">Recent Deployments</Text>
      </Box>
      {deployments.map(({ deployment, projectName }) => (
        <DeploymentItem
          key={deployment.id}
          deployment={deployment}
          projectName={projectName}
        />
      ))}
    </Box>
  );
}

/**
 * Compact notification bar for header/footer
 */
export function DeploymentStatusBar(): React.ReactElement {
  const [latestDeployment, setLatestDeployment] = useState<{
    deployment: DeploymentRecord;
    projectName: string;
  } | null>(null);

  useEffect(() => {
    const loadLatest = () => {
      try {
        const db = initDatabase();

        // Check if deployments table exists
        const tables = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='deployments'"
        ).all() as Array<{ name: string }>;

        if (tables.length === 0) {
          db.close();
          return;
        }

        const row = db.prepare(`
          SELECT d.*, p.name as project_name
          FROM deployments d
          LEFT JOIN projects p ON d.project_id = p.id
          ORDER BY d.created_at DESC
          LIMIT 1
        `).get() as {
          id: string;
          project_id: string;
          project_name: string | null;
          status: string;
          environment: string;
          provider: string;
          started_at: string;
          completed_at: string | null;
        } | undefined;

        if (row) {
          setLatestDeployment({
            deployment: {
              id: row.id,
              project_id: row.project_id,
              task_id: null,
              environment: row.environment as 'staging' | 'production',
              provider: row.provider,
              status: row.status as DeploymentRecord['status'],
              deployment_uuid: null,
              health_check_passed: null,
              health_check_url: null,
              error_message: null,
              started_at: row.started_at,
              completed_at: row.completed_at,
              created_at: row.started_at,
            },
            projectName: row.project_name || 'Unknown',
          });
        }

        db.close();
      } catch {
        // Ignore errors
      }
    };

    loadLatest();
    const interval = setInterval(loadLatest, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!latestDeployment) {
    return <Text color="gray">No deployments</Text>;
  }

  const { deployment, projectName } = latestDeployment;
  const statusColor = getStatusColor(deployment.status);
  const icon = getStatusIcon(deployment.status);

  return (
    <Box flexDirection="row" gap={1}>
      <Text color="gray">Deploy:</Text>
      <Text color={statusColor}>{icon}</Text>
      <Text>{projectName}</Text>
      <Text color="cyan">{deployment.environment}</Text>
    </Box>
  );
}
