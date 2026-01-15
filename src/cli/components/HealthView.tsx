/**
 * HealthView - Terminal UI component for viewing project and system health
 *
 * Provides:
 * - Self-improvement status section showing analysis time, proposals, and approvals
 * - Future: Project health overview with scores and trends
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { initDatabase, type DatabaseInstance } from '../../db/index.js';
import { listProjects, type Project } from '../../registry/index.js';
import { TaskRepository, type Task } from '../../queue/task.js';
import { getRegisteredSelfProjects } from '../../self-improve/index.js';

/**
 * Self-improvement status data
 */
interface SelfImprovementStatus {
  lastAnalysisTime: string | null;
  proposalsInQueue: number;
  pendingApprovals: number;
  recentResults: Array<{
    id: string;
    title: string;
    status: string;
    completedAt: string | null;
  }>;
  selfProjectsCount: number;
}

/**
 * Get risk score color
 */
function getRiskColor(score: number): string {
  if (score < 40) return 'green';
  if (score <= 70) return 'yellow';
  return 'red';
}

/**
 * Format date for display
 */
function formatDate(dateString: string | null): string {
  if (!dateString) return 'Never';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateString;
  }
}

/**
 * Self-Improvement Status Section Component
 */
function SelfImprovementSection({
  status,
  loading,
}: {
  status: SelfImprovementStatus | null;
  loading: boolean;
}): React.ReactElement {
  if (loading) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="magenta">Self-Improvement Status</Text>
        <Text color="gray">Loading...</Text>
      </Box>
    );
  }

  if (!status) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="magenta">Self-Improvement Status</Text>
        <Text color="gray">Unable to load self-improvement status.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text bold color="magenta">Self-Improvement Status</Text>

      {/* Summary stats row */}
      <Box flexDirection="row" marginTop={1} gap={4}>
        <Box flexDirection="column">
          <Text color="gray">Self-Managed Projects</Text>
          <Text bold color={status.selfProjectsCount > 0 ? 'cyan' : 'gray'}>
            {status.selfProjectsCount}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text color="gray">Last Analysis</Text>
          <Text bold color={status.lastAnalysisTime ? 'cyan' : 'gray'}>
            {formatDate(status.lastAnalysisTime)}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text color="gray">Proposals in Queue</Text>
          <Text bold color={status.proposalsInQueue > 0 ? 'yellow' : 'gray'}>
            {status.proposalsInQueue}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text color="gray">Pending Approvals</Text>
          <Text bold color={status.pendingApprovals > 0 ? 'red' : 'green'}>
            {status.pendingApprovals}
          </Text>
        </Box>
      </Box>

      {/* Recent results */}
      {status.recentResults.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">Recent Results</Text>
          {status.recentResults.map((result, index) => {
            const statusColor =
              result.status === 'completed' ? 'green' :
              result.status === 'failed' ? 'red' :
              result.status === 'running' ? 'yellow' : 'gray';

            return (
              <Box key={result.id} flexDirection="row" gap={2}>
                <Text color={statusColor}>
                  {result.status === 'completed' ? '✓' :
                   result.status === 'failed' ? '✗' :
                   result.status === 'running' ? '▶' : '○'}
                </Text>
                <Box width={40}>
                  <Text>{result.title.substring(0, 38)}</Text>
                </Box>
                <Text color="gray">{formatDate(result.completedAt)}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {status.selfProjectsCount === 0 && (
        <Box marginTop={1}>
          <Text color="gray" italic>
            No self-managed projects registered. Use "metaralph self-improve register" to enable.
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Placeholder Health Overview Section
 */
function HealthOverviewSection(): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">Project Health Overview</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          Project health metrics coming soon. This section will show:
        </Text>
        <Text color="gray">  - Health scores per project</Text>
        <Text color="gray">  - Trend indicators (improving/declining)</Text>
        <Text color="gray">  - Active alerts and recommendations</Text>
      </Box>
    </Box>
  );
}

/**
 * Main HealthView component
 */
export function HealthView(): React.ReactElement {
  const [selfImprovementStatus, setSelfImprovementStatus] = useState<SelfImprovementStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Load self-improvement data
  const loadSelfImprovementData = useCallback(() => {
    const db = initDatabase();
    try {
      // Get self-managed projects
      const selfProjects = getRegisteredSelfProjects(db);

      // Get self-improvement tasks
      const allTasks = db.prepare(`
        SELECT * FROM tasks
        WHERE source = 'self_improvement'
        ORDER BY created_at DESC
      `).all() as Array<{
        id: string;
        title: string;
        status: string;
        approval_status: string;
        updated_at: string;
        created_at: string;
      }>;

      // Calculate stats
      const proposalsInQueue = allTasks.filter(
        t => t.status === 'pending' || t.status === 'queued'
      ).length;

      const pendingApprovals = allTasks.filter(
        t => t.approval_status === 'pending'
      ).length;

      // Get last analysis time (most recent self-improvement task creation)
      const lastAnalysisTime = allTasks.length > 0 ? allTasks[0].created_at : null;

      // Get recent results (completed or failed tasks)
      const recentResults = allTasks
        .filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'running')
        .slice(0, 5)
        .map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          completedAt: t.updated_at,
        }));

      setSelfImprovementStatus({
        lastAnalysisTime,
        proposalsInQueue,
        pendingApprovals,
        recentResults,
        selfProjectsCount: selfProjects.length,
      });
      setLoading(false);
    } catch (error) {
      console.error('Error loading self-improvement data:', error);
      setLoading(false);
    } finally {
      db.close();
    }
  }, []);

  // Initial load and periodic refresh
  useEffect(() => {
    loadSelfImprovementData();
    // Refresh every 10 seconds
    const interval = setInterval(loadSelfImprovementData, 10000);
    return () => clearInterval(interval);
  }, [loadSelfImprovementData]);

  // Handle keyboard input
  useInput((input, _key) => {
    if (input === 'r') {
      setLoading(true);
      loadSelfImprovementData();
    }
  });

  return (
    <Box flexDirection="column" padding={1} flexGrow={1}>
      <SelfImprovementSection status={selfImprovementStatus} loading={loading} />
      <HealthOverviewSection />

      {/* Footer with shortcuts */}
      <Box marginTop={1}>
        <Text color="gray">
          r: Refresh | Press number keys to switch tabs
        </Text>
      </Box>
    </Box>
  );
}
