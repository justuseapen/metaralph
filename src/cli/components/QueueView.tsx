/**
 * QueueView - Displays the task queue in the dashboard
 *
 * Shows tasks in a table with: Priority, ID, Project, Type, Status
 * Automatically refreshes when data changes.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { TaskRepository, type Task, type TaskStatus } from '../../queue/index.js';
import { getProject } from '../../registry/index.js';

/**
 * Format a task status for display
 */
function formatStatus(status: TaskStatus): { text: string; color: string } {
  const statusMap: Record<TaskStatus, { text: string; color: string }> = {
    pending: { text: 'Pending', color: 'yellow' },
    approved: { text: 'Approved', color: 'cyan' },
    queued: { text: 'Queued', color: 'blue' },
    running: { text: 'Running', color: 'green' },
    completed: { text: 'Completed', color: 'greenBright' },
    failed: { text: 'Failed', color: 'red' },
  };
  return statusMap[status] || { text: status, color: 'white' };
}

/**
 * Format a task type for display
 */
function formatType(type: string): string {
  const typeMap: Record<string, string> = {
    bug_fix: 'Bug Fix',
    test: 'Test',
    docs: 'Docs',
    refactor: 'Refactor',
    feature: 'Feature',
  };
  return typeMap[type] || type;
}

/**
 * Truncate string to max length with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

/**
 * Table header component
 */
function TableHeader(): React.ReactElement {
  return (
    <Box borderStyle="single" borderBottom={false} paddingX={1}>
      <Box width={8}>
        <Text bold color="cyan">Priority</Text>
      </Box>
      <Box width={10}>
        <Text bold color="cyan">ID</Text>
      </Box>
      <Box width={16}>
        <Text bold color="cyan">Project</Text>
      </Box>
      <Box width={10}>
        <Text bold color="cyan">Type</Text>
      </Box>
      <Box width={12}>
        <Text bold color="cyan">Status</Text>
      </Box>
      <Box flexGrow={1}>
        <Text bold color="cyan">Title</Text>
      </Box>
    </Box>
  );
}

/**
 * Table row component for a single task
 */
function TaskRow({ task, index }: { task: Task; index: number }): React.ReactElement {
  const [projectName, setProjectName] = useState<string>('Loading...');
  const status = formatStatus(task.status);

  useEffect(() => {
    const project = getProject(task.projectId);
    setProjectName(project?.name || 'Unknown');
  }, [task.projectId]);

  const bgColor = index % 2 === 0 ? undefined : undefined;

  return (
    <Box paddingX={1}>
      <Box width={8}>
        <Text>{task.priorityScore}</Text>
      </Box>
      <Box width={10}>
        <Text dimColor>{truncate(task.id, 8)}</Text>
      </Box>
      <Box width={16}>
        <Text>{truncate(projectName, 14)}</Text>
      </Box>
      <Box width={10}>
        <Text>{formatType(task.type)}</Text>
      </Box>
      <Box width={12}>
        <Text color={status.color}>{status.text}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text>{truncate(task.title, 40)}</Text>
      </Box>
    </Box>
  );
}

/**
 * QueueView component - main task queue display
 */
export function QueueView(): React.ReactElement {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  // Load tasks and set up refresh interval
  useEffect(() => {
    const loadTasks = () => {
      try {
        const pendingTasks = TaskRepository.findPending();
        setTasks(pendingTasks);
        setLoading(false);
      } catch (error) {
        console.error('Failed to load tasks:', error);
        setLoading(false);
      }
    };

    // Load immediately
    loadTasks();

    // Refresh every 2 seconds
    const interval = setInterval(loadTasks, 2000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>Loading task queue...</Text>
      </Box>
    );
  }

  if (tasks.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="blue">Task Queue</Text>
        <Box marginTop={1}>
          <Text dimColor>No pending tasks in the queue.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Add a project and create tasks to see them here.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} marginBottom={1}>
        <Text bold color="blue">Task Queue</Text>
        <Text dimColor> ({tasks.length} task{tasks.length !== 1 ? 's' : ''})</Text>
      </Box>
      <TableHeader />
      <Box flexDirection="column" borderStyle="single" borderTop={false}>
        {tasks.map((task, index) => (
          <TaskRow key={task.id} task={task} index={index} />
        ))}
      </Box>
    </Box>
  );
}

export default QueueView;
