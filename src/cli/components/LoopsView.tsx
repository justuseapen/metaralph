/**
 * LoopsView - Displays Ralph loops in the dashboard
 *
 * Shows all Ralph loops with status, progress, and controls.
 * Automatically refreshes when data changes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { LoopRepository, LoopIterationRepository, type Loop, type LoopStatus, type LoopIteration } from '../../loops/index.js';
import { getProject, listProjects, type Project } from '../../registry/index.js';

/**
 * Get color for loop status
 */
function getStatusColor(status: LoopStatus): string {
  const colors: Record<LoopStatus, string> = {
    pending: 'gray',
    running: 'green',
    paused: 'yellow',
    completed: 'cyan',
    failed: 'red',
    stopped: 'red',
  };
  return colors[status] || 'white';
}

/**
 * Format status text for display
 */
function formatStatus(status: LoopStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Format duration between two dates
 */
function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return '-';

  const start = new Date(startedAt);
  const end = completedAt ? new Date(completedAt) : new Date();
  const diffMs = end.getTime() - start.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Truncate string to max length with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

/**
 * Loop with project name for display
 */
interface LoopWithProject extends Loop {
  projectName: string;
}

/**
 * Props for LoopRow
 */
interface LoopRowProps {
  loop: LoopWithProject;
  selected: boolean;
}

/**
 * Single loop row in the list
 */
function LoopRow({ loop, selected }: LoopRowProps): React.ReactElement {
  const statusColor = getStatusColor(loop.status);
  const progress = `${loop.currentIteration}/${loop.maxIterations}`;
  const duration = formatDuration(loop.startedAt, loop.completedAt);

  return (
    <Box paddingX={1}>
      <Text inverse={selected}>
        <Text color={statusColor}>{formatStatus(loop.status).padEnd(10)}</Text>
        <Text>{truncate(loop.projectName, 16).padEnd(18)}</Text>
        <Text>{truncate(loop.branchName, 24).padEnd(26)}</Text>
        <Text>{progress.padEnd(8)}</Text>
        <Text dimColor>{duration}</Text>
      </Text>
    </Box>
  );
}

/**
 * Table header for loop list
 */
function LoopListHeader(): React.ReactElement {
  return (
    <Box paddingX={1} marginBottom={0}>
      <Text bold color="cyan">
        <Text>{'Status'.padEnd(10)}</Text>
        <Text>{'Project'.padEnd(18)}</Text>
        <Text>{'Branch'.padEnd(26)}</Text>
        <Text>{'Progress'.padEnd(8)}</Text>
        <Text>Duration</Text>
      </Text>
    </Box>
  );
}

/**
 * Form fields for creating a new loop
 */
type CreateLoopField = 'project' | 'prdPath' | 'maxIterations' | 'branchName';

/**
 * State for create loop dialog
 */
interface CreateLoopDialogState {
  selectedProjectIndex: number;
  prdPath: string;
  maxIterations: string;
  branchName: string;
  activeField: CreateLoopField;
}

/**
 * Props for CreateLoopDialog
 */
interface CreateLoopDialogProps {
  projects: Project[];
  onSubmit: (projectId: string, prdPath: string, maxIterations: number, branchName: string) => void;
  onCancel: () => void;
}

/**
 * Generate branch name from PRD path
 */
function generateBranchName(prdPath: string): string {
  // Extract base name from prd path and create a branch name
  // e.g., prd.json -> ralph/main, tasks/prd-feature.md -> ralph/feature
  const basename = prdPath.replace(/^.*\//, '').replace(/\.(json|md)$/, '');
  const cleanName = basename
    .replace(/^prd[-_]?/, '')
    .replace(/[-_]+/g, '-')
    .toLowerCase();
  return `ralph/${cleanName || 'main'}`;
}

/**
 * Dialog for creating a new Ralph loop
 */
function CreateLoopDialog({ projects, onSubmit, onCancel }: CreateLoopDialogProps): React.ReactElement {
  const [state, setState] = useState<CreateLoopDialogState>({
    selectedProjectIndex: 0,
    prdPath: 'prd.json',
    maxIterations: '10',
    branchName: generateBranchName('prd.json'),
    activeField: 'project',
  });

  // Field order for tab navigation
  const fields: CreateLoopField[] = ['project', 'prdPath', 'maxIterations', 'branchName'];

  // Auto-update branch name when PRD path changes
  const handlePrdPathChange = useCallback((value: string) => {
    setState(prev => ({
      ...prev,
      prdPath: value,
      branchName: generateBranchName(value),
    }));
  }, []);

  useInput((input, key) => {
    // Escape cancels
    if (key.escape) {
      onCancel();
      return;
    }

    // Enter submits if we have valid data
    if (key.return && !key.ctrl && !key.meta) {
      if (state.activeField === 'project') {
        // In project selector, Enter moves to next field
        setState(prev => ({ ...prev, activeField: 'prdPath' }));
        return;
      }
      // Submit form
      if (projects.length > 0) {
        const maxIter = parseInt(state.maxIterations, 10) || 10;
        onSubmit(
          projects[state.selectedProjectIndex].id,
          state.prdPath || 'prd.json',
          maxIter,
          state.branchName || generateBranchName(state.prdPath)
        );
      }
      return;
    }

    // Tab cycles through fields
    if (key.tab) {
      setState(prev => {
        const currentIndex = fields.indexOf(prev.activeField);
        const nextIndex = key.shift
          ? (currentIndex - 1 + fields.length) % fields.length
          : (currentIndex + 1) % fields.length;
        return { ...prev, activeField: fields[nextIndex] };
      });
      return;
    }

    // Arrow keys in project selector
    if (state.activeField === 'project') {
      if (key.upArrow && state.selectedProjectIndex > 0) {
        setState(prev => ({ ...prev, selectedProjectIndex: prev.selectedProjectIndex - 1 }));
      } else if (key.downArrow && state.selectedProjectIndex < projects.length - 1) {
        setState(prev => ({ ...prev, selectedProjectIndex: prev.selectedProjectIndex + 1 }));
      }
    }
  });

  const isFieldActive = (field: CreateLoopField) => state.activeField === field;

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Create New Loop</Text>
        <Text dimColor> - Tab to navigate, Enter to confirm, Escape to cancel</Text>
      </Box>

      {/* Form */}
      <Box flexDirection="column" borderStyle="single" paddingX={1} paddingY={0}>
        {/* Project selector */}
        <Box marginY={0}>
          <Text bold inverse={isFieldActive('project')}>
            Project:{' '}
          </Text>
          {projects.length === 0 ? (
            <Text color="red">No projects registered</Text>
          ) : isFieldActive('project') ? (
            <Box flexDirection="column">
              {projects.map((project, index) => (
                <Text
                  key={project.id}
                  color={index === state.selectedProjectIndex ? 'cyan' : undefined}
                >
                  {index === state.selectedProjectIndex ? '> ' : '  '}
                  {project.name}
                </Text>
              ))}
            </Box>
          ) : (
            <Text color="cyan">{projects[state.selectedProjectIndex]?.name || 'None'}</Text>
          )}
        </Box>

        {/* PRD Path input */}
        <Box marginY={0}>
          <Text bold inverse={isFieldActive('prdPath')}>
            PRD Path:{' '}
          </Text>
          {isFieldActive('prdPath') ? (
            <TextInput
              value={state.prdPath}
              onChange={handlePrdPathChange}
              placeholder="prd.json"
            />
          ) : (
            <Text>{state.prdPath || 'prd.json'}</Text>
          )}
        </Box>

        {/* Max Iterations input */}
        <Box marginY={0}>
          <Text bold inverse={isFieldActive('maxIterations')}>
            Max Iterations:{' '}
          </Text>
          {isFieldActive('maxIterations') ? (
            <TextInput
              value={state.maxIterations}
              onChange={(value) => setState(prev => ({ ...prev, maxIterations: value.replace(/[^0-9]/g, '') }))}
              placeholder="10"
            />
          ) : (
            <Text>{state.maxIterations || '10'}</Text>
          )}
        </Box>

        {/* Branch Name input */}
        <Box marginY={0}>
          <Text bold inverse={isFieldActive('branchName')}>
            Branch Name:{' '}
          </Text>
          {isFieldActive('branchName') ? (
            <TextInput
              value={state.branchName}
              onChange={(value) => setState(prev => ({ ...prev, branchName: value }))}
              placeholder={generateBranchName(state.prdPath)}
            />
          ) : (
            <Text>{state.branchName || generateBranchName(state.prdPath)}</Text>
          )}
        </Box>
      </Box>

      {/* Submit hint */}
      <Box marginTop={1}>
        <Text dimColor>Press Enter to create loop, Escape to cancel</Text>
      </Box>
    </Box>
  );
}

/**
 * Loop detail view showing iterations
 */
interface LoopDetailViewProps {
  loop: LoopWithProject;
  onClose: () => void;
}

function LoopDetailView({ loop, onClose }: LoopDetailViewProps): React.ReactElement {
  const [iterations, setIterations] = useState<LoopIteration[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  useEffect(() => {
    const loadIterations = () => {
      try {
        const iters = LoopIterationRepository.findByLoop(loop.id);
        setIterations(iters);
      } catch (error) {
        console.error('Failed to load iterations:', error);
      }
    };

    loadIterations();
    const interval = setInterval(loadIterations, 2000);
    return () => clearInterval(interval);
  }, [loop.id]);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
    } else if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    } else if (key.downArrow && selectedIndex < iterations.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    } else if (key.return && iterations.length > 0) {
      // Toggle expanded view for selected iteration
      setExpandedIndex(expandedIndex === selectedIndex ? null : selectedIndex);
    }
  });

  const statusColor = getStatusColor(loop.status);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {/* Header */}
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold color="cyan">Loop Detail</Text>
          <Text dimColor> - Press Escape to go back</Text>
        </Box>
        <Box marginTop={1}>
          <Text bold>Project: </Text>
          <Text>{loop.projectName}</Text>
          <Text bold>  Branch: </Text>
          <Text>{loop.branchName}</Text>
        </Box>
        <Box>
          <Text bold>Status: </Text>
          <Text color={statusColor}>{formatStatus(loop.status)}</Text>
          <Text bold>  Progress: </Text>
          <Text>{loop.currentIteration}/{loop.maxIterations}</Text>
          <Text bold>  Duration: </Text>
          <Text>{formatDuration(loop.startedAt, loop.completedAt)}</Text>
        </Box>
      </Box>

      {/* Iterations list */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Iterations</Text>
        <Text dimColor> (↑/↓ to navigate, Enter to expand)</Text>
      </Box>

      {iterations.length === 0 ? (
        <Text dimColor>No iterations yet.</Text>
      ) : (
        <Box flexDirection="column">
          {/* Iteration header */}
          <Box paddingX={1}>
            <Text bold color="cyan">
              <Text>{'#'.padEnd(4)}</Text>
              <Text>{'Story'.padEnd(12)}</Text>
              <Text>{'Status'.padEnd(12)}</Text>
              <Text>{'Duration'.padEnd(10)}</Text>
              <Text>Commit</Text>
            </Text>
          </Box>

          {/* Iteration rows */}
          {iterations.map((iter, index) => {
            const iterStatusColor = iter.status === 'completed' ? 'cyan' :
              iter.status === 'running' ? 'green' :
              iter.status === 'failed' ? 'red' : 'gray';
            const duration = formatDuration(iter.startedAt, iter.completedAt);
            const commitDisplay = iter.commitSha ? iter.commitSha.slice(0, 7) : '-';
            const isExpanded = expandedIndex === index;

            return (
              <Box key={iter.id} flexDirection="column">
                <Box paddingX={1}>
                  <Text inverse={selectedIndex === index}>
                    <Text>{String(iter.iterationNumber).padEnd(4)}</Text>
                    <Text>{(iter.storyId || '-').padEnd(12)}</Text>
                    <Text color={iterStatusColor}>{iter.status.padEnd(12)}</Text>
                    <Text dimColor>{duration.padEnd(10)}</Text>
                    <Text dimColor>{commitDisplay}</Text>
                  </Text>
                </Box>

                {/* Expanded output */}
                {isExpanded && iter.output && (
                  <Box
                    marginLeft={2}
                    marginY={1}
                    paddingX={1}
                    borderStyle="single"
                    flexDirection="column"
                  >
                    <Text bold dimColor>Output:</Text>
                    <Text wrap="wrap">{truncate(iter.output, 500)}</Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

/**
 * LoopsView component displays Ralph loop management interface
 */
export function LoopsView(): React.ReactElement {
  const [loops, setLoops] = useState<LoopWithProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailLoop, setDetailLoop] = useState<LoopWithProject | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  // Load loops with project names
  const loadLoops = useCallback(() => {
    try {
      const allLoops = LoopRepository.findAll();
      const loopsWithProjects: LoopWithProject[] = allLoops.map(loop => {
        const project = getProject(loop.projectId);
        return {
          ...loop,
          projectName: project?.name || 'Unknown',
        };
      });
      setLoops(loopsWithProjects);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load loops:', error);
      setLoading(false);
    }
  }, []);

  // Load projects for create dialog
  const loadProjects = useCallback(() => {
    try {
      const allProjects = listProjects();
      setProjects(allProjects);
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  }, []);

  // Handle create loop submission
  const handleCreateLoop = useCallback((projectId: string, prdPath: string, maxIterations: number, branchName: string) => {
    try {
      LoopRepository.create({
        projectId,
        prdPath,
        maxIterations,
        branchName,
      });
      setShowCreateDialog(false);
      loadLoops(); // Refresh the list
    } catch (error) {
      console.error('Failed to create loop:', error);
    }
  }, [loadLoops]);

  useEffect(() => {
    loadLoops();
    loadProjects();
    const interval = setInterval(loadLoops, 2000);
    return () => clearInterval(interval);
  }, [loadLoops, loadProjects]);

  // Keep selected index in bounds
  useEffect(() => {
    if (selectedIndex >= loops.length && loops.length > 0) {
      setSelectedIndex(loops.length - 1);
    }
  }, [loops.length, selectedIndex]);

  useInput((input, key) => {
    // Don't handle input if showing detail view or create dialog
    if (detailLoop || showCreateDialog) return;

    if (input === 'n') {
      // Open create dialog
      loadProjects(); // Refresh projects list
      setShowCreateDialog(true);
    } else if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    } else if (key.downArrow && selectedIndex < loops.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    } else if (key.return && loops.length > 0) {
      // Open detail view
      setDetailLoop(loops[selectedIndex]);
    }
  });

  // Show create dialog if requested
  if (showCreateDialog) {
    return (
      <Box flexGrow={1} flexDirection="column">
        <CreateLoopDialog
          projects={projects}
          onSubmit={handleCreateLoop}
          onCancel={() => setShowCreateDialog(false)}
        />
      </Box>
    );
  }

  // Show detail view if a loop is selected
  if (detailLoop) {
    return (
      <LoopDetailView
        loop={detailLoop}
        onClose={() => setDetailLoop(null)}
      />
    );
  }

  if (loading) {
    return (
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Ralph Loops</Text>
        </Box>
        <Text dimColor>Loading loops...</Text>
      </Box>
    );
  }

  if (loops.length === 0) {
    return (
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Ralph Loops</Text>
        </Box>
        <Box flexDirection="column">
          <Text dimColor>No loops yet. Press n to start one.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexGrow={1} flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Ralph Loops</Text>
        <Text dimColor> ({loops.length} loop{loops.length !== 1 ? 's' : ''}) - ↑/↓ to navigate, Enter to view, n to create</Text>
      </Box>

      <LoopListHeader />

      <Box flexDirection="column" borderStyle="single" borderTop={false}>
        {loops.map((loop, index) => (
          <LoopRow
            key={loop.id}
            loop={loop}
            selected={index === selectedIndex}
          />
        ))}
      </Box>
    </Box>
  );
}
