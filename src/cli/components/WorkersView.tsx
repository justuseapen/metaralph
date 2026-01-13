/**
 * WorkersView - Displays running workers in the dashboard
 *
 * Shows running workers with progress (iteration counts) and last output lines.
 * Automatically refreshes when data changes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { ExecutionRepository, type Execution } from '../../workers/execution.js';
import { TaskRepository, type Task } from '../../queue/index.js';
import { getProject, type Project } from '../../registry/index.js';

/**
 * Get the last N lines from output
 */
function getLastLines(output: string | null, numLines: number): string[] {
  if (!output) return [];
  const lines = output.split('\n').filter((line) => line.trim());
  return lines.slice(-numLines);
}

/**
 * Format elapsed time from start
 */
function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return '0s';

  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const elapsedMs = now - start;

  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Truncate string to max length with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

/**
 * Worker info with resolved task and project
 */
interface WorkerInfo {
  execution: Execution;
  task: Task | undefined;
  project: Project | undefined;
}

/**
 * Single worker card component
 */
function WorkerCard({ worker }: { worker: WorkerInfo }): React.ReactElement {
  const { execution, task, project } = worker;
  const lastLines = getLastLines(execution.ralphOutput, 3);
  const elapsed = formatElapsed(execution.startedAt);

  // Progress indicator based on iterations
  const iterations = execution.iterationsUsed;
  const maxIterations = 10; // Default max iterations
  const progressPercent = Math.min((iterations / maxIterations) * 100, 100);
  const progressWidth = 20;
  const filledWidth = Math.round((progressPercent / 100) * progressWidth);
  const progressBar = '█'.repeat(filledWidth) + '░'.repeat(progressWidth - filledWidth);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="green"
      paddingX={2}
      paddingY={1}
      marginBottom={1}
    >
      {/* Header row */}
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="green">
            {project?.name || 'Unknown Project'}
          </Text>
          <Text dimColor> ({truncate(execution.id, 8)})</Text>
        </Box>
        <Box>
          <Text color="cyan">{elapsed}</Text>
        </Box>
      </Box>

      {/* Task info */}
      <Box marginTop={1}>
        <Text dimColor>Task: </Text>
        <Text>{task?.title || 'Unknown Task'}</Text>
      </Box>

      {/* Progress bar */}
      <Box marginTop={1}>
        <Text dimColor>Progress: </Text>
        <Text color="green">{progressBar}</Text>
        <Text dimColor> {iterations}/{maxIterations} iterations</Text>
      </Box>

      {/* Last output lines */}
      {lastLines.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Last output:</Text>
          <Box marginLeft={2} flexDirection="column">
            {lastLines.map((line, i) => (
              <Text key={i} dimColor>
                {truncate(line, 60)}
              </Text>
            ))}
          </Box>
        </Box>
      )}

      {/* Status indicators */}
      <Box marginTop={1}>
        <Text dimColor>PID: </Text>
        <Text>{execution.pid ?? 'N/A'}</Text>
        <Text dimColor>  Status: </Text>
        <Text color="green">{execution.status}</Text>
      </Box>
    </Box>
  );
}

/**
 * Summary stats component
 */
function WorkerStats({
  running,
  completed,
  failed,
}: {
  running: number;
  completed: number;
  failed: number;
}): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={2} paddingY={1} justifyContent="space-around">
      <Box>
        <Text dimColor>Running: </Text>
        <Text color="green" bold>
          {running}
        </Text>
      </Box>
      <Box>
        <Text dimColor>Completed Today: </Text>
        <Text color="blue">{completed}</Text>
      </Box>
      <Box>
        <Text dimColor>Failed Today: </Text>
        <Text color="red">{failed}</Text>
      </Box>
    </Box>
  );
}

/**
 * WorkersView component - main workers display
 */
export function WorkersView(): React.ReactElement {
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [stats, setStats] = useState({ running: 0, completed: 0, failed: 0 });
  const [loading, setLoading] = useState(true);

  // Load running workers and calculate stats
  const loadWorkers = useCallback(() => {
    try {
      // Get running executions
      const runningExecutions = ExecutionRepository.findRunning();

      // Resolve task and project for each execution
      const workerInfos: WorkerInfo[] = runningExecutions.map((execution) => {
        const task = TaskRepository.findById(execution.taskId);
        const project = task ? getProject(task.projectId) : undefined;
        return { execution, task, project };
      });

      setWorkers(workerInfos);

      // Calculate today's stats (simplified - just counts running)
      setStats({
        running: runningExecutions.length,
        completed: 0, // Would need a more complex query for "today"
        failed: 0, // Would need a more complex query for "today"
      });

      setLoading(false);
    } catch (error) {
      console.error('Failed to load workers:', error);
      setLoading(false);
    }
  }, []);

  // Load workers and set up refresh interval
  useEffect(() => {
    loadWorkers();
    const interval = setInterval(loadWorkers, 2000);
    return () => clearInterval(interval);
  }, [loadWorkers]);

  if (loading) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>Loading workers...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} marginBottom={1}>
        <Text bold color="blue">Active Workers</Text>
        <Text dimColor> ({workers.length} running)</Text>
      </Box>

      <WorkerStats running={stats.running} completed={stats.completed} failed={stats.failed} />

      {workers.length === 0 ? (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text dimColor>No workers currently running.</Text>
          <Box marginTop={1}>
            <Text dimColor>Workers will appear here when tasks are being executed.</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>To start processing tasks:</Text>
          </Box>
          <Box marginLeft={2} flexDirection="column">
            <Text dimColor>1. Ensure the daemon is running: </Text>
            <Text bold>metaralph start</Text>
          </Box>
          <Box marginLeft={2} flexDirection="column" marginTop={1}>
            <Text dimColor>2. Add projects and create tasks</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          {workers.map((worker) => (
            <WorkerCard key={worker.execution.id} worker={worker} />
          ))}
        </Box>
      )}
    </Box>
  );
}

export default WorkersView;
