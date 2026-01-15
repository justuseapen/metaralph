/**
 * LoopsView - Displays Ralph loops in the dashboard
 *
 * Shows all Ralph loops with status, progress, and controls.
 * Automatically refreshes when data changes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LoopRepository, LoopIterationRepository, LoopRunner, type Loop, type LoopStatus, type LoopIteration } from '../../loops/index.js';
import { getProject, listProjects, type Project } from '../../registry/index.js';

/**
 * User story from PRD
 */
interface PrdStory {
  id: string;
  title: string;
  passes: boolean;
}

/**
 * PRD file structure
 */
interface PrdFile {
  project: string;
  branchName: string;
  description: string;
  userStories: PrdStory[];
}

/**
 * Story progress information
 */
interface StoryProgress {
  completed: number;
  total: number;
  currentStory: PrdStory | null;
  stories: PrdStory[];
}

/**
 * Read PRD file and extract story progress
 */
function readPrdProgress(projectPath: string, prdPath: string): StoryProgress | null {
  try {
    const fullPath = path.join(projectPath, prdPath);
    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const prd = JSON.parse(content) as PrdFile;

    if (!prd.userStories || !Array.isArray(prd.userStories)) {
      return null;
    }

    const completed = prd.userStories.filter(s => s.passes).length;
    const total = prd.userStories.length;

    // Find the first story with passes: false (current story being worked on)
    const currentStory = prd.userStories.find(s => !s.passes) || null;

    return {
      completed,
      total,
      currentStory,
      stories: prd.userStories,
    };
  } catch {
    return null;
  }
}

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
 * Loop with project name and progress for display
 */
interface LoopWithProject extends Loop {
  projectName: string;
  projectPath: string;
  storyProgress: StoryProgress | null;
}

/**
 * Spinner frames for animation
 */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Progress bar component
 */
interface ProgressBarProps {
  completed: number;
  total: number;
  width?: number;
}

function ProgressBar({ completed, total, width = 20 }: ProgressBarProps): React.ReactElement {
  const percentage = total > 0 ? completed / total : 0;
  const filledWidth = Math.round(percentage * width);
  const emptyWidth = width - filledWidth;

  const filled = '█'.repeat(filledWidth);
  const empty = '░'.repeat(emptyWidth);
  const percentText = `${Math.round(percentage * 100)}%`;

  return (
    <Text>
      <Text color="green">{filled}</Text>
      <Text dimColor>{empty}</Text>
      <Text> {percentText}</Text>
    </Text>
  );
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
  const iterProgress = `${loop.currentIteration}/${loop.maxIterations}`;
  const duration = formatDuration(loop.startedAt, loop.completedAt);

  // Get story progress if available
  const storyProgress = loop.storyProgress;
  const storyProgressText = storyProgress
    ? `${storyProgress.completed}/${storyProgress.total}`
    : '-';

  return (
    <Box paddingX={1} flexDirection="column">
      <Text inverse={selected}>
        <Text color={statusColor}>{formatStatus(loop.status).padEnd(10)}</Text>
        <Text>{truncate(loop.projectName, 14).padEnd(16)}</Text>
        <Text>{truncate(loop.branchName, 20).padEnd(22)}</Text>
        <Text>{('Iter ' + iterProgress).padEnd(12)}</Text>
        <Text>{('Stories ' + storyProgressText).padEnd(14)}</Text>
        <Text dimColor>{duration}</Text>
      </Text>

      {/* Show current story for running loops when selected */}
      {selected && loop.status === 'running' && storyProgress?.currentStory && (
        <Box marginLeft={2} marginTop={0}>
          <Text dimColor>
            └ Working on: <Text color="cyan">{storyProgress.currentStory.id}</Text>
            {' - '}{truncate(storyProgress.currentStory.title, 40)}
            <Text color="yellow"> (p: pause, s: stop)</Text>
          </Text>
        </Box>
      )}

      {/* Show paused indicator when selected */}
      {selected && loop.status === 'paused' && (
        <Box marginLeft={2} marginTop={0}>
          <Text color="yellow">
            └ Paused - press 'r' to resume, 's' to stop
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Loop progress display component for running loops
 */
interface LoopProgressDisplayProps {
  loop: LoopWithProject;
  spinnerFrame: number;
}

function LoopProgressDisplay({ loop, spinnerFrame }: LoopProgressDisplayProps): React.ReactElement | null {
  const storyProgress = loop.storyProgress;

  if (!storyProgress) {
    return null;
  }

  const isRunning = loop.status === 'running';

  return (
    <Box flexDirection="column" marginY={1} paddingX={1} borderStyle="single">
      {/* Header with spinner for running loops */}
      <Box marginBottom={1}>
        {isRunning && (
          <Text color="green">{SPINNER_FRAMES[spinnerFrame]} </Text>
        )}
        <Text bold color="cyan">Loop Progress</Text>
        <Text dimColor> - {loop.branchName}</Text>
      </Box>

      {/* Progress bar */}
      <Box marginBottom={1}>
        <Text>Stories: </Text>
        <ProgressBar completed={storyProgress.completed} total={storyProgress.total} width={25} />
        <Text dimColor> ({storyProgress.completed}/{storyProgress.total})</Text>
      </Box>

      {/* Iteration count */}
      <Box marginBottom={1}>
        <Text>Iteration: </Text>
        <Text bold color={isRunning ? 'green' : 'cyan'}>
          {loop.currentIteration}
        </Text>
        <Text dimColor>/{loop.maxIterations}</Text>
      </Box>

      {/* Current story info for running loops */}
      {isRunning && storyProgress.currentStory && (
        <Box flexDirection="column">
          <Box>
            <Text>Current: </Text>
            <Text color="yellow">{storyProgress.currentStory.id}</Text>
            <Text> - </Text>
            <Text>{truncate(storyProgress.currentStory.title, 50)}</Text>
          </Box>
        </Box>
      )}

      {/* Completion message */}
      {loop.status === 'completed' && (
        <Box>
          <Text color="cyan">✓ All stories completed!</Text>
        </Box>
      )}
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
        <Text>{'Project'.padEnd(16)}</Text>
        <Text>{'Branch'.padEnd(22)}</Text>
        <Text>{'Iterations'.padEnd(12)}</Text>
        <Text>{'Stories'.padEnd(14)}</Text>
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
 * Props for StopConfirmationDialog
 */
interface StopConfirmationDialogProps {
  loop: LoopWithProject;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/**
 * Confirmation dialog for stopping a loop
 */
function StopConfirmationDialog({ loop, onConfirm, onCancel }: StopConfirmationDialogProps): React.ReactElement {
  const [reason, setReason] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    } else if (key.return && !key.ctrl && !key.meta) {
      onConfirm(reason || 'Stopped by user');
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="red">Stop Loop</Text>
        <Text dimColor> - This will kill the loop process immediately</Text>
      </Box>

      {/* Loop info */}
      <Box flexDirection="column" borderStyle="single" paddingX={1} paddingY={0} marginBottom={1}>
        <Box>
          <Text bold>Project: </Text>
          <Text>{loop.projectName}</Text>
        </Box>
        <Box>
          <Text bold>Branch: </Text>
          <Text>{loop.branchName}</Text>
        </Box>
        <Box>
          <Text bold>Status: </Text>
          <Text color={getStatusColor(loop.status)}>{formatStatus(loop.status)}</Text>
        </Box>
        <Box>
          <Text bold>Progress: </Text>
          <Text>Iteration {loop.currentIteration}/{loop.maxIterations}</Text>
          {loop.storyProgress && (
            <Text dimColor> ({loop.storyProgress.completed}/{loop.storyProgress.total} stories)</Text>
          )}
        </Box>
      </Box>

      {/* Warning */}
      <Box marginBottom={1}>
        <Text color="yellow">⚠ Warning: </Text>
        <Text>The current iteration will be interrupted and marked as failed.</Text>
      </Box>

      {/* Reason input */}
      <Box marginBottom={1}>
        <Text bold>Reason (optional): </Text>
        <TextInput
          value={reason}
          onChange={setReason}
          placeholder="Enter reason for stopping..."
        />
      </Box>

      {/* Actions hint */}
      <Box marginTop={1}>
        <Text dimColor>Press </Text>
        <Text color="red">Enter</Text>
        <Text dimColor> to confirm stop, </Text>
        <Text color="cyan">Escape</Text>
        <Text dimColor> to cancel</Text>
      </Box>
    </Box>
  );
}

/**
 * Get story title by ID from PRD stories
 */
function getStoryTitle(storyId: string | null, stories: PrdStory[]): string | null {
  if (!storyId) return null;
  const story = stories.find(s => s.id === storyId);
  return story?.title || null;
}

/**
 * Get iteration status color with emphasis for failed
 */
function getIterationStatusColor(status: string): string {
  switch (status) {
    case 'completed': return 'cyan';
    case 'running': return 'green';
    case 'failed': return 'red';
    default: return 'gray';
  }
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
  const [outputScrollOffset, setOutputScrollOffset] = useState(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [storyProgress, setStoryProgress] = useState<StoryProgress | null>(loop.storyProgress);

  // Maximum visible lines for expanded output
  const MAX_OUTPUT_LINES = 15;

  // Spinner animation for running loops
  useEffect(() => {
    if (loop.status !== 'running') return;

    const interval = setInterval(() => {
      setSpinnerFrame(prev => (prev + 1) % SPINNER_FRAMES.length);
    }, 100);

    return () => clearInterval(interval);
  }, [loop.status]);

  useEffect(() => {
    const loadData = () => {
      try {
        const iters = LoopIterationRepository.findByLoop(loop.id);
        setIterations(iters);

        // Refresh story progress from PRD file
        if (loop.projectPath) {
          const progress = readPrdProgress(loop.projectPath, loop.prdPath);
          setStoryProgress(progress);
        }
      } catch (error) {
        console.error('Failed to load iterations:', error);
      }
    };

    loadData();
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, [loop.id, loop.projectPath, loop.prdPath]);

  // Reset output scroll when expanding a different iteration
  useEffect(() => {
    setOutputScrollOffset(0);
  }, [expandedIndex]);

  useInput((input, key) => {
    if (key.escape) {
      // If output is expanded, collapse it first
      if (expandedIndex !== null) {
        setExpandedIndex(null);
        setOutputScrollOffset(0);
      } else {
        onClose();
      }
    } else if (expandedIndex !== null) {
      // When output is expanded, arrow keys scroll the output
      const iter = iterations[expandedIndex];
      if (iter?.output) {
        const lines = iter.output.split('\n');
        const maxOffset = Math.max(0, lines.length - MAX_OUTPUT_LINES);

        if (key.upArrow && outputScrollOffset > 0) {
          setOutputScrollOffset(outputScrollOffset - 1);
        } else if (key.downArrow && outputScrollOffset < maxOffset) {
          setOutputScrollOffset(outputScrollOffset + 1);
        } else if (key.pageUp) {
          setOutputScrollOffset(Math.max(0, outputScrollOffset - MAX_OUTPUT_LINES));
        } else if (key.pageDown) {
          setOutputScrollOffset(Math.min(maxOffset, outputScrollOffset + MAX_OUTPUT_LINES));
        } else if (input === 'g') {
          // Go to start
          setOutputScrollOffset(0);
        } else if (input === 'G') {
          // Go to end
          setOutputScrollOffset(maxOffset);
        }
      }
    } else {
      // Normal navigation when output is not expanded
      if (key.upArrow && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      } else if (key.downArrow && selectedIndex < iterations.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      } else if (key.return && iterations.length > 0) {
        // Expand/collapse output for selected iteration
        setExpandedIndex(expandedIndex === selectedIndex ? null : selectedIndex);
      }
    }
  });

  const statusColor = getStatusColor(loop.status);
  const isRunning = loop.status === 'running';
  const stories = storyProgress?.stories || [];

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {/* Header */}
      <Box marginBottom={1} flexDirection="column">
        <Box>
          {isRunning && (
            <Text color="green">{SPINNER_FRAMES[spinnerFrame]} </Text>
          )}
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
          <Text bold>  Iteration: </Text>
          <Text color={isRunning ? 'green' : 'cyan'}>{loop.currentIteration}</Text>
          <Text dimColor>/{loop.maxIterations}</Text>
          <Text bold>  Duration: </Text>
          <Text>{formatDuration(loop.startedAt, loop.completedAt)}</Text>
        </Box>

        {/* Story progress bar */}
        {storyProgress && (
          <Box marginTop={1}>
            <Text bold>Stories: </Text>
            <ProgressBar completed={storyProgress.completed} total={storyProgress.total} width={30} />
            <Text dimColor> ({storyProgress.completed}/{storyProgress.total})</Text>
          </Box>
        )}

        {/* Current story for running loops */}
        {isRunning && storyProgress?.currentStory && (
          <Box marginTop={0}>
            <Text bold>Current: </Text>
            <Text color="yellow">{storyProgress.currentStory.id}</Text>
            <Text> - </Text>
            <Text>{truncate(storyProgress.currentStory.title, 50)}</Text>
          </Box>
        )}
      </Box>

      {/* Iterations list */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Iterations</Text>
        <Text dimColor> (↑/↓ to navigate, Enter to expand output)</Text>
      </Box>

      {iterations.length === 0 ? (
        <Text dimColor>No iterations yet.</Text>
      ) : (
        <Box flexDirection="column">
          {/* Iteration header */}
          <Box paddingX={1}>
            <Text bold color="cyan">
              <Text>{'#'.padEnd(4)}</Text>
              <Text>{'Story'.padEnd(10)}</Text>
              <Text>{'Title'.padEnd(32)}</Text>
              <Text>{'Status'.padEnd(12)}</Text>
              <Text>{'Duration'.padEnd(10)}</Text>
              <Text>Commit</Text>
            </Text>
          </Box>

          {/* Iteration rows */}
          {iterations.map((iter, index) => {
            const iterStatusColor = getIterationStatusColor(iter.status);
            const duration = formatDuration(iter.startedAt, iter.completedAt);
            const commitDisplay = iter.commitSha ? iter.commitSha.slice(0, 7) : '-';
            const isExpanded = expandedIndex === index;
            const isFailed = iter.status === 'failed';
            const storyTitle = getStoryTitle(iter.storyId, stories);

            return (
              <Box key={iter.id} flexDirection="column">
                <Box paddingX={1}>
                  <Text inverse={selectedIndex === index} backgroundColor={isFailed && selectedIndex !== index ? 'red' : undefined}>
                    <Text color={isFailed ? 'red' : undefined}>{String(iter.iterationNumber).padEnd(4)}</Text>
                    <Text color={isFailed ? 'red' : undefined}>{(iter.storyId || '-').padEnd(10)}</Text>
                    <Text color={isFailed ? 'red' : undefined}>{truncate(storyTitle || '-', 30).padEnd(32)}</Text>
                    <Text color={iterStatusColor} bold={isFailed}>{iter.status.padEnd(12)}</Text>
                    <Text color={isFailed ? 'red' : undefined} dimColor={!isFailed}>{duration.padEnd(10)}</Text>
                    <Text color={isFailed ? 'red' : undefined} dimColor={!isFailed}>{commitDisplay}</Text>
                  </Text>
                </Box>

                {/* Expanded output with scrolling */}
                {isExpanded && (
                  <Box
                    marginLeft={2}
                    marginY={1}
                    paddingX={1}
                    borderStyle="single"
                    borderColor={isFailed ? 'red' : undefined}
                    flexDirection="column"
                  >
                    {iter.output ? (
                      <>
                        {/* Output header with scroll info */}
                        <Box marginBottom={1}>
                          <Text bold dimColor>Output</Text>
                          {(() => {
                            const lines = iter.output.split('\n');
                            const totalLines = lines.length;
                            if (totalLines > MAX_OUTPUT_LINES) {
                              return (
                                <Text dimColor>
                                  {' '}(lines {outputScrollOffset + 1}-{Math.min(outputScrollOffset + MAX_OUTPUT_LINES, totalLines)} of {totalLines}, ↑/↓ PgUp/PgDn to scroll, g/G start/end)
                                </Text>
                              );
                            }
                            return null;
                          })()}
                        </Box>

                        {/* Output content with scrolling */}
                        <Box flexDirection="column">
                          {iter.output.split('\n').slice(outputScrollOffset, outputScrollOffset + MAX_OUTPUT_LINES).map((line, lineIdx) => (
                            <Text key={lineIdx} wrap="wrap">{line}</Text>
                          ))}
                        </Box>
                      </>
                    ) : (
                      <Text dimColor>No output recorded for this iteration.</Text>
                    )}
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
  const [showStopDialog, setShowStopDialog] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  // Spinner frame state for running loops indicator
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Update spinner frame for running loops
  useEffect(() => {
    const hasRunningLoop = loops.some(l => l.status === 'running');
    if (!hasRunningLoop) return;

    const interval = setInterval(() => {
      setSpinnerFrame(prev => (prev + 1) % SPINNER_FRAMES.length);
    }, 100);

    return () => clearInterval(interval);
  }, [loops]);

  // Load loops with project names and story progress
  const loadLoops = useCallback(() => {
    try {
      const allLoops = LoopRepository.findAll();
      const loopsWithProjects: LoopWithProject[] = allLoops.map(loop => {
        const project = getProject(loop.projectId);
        const projectPath = project?.path || '';

        // Read PRD to get story progress
        const storyProgress = projectPath
          ? readPrdProgress(projectPath, loop.prdPath)
          : null;

        return {
          ...loop,
          projectName: project?.name || 'Unknown',
          projectPath,
          storyProgress,
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
      // Create the loop record
      const loop = LoopRepository.create({
        projectId,
        prdPath,
        maxIterations,
        branchName,
      });

      // Start the loop (spawn ralph.sh subprocess)
      const result = LoopRunner.start(loop.id, { tool: 'claude' });
      if (!result.success) {
        console.error('Failed to start loop:', result.error);
        // Loop is still created, just not started - user can try again
      }

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

  // Handle pause loop
  const handlePauseLoop = useCallback(() => {
    const loop = loops[selectedIndex];
    if (!loop || loop.status !== 'running') return;

    try {
      const success = LoopRunner.pause(loop.id);
      if (success) {
        loadLoops(); // Refresh the list
      }
    } catch (error) {
      console.error('Failed to pause loop:', error);
    }
  }, [loops, selectedIndex, loadLoops]);

  // Handle resume loop
  const handleResumeLoop = useCallback(() => {
    const loop = loops[selectedIndex];
    if (!loop || loop.status !== 'paused') return;

    try {
      const result = LoopRunner.resume(loop.id, { tool: 'claude' });
      if (result.success) {
        loadLoops(); // Refresh the list
      }
    } catch (error) {
      console.error('Failed to resume loop:', error);
    }
  }, [loops, selectedIndex, loadLoops]);

  // Handle stop loop confirmation
  const handleStopLoop = useCallback((reason: string) => {
    const loop = loops[selectedIndex];
    if (!loop || (loop.status !== 'running' && loop.status !== 'paused')) {
      setShowStopDialog(false);
      return;
    }

    try {
      const success = LoopRunner.stop(loop.id, reason);
      if (success) {
        loadLoops(); // Refresh the list
      }
    } catch (error) {
      console.error('Failed to stop loop:', error);
    }
    setShowStopDialog(false);
  }, [loops, selectedIndex, loadLoops]);

  useInput((input, key) => {
    // Don't handle input if showing detail view, create dialog, or stop dialog
    if (detailLoop || showCreateDialog || showStopDialog) return;

    if (input === 'n') {
      // Open create dialog
      loadProjects(); // Refresh projects list
      setShowCreateDialog(true);
    } else if (input === 'p') {
      // Pause the selected running loop
      handlePauseLoop();
    } else if (input === 'r') {
      // Resume the selected paused loop
      handleResumeLoop();
    } else if (input === 's') {
      // Open stop confirmation dialog for running or paused loops
      const loop = loops[selectedIndex];
      if (loop && (loop.status === 'running' || loop.status === 'paused')) {
        setShowStopDialog(true);
      }
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

  // Show stop confirmation dialog if requested
  if (showStopDialog && loops[selectedIndex]) {
    return (
      <Box flexGrow={1} flexDirection="column">
        <StopConfirmationDialog
          loop={loops[selectedIndex]}
          onConfirm={handleStopLoop}
          onCancel={() => setShowStopDialog(false)}
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

  // Get the selected loop for progress display
  const selectedLoop = loops[selectedIndex];

  return (
    <Box flexGrow={1} flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Ralph Loops</Text>
        <Text dimColor> ({loops.length} loop{loops.length !== 1 ? 's' : ''}) - ↑/↓ navigate, Enter view, n new, p pause, r resume, s stop</Text>
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

      {/* Show progress display for selected loop if it has story progress */}
      {selectedLoop && selectedLoop.storyProgress && (
        <LoopProgressDisplay
          loop={selectedLoop}
          spinnerFrame={spinnerFrame}
        />
      )}
    </Box>
  );
}
