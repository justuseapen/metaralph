/**
 * ApprovalView - Displays tasks pending approval in the dashboard
 *
 * Shows pending tasks with full details.
 * Arrow keys navigate, 'a' approves, 'r' rejects.
 * Automatically refreshes when data changes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { ApprovalQueue, type Task } from '../../queue/index.js';
import { getProject } from '../../registry/index.js';
import { LoadingSpinner, RefreshingIndicator } from './LoadingStates.js';

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
 * Format effort level for display
 */
function formatEffort(effort: string): { text: string; color: string } {
  const effortMap: Record<string, { text: string; color: string }> = {
    quick_win: { text: 'Quick Win', color: 'greenBright' },
    small: { text: 'Small', color: 'green' },
    medium: { text: 'Medium', color: 'yellow' },
    large: { text: 'Large', color: 'red' },
  };
  return effortMap[effort] || { text: effort, color: 'white' };
}

/**
 * Truncate string to max length with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

/**
 * Task detail panel component
 */
function TaskDetail({ task }: { task: Task }): React.ReactElement {
  const [projectName, setProjectName] = useState<string>('Loading...');
  const effort = formatEffort(task.estimatedEffort);

  useEffect(() => {
    const project = getProject(task.projectId);
    setProjectName(project?.name || 'Unknown');
  }, [task.projectId]);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="yellow">Task Details</Text>
      </Box>

      <Box>
        <Box width={14}>
          <Text dimColor>ID:</Text>
        </Box>
        <Text>{task.id}</Text>
      </Box>

      <Box>
        <Box width={14}>
          <Text dimColor>Title:</Text>
        </Box>
        <Text bold>{task.title}</Text>
      </Box>

      <Box>
        <Box width={14}>
          <Text dimColor>Project:</Text>
        </Box>
        <Text>{projectName}</Text>
      </Box>

      <Box>
        <Box width={14}>
          <Text dimColor>Type:</Text>
        </Box>
        <Text>{formatType(task.type)}</Text>
      </Box>

      <Box>
        <Box width={14}>
          <Text dimColor>Effort:</Text>
        </Box>
        <Text color={effort.color}>{effort.text}</Text>
      </Box>

      <Box>
        <Box width={14}>
          <Text dimColor>Priority:</Text>
        </Box>
        <Text>{task.priorityScore}</Text>
      </Box>

      <Box>
        <Box width={14}>
          <Text dimColor>Source:</Text>
        </Box>
        <Text>{task.source}</Text>
      </Box>

      {task.description && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Description:</Text>
          <Box marginLeft={2}>
            <Text>{task.description}</Text>
          </Box>
        </Box>
      )}

      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          <Text bold color="green">a</Text> Approve  |
          <Text bold color="red">r</Text> Reject  |
          <Text bold>↑↓</Text> Navigate
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Task list item component
 */
function TaskListItem({ task, selected }: { task: Task; selected: boolean }): React.ReactElement {
  return (
    <Box paddingX={1}>
      <Text
        color={selected ? 'yellow' : undefined}
        bold={selected}
        inverse={selected}
      >
        {selected ? ' ▸ ' : '   '}
        {truncate(task.title, 50)}
        <Text dimColor> ({formatType(task.type)})</Text>
      </Text>
    </Box>
  );
}

/**
 * ApprovalView component - main approval queue display
 */
export function ApprovalView(): React.ReactElement {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [message, setMessage] = useState<{ text: string; color: string } | null>(null);

  // Create approval queue instance
  const approvalQueue = new ApprovalQueue();

  // Load pending tasks
  const loadTasks = useCallback(() => {
    // Show refreshing indicator for subsequent loads
    if (hasLoaded) {
      setIsRefreshing(true);
    }

    try {
      const pendingTasks = approvalQueue.getPending();
      setTasks(pendingTasks);
      // Adjust selection if tasks were removed
      if (selectedIndex >= pendingTasks.length && pendingTasks.length > 0) {
        setSelectedIndex(pendingTasks.length - 1);
      }
      setLoading(false);
      setHasLoaded(true);
      setIsRefreshing(false);
    } catch (error) {
      console.error('Failed to load pending tasks:', error);
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedIndex, hasLoaded]);

  // Load tasks and set up refresh interval
  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 2000);
    return () => clearInterval(interval);
  }, [loadTasks]);

  // Clear message after 3 seconds
  useEffect(() => {
    if (message) {
      const timeout = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timeout);
    }
  }, [message]);

  // Handle keyboard input
  useInput((input, key) => {
    if (tasks.length === 0) return;

    // Navigate up
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
      return;
    }

    // Navigate down
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < tasks.length - 1 ? prev + 1 : prev));
      return;
    }

    const selectedTask = tasks[selectedIndex];
    if (!selectedTask) return;

    // Approve task
    if (input === 'a') {
      const result = approvalQueue.approve(selectedTask.id);
      if (result.success) {
        setMessage({ text: `Approved: ${selectedTask.title}`, color: 'green' });
        loadTasks();
      } else {
        setMessage({ text: result.message, color: 'red' });
      }
      return;
    }

    // Reject task
    if (input === 'r') {
      const result = approvalQueue.reject(selectedTask.id);
      if (result.success) {
        setMessage({ text: `Rejected: ${selectedTask.title}`, color: 'red' });
        loadTasks();
      } else {
        setMessage({ text: result.message, color: 'red' });
      }
      return;
    }
  });

  if (loading) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="blue">Approval Queue</Text>
        </Box>
        <LoadingSpinner message="Loading approval queue..." />
      </Box>
    );
  }

  if (tasks.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="blue">Approval Queue</Text>
        <Box marginTop={1}>
          <Text dimColor>No tasks pending approval.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Tasks requiring manual review will appear here.</Text>
        </Box>
      </Box>
    );
  }

  const selectedTask = tasks[selectedIndex];

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} marginBottom={1}>
        <Text bold color="blue">Approval Queue</Text>
        <Text dimColor> ({tasks.length} pending)</Text>
        {isRefreshing && (
          <Box marginLeft={2}>
            <RefreshingIndicator visible={isRefreshing} />
          </Box>
        )}
      </Box>

      {/* Status message */}
      {message && (
        <Box paddingX={1} marginBottom={1}>
          <Text color={message.color}>{message.text}</Text>
        </Box>
      )}

      <Box flexDirection="row" flexGrow={1}>
        {/* Task list */}
        <Box flexDirection="column" width="40%" borderStyle="single" borderColor="gray">
          <Box paddingX={1} borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false}>
            <Text bold>Pending Tasks</Text>
          </Box>
          {tasks.map((task, index) => (
            <TaskListItem
              key={task.id}
              task={task}
              selected={index === selectedIndex}
            />
          ))}
        </Box>

        {/* Task details */}
        <Box flexDirection="column" width="60%" paddingLeft={1}>
          {selectedTask && <TaskDetail task={selectedTask} />}
        </Box>
      </Box>
    </Box>
  );
}

export default ApprovalView;
