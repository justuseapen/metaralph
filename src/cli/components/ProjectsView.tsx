/**
 * ProjectsView - Displays registered projects in the dashboard
 *
 * Shows projects grouped by group with health scores.
 * 'a' to add project, 'd' to remove with confirmation.
 * Automatically refreshes when data changes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { listProjects, addProject, removeProject, type Project } from '../../registry/index.js';
import { TaskRepository } from '../../queue/index.js';

/**
 * Calculate a simple health score for a project based on task metrics
 * Score 0-100: based on completed vs failed tasks
 */
function calculateHealthScore(projectId: string): { score: number; color: string } {
  const tasks = TaskRepository.findByProject(projectId);

  if (tasks.length === 0) {
    return { score: 100, color: 'gray' }; // New project, no tasks yet
  }

  const completed = tasks.filter((t) => t.status === 'completed').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const total = completed + failed;

  if (total === 0) {
    return { score: 100, color: 'gray' }; // All tasks still pending
  }

  const score = Math.round((completed / total) * 100);

  let color: string;
  if (score >= 90) {
    color = 'greenBright';
  } else if (score >= 70) {
    color = 'green';
  } else if (score >= 50) {
    color = 'yellow';
  } else {
    color = 'red';
  }

  return { score, color };
}

/**
 * Get task stats for a project
 */
function getProjectStats(projectId: string): { pending: number; running: number; completed: number; failed: number } {
  const tasks = TaskRepository.findByProject(projectId);

  return {
    pending: tasks.filter((t) => t.status === 'pending' || t.status === 'queued').length,
    running: tasks.filter((t) => t.status === 'running').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
  };
}

/**
 * Truncate string to max length with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

/**
 * Project list item component
 */
function ProjectListItem({
  project,
  selected,
  confirmDelete,
}: {
  project: Project;
  selected: boolean;
  confirmDelete: boolean;
}): React.ReactElement {
  const health = calculateHealthScore(project.id);
  const stats = getProjectStats(project.id);

  return (
    <Box paddingX={1}>
      <Box width={3}>
        <Text color={selected ? 'yellow' : undefined} bold={selected}>
          {selected ? ' ▸' : '  '}
        </Text>
      </Box>
      <Box width={20}>
        <Text color={selected ? 'yellow' : undefined} bold={selected}>
          {truncate(project.name, 18)}
        </Text>
      </Box>
      <Box width={8}>
        <Text color={health.color}>{health.score}%</Text>
      </Box>
      <Box width={10}>
        <Text dimColor>
          {stats.completed}/{stats.completed + stats.failed + stats.pending + stats.running}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text dimColor>{truncate(project.path, 40)}</Text>
      </Box>
      {confirmDelete && (
        <Box>
          <Text color="red" bold>
            {' '}Press 'd' again to confirm delete
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Project detail panel component
 */
function ProjectDetail({ project }: { project: Project }): React.ReactElement {
  const health = calculateHealthScore(project.id);
  const stats = getProjectStats(project.id);
  const addedDate = new Date(project.added_at).toLocaleDateString();

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="blue">Project Details</Text>
      </Box>

      <Box>
        <Box width={14}>
          <Text dimColor>Name:</Text>
        </Box>
        <Text bold>{project.name}</Text>
      </Box>

      <Box>
        <Box width={14}>
          <Text dimColor>ID:</Text>
        </Box>
        <Text dimColor>{project.id}</Text>
      </Box>

      <Box>
        <Box width={14}>
          <Text dimColor>Path:</Text>
        </Box>
        <Text>{project.path}</Text>
      </Box>

      <Box>
        <Box width={14}>
          <Text dimColor>Added:</Text>
        </Box>
        <Text>{addedDate}</Text>
      </Box>

      <Box>
        <Box width={14}>
          <Text dimColor>Group:</Text>
        </Box>
        <Text>{project.group_id || 'None'}</Text>
      </Box>

      <Box marginTop={1}>
        <Box width={14}>
          <Text dimColor>Health:</Text>
        </Box>
        <Text color={health.color} bold>
          {health.score}%
        </Text>
      </Box>

      <Box marginTop={1} borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false}>
        <Text bold>Task Stats:</Text>
      </Box>
      <Box>
        <Text dimColor>Pending: </Text>
        <Text color="yellow">{stats.pending}</Text>
        <Text dimColor>  Running: </Text>
        <Text color="blue">{stats.running}</Text>
      </Box>
      <Box>
        <Text dimColor>Completed: </Text>
        <Text color="green">{stats.completed}</Text>
        <Text dimColor>  Failed: </Text>
        <Text color="red">{stats.failed}</Text>
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          <Text bold color="green">a</Text> Add project  |
          <Text bold color="red"> d</Text> Delete  |
          <Text bold> ↑↓</Text> Navigate
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Add project input component
 */
function AddProjectInput({
  onSubmit,
  onCancel,
}: {
  onSubmit: (path: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const handleSubmit = (submittedValue: string) => {
    if (submittedValue.trim()) {
      onSubmit(submittedValue.trim());
    }
  };

  return (
    <Box borderStyle="round" borderColor="green" paddingX={2} paddingY={1} flexDirection="column">
      <Text bold color="green">Add Project</Text>
      <Box marginTop={1}>
        <Text>Enter project path: </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder="/path/to/project"
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to add, Escape to cancel</Text>
      </Box>
    </Box>
  );
}

/**
 * Table header component
 */
function TableHeader(): React.ReactElement {
  return (
    <Box paddingX={1} borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false}>
      <Box width={3}>
        <Text bold color="cyan"> </Text>
      </Box>
      <Box width={20}>
        <Text bold color="cyan">Name</Text>
      </Box>
      <Box width={8}>
        <Text bold color="cyan">Health</Text>
      </Box>
      <Box width={10}>
        <Text bold color="cyan">Tasks</Text>
      </Box>
      <Box flexGrow={1}>
        <Text bold color="cyan">Path</Text>
      </Box>
    </Box>
  );
}

/**
 * ProjectsView component - main projects display
 */
export function ProjectsView(): React.ReactElement {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; color: string } | null>(null);
  const [showAddInput, setShowAddInput] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Load projects
  const loadProjects = useCallback(() => {
    try {
      const allProjects = listProjects();
      setProjects(allProjects);
      // Adjust selection if projects were removed
      if (selectedIndex >= allProjects.length && allProjects.length > 0) {
        setSelectedIndex(allProjects.length - 1);
      }
      setLoading(false);
    } catch (error) {
      console.error('Failed to load projects:', error);
      setLoading(false);
    }
  }, [selectedIndex]);

  // Load projects and set up refresh interval
  useEffect(() => {
    loadProjects();
    const interval = setInterval(loadProjects, 2000);
    return () => clearInterval(interval);
  }, [loadProjects]);

  // Clear message after 3 seconds
  useEffect(() => {
    if (message) {
      const timeout = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timeout);
    }
  }, [message]);

  // Handle keyboard input (only when not showing add input)
  useInput((input, key) => {
    if (showAddInput) return;

    // Navigate up
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
      setConfirmDeleteId(null);
      return;
    }

    // Navigate down
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < projects.length - 1 ? prev + 1 : prev));
      setConfirmDeleteId(null);
      return;
    }

    // Add project
    if (input === 'a') {
      setShowAddInput(true);
      setConfirmDeleteId(null);
      return;
    }

    // Delete project (with confirmation)
    if (input === 'd' && projects.length > 0) {
      const selectedProject = projects[selectedIndex];
      if (!selectedProject) return;

      if (confirmDeleteId === selectedProject.id) {
        // Second press - actually delete
        const result = removeProject(selectedProject.id);
        if (result.success) {
          setMessage({ text: `Removed: ${selectedProject.name}`, color: 'red' });
          loadProjects();
        } else {
          setMessage({ text: result.message, color: 'red' });
        }
        setConfirmDeleteId(null);
      } else {
        // First press - ask for confirmation
        setConfirmDeleteId(selectedProject.id);
      }
      return;
    }

    // Clear confirmation on any other key
    if (confirmDeleteId) {
      setConfirmDeleteId(null);
    }
  });

  // Handle add project
  const handleAddProject = (path: string) => {
    const result = addProject(path);
    if (result.success) {
      setMessage({ text: `Added: ${result.project?.name}`, color: 'green' });
      loadProjects();
    } else {
      setMessage({ text: result.message, color: 'red' });
    }
    setShowAddInput(false);
  };

  // Handle cancel add
  const handleCancelAdd = () => {
    setShowAddInput(false);
  };

  if (loading) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>Loading projects...</Text>
      </Box>
    );
  }

  // Show add input overlay
  if (showAddInput) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box paddingX={1} marginBottom={1}>
          <Text bold color="blue">Projects</Text>
          <Text dimColor> ({projects.length} registered)</Text>
        </Box>
        <AddProjectInput onSubmit={handleAddProject} onCancel={handleCancelAdd} />
      </Box>
    );
  }

  if (projects.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="blue">Projects</Text>

        {/* Status message */}
        {message && (
          <Box paddingX={1} marginTop={1}>
            <Text color={message.color}>{message.text}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>No projects registered.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press </Text>
          <Text bold color="green">a</Text>
          <Text dimColor> to add a project.</Text>
        </Box>
      </Box>
    );
  }

  const selectedProject = projects[selectedIndex];

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} marginBottom={1}>
        <Text bold color="blue">Projects</Text>
        <Text dimColor> ({projects.length} registered)</Text>
      </Box>

      {/* Status message */}
      {message && (
        <Box paddingX={1} marginBottom={1}>
          <Text color={message.color}>{message.text}</Text>
        </Box>
      )}

      <Box flexDirection="row" flexGrow={1}>
        {/* Project list */}
        <Box flexDirection="column" width="55%" borderStyle="single" borderColor="gray">
          <TableHeader />
          {projects.map((project, index) => (
            <ProjectListItem
              key={project.id}
              project={project}
              selected={index === selectedIndex}
              confirmDelete={confirmDeleteId === project.id}
            />
          ))}
        </Box>

        {/* Project details */}
        <Box flexDirection="column" width="45%" paddingLeft={1}>
          {selectedProject && <ProjectDetail project={selectedProject} />}
        </Box>
      </Box>
    </Box>
  );
}

export default ProjectsView;
