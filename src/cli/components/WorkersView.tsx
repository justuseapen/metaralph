/**
 * WorkersView - Displays running workers in the dashboard
 *
 * Shows running workers with progress (iteration counts) and last output lines.
 * Automatically refreshes when data changes.
 * Supports worker detail view with log search (US-119).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
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
 * Worker row component for selectable list
 */
interface WorkerRowProps {
  worker: WorkerInfo;
  selected: boolean;
}

function WorkerRow({ worker, selected }: WorkerRowProps): React.ReactElement {
  const { execution, task, project } = worker;
  const elapsed = formatElapsed(execution.startedAt);
  const iterations = execution.iterationsUsed;

  return (
    <Box paddingX={1}>
      <Text inverse={selected}>
        <Text color="green">{(execution.status).padEnd(10)}</Text>
        <Text>{truncate(project?.name || 'Unknown', 14).padEnd(16)}</Text>
        <Text>{truncate(task?.title || 'Unknown', 30).padEnd(32)}</Text>
        <Text>{`${iterations} iter`.padEnd(10)}</Text>
        <Text dimColor>{elapsed}</Text>
      </Text>
    </Box>
  );
}

/**
 * List header for worker rows
 */
function WorkerListHeader(): React.ReactElement {
  return (
    <Box paddingX={1} marginBottom={0}>
      <Text bold color="cyan">
        <Text>{'Status'.padEnd(10)}</Text>
        <Text>{'Project'.padEnd(16)}</Text>
        <Text>{'Task'.padEnd(32)}</Text>
        <Text>{'Progress'.padEnd(10)}</Text>
        <Text>Duration</Text>
      </Text>
    </Box>
  );
}

/**
 * Highlighted text component for search matches
 */
interface HighlightedLineProps {
  text: string;
  searchTerm: string;
  isMatch: boolean;
  isCurrentMatch: boolean;
}

function HighlightedLine({ text, searchTerm, isMatch, isCurrentMatch }: HighlightedLineProps): React.ReactElement {
  if (!searchTerm || !isMatch) {
    return <Text>{text}</Text>;
  }

  // Find all matches in the line and highlight them
  const lowerText = text.toLowerCase();
  const lowerSearch = searchTerm.toLowerCase();
  const parts: React.ReactElement[] = [];
  let lastIndex = 0;
  let matchIndex = lowerText.indexOf(lowerSearch);
  let partKey = 0;

  while (matchIndex !== -1) {
    // Add text before match
    if (matchIndex > lastIndex) {
      parts.push(<Text key={partKey++}>{text.slice(lastIndex, matchIndex)}</Text>);
    }

    // Add highlighted match
    parts.push(
      <Text
        key={partKey++}
        backgroundColor={isCurrentMatch ? 'cyan' : 'yellow'}
        color="black"
      >
        {text.slice(matchIndex, matchIndex + searchTerm.length)}
      </Text>
    );

    lastIndex = matchIndex + searchTerm.length;
    matchIndex = lowerText.indexOf(lowerSearch, lastIndex);
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(<Text key={partKey++}>{text.slice(lastIndex)}</Text>);
  }

  return <Text>{parts}</Text>;
}

/**
 * Worker detail view props
 */
interface WorkerDetailViewProps {
  worker: WorkerInfo;
  onClose: () => void;
}

/**
 * Worker detail view with log search functionality
 */
function WorkerDetailView({ worker, onClose }: WorkerDetailViewProps): React.ReactElement {
  const { execution, task, project } = worker;
  const [scrollOffset, setScrollOffset] = useState(0);
  const [searchActive, setSearchActive] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInputValue, setSearchInputValue] = useState('');
  const [matchIndices, setMatchIndices] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Maximum visible lines
  const MAX_OUTPUT_LINES = 20;

  // Parse output lines
  const outputLines = execution.ralphOutput?.split('\n') || [];
  const totalLines = outputLines.length;
  const maxOffset = Math.max(0, totalLines - MAX_OUTPUT_LINES);

  // Update match indices when search term changes
  useEffect(() => {
    if (!searchTerm) {
      setMatchIndices([]);
      setCurrentMatchIndex(0);
      return;
    }

    const lowerSearch = searchTerm.toLowerCase();
    const indices: number[] = [];

    outputLines.forEach((line, index) => {
      if (line.toLowerCase().includes(lowerSearch)) {
        indices.push(index);
      }
    });

    setMatchIndices(indices);
    setCurrentMatchIndex(0);

    // Auto-scroll to first match
    if (indices.length > 0) {
      const firstMatchLine = indices[0];
      const targetOffset = Math.max(0, Math.min(firstMatchLine - 5, maxOffset));
      setScrollOffset(targetOffset);
    }
  }, [searchTerm, outputLines.join('\n'), maxOffset]);

  // Jump to match by index
  const jumpToMatch = useCallback((index: number) => {
    if (matchIndices.length === 0) return;

    const lineNumber = matchIndices[index];
    const targetOffset = Math.max(0, Math.min(lineNumber - 5, maxOffset));
    setScrollOffset(targetOffset);
    setCurrentMatchIndex(index);
  }, [matchIndices, maxOffset]);

  useInput((input, key) => {
    // Handle search input mode
    if (searchActive) {
      if (key.escape) {
        // Clear search and exit search mode
        setSearchTerm('');
        setSearchInputValue('');
        setSearchActive(false);
        setMatchIndices([]);
        setCurrentMatchIndex(0);
        return;
      }
      // Let TextInput handle other keys
      return;
    }

    // Normal mode key handling
    if (key.escape) {
      onClose();
      return;
    }

    // '/' opens search
    if (input === '/') {
      setSearchActive(true);
      return;
    }

    // 'n' jumps to next match
    if (input === 'n' && matchIndices.length > 0) {
      const nextIndex = (currentMatchIndex + 1) % matchIndices.length;
      jumpToMatch(nextIndex);
      return;
    }

    // 'N' jumps to previous match
    if (input === 'N' && matchIndices.length > 0) {
      const prevIndex = (currentMatchIndex - 1 + matchIndices.length) % matchIndices.length;
      jumpToMatch(prevIndex);
      return;
    }

    // Scroll navigation
    if (key.upArrow && scrollOffset > 0) {
      setScrollOffset(scrollOffset - 1);
    } else if (key.downArrow && scrollOffset < maxOffset) {
      setScrollOffset(scrollOffset + 1);
    } else if (key.pageUp) {
      setScrollOffset(Math.max(0, scrollOffset - MAX_OUTPUT_LINES));
    } else if (key.pageDown) {
      setScrollOffset(Math.min(maxOffset, scrollOffset + MAX_OUTPUT_LINES));
    } else if (input === 'g') {
      setScrollOffset(0);
    } else if (input === 'G') {
      setScrollOffset(maxOffset);
    }
  });

  // Handle search input submission
  const handleSearchSubmit = useCallback((value: string) => {
    setSearchTerm(value);
    setSearchInputValue('');
    setSearchActive(false);
  }, []);

  const elapsed = formatElapsed(execution.startedAt);
  const iterations = execution.iterationsUsed;
  const maxIterations = 10;
  const progressPercent = Math.min((iterations / maxIterations) * 100, 100);
  const progressWidth = 20;
  const filledWidth = Math.round((progressPercent / 100) * progressWidth);
  const progressBar = '█'.repeat(filledWidth) + '░'.repeat(progressWidth - filledWidth);

  // Get lines currently in match window for highlighting
  const visibleMatchLineNumbers = new Set(
    matchIndices.filter(
      (lineNum) => lineNum >= scrollOffset && lineNum < scrollOffset + MAX_OUTPUT_LINES
    )
  );

  // Current match line number
  const currentMatchLine = matchIndices[currentMatchIndex];

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {/* Header */}
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold color="cyan">Worker Detail</Text>
          <Text dimColor> - Press Escape to go back, / to search</Text>
        </Box>
        <Box marginTop={1}>
          <Text bold>Project: </Text>
          <Text>{project?.name || 'Unknown'}</Text>
          <Text bold>  Task: </Text>
          <Text>{task?.title || 'Unknown'}</Text>
        </Box>
        <Box>
          <Text bold>Status: </Text>
          <Text color="green">{execution.status}</Text>
          <Text bold>  PID: </Text>
          <Text>{execution.pid ?? 'N/A'}</Text>
          <Text bold>  Duration: </Text>
          <Text>{elapsed}</Text>
        </Box>
        <Box marginTop={1}>
          <Text bold>Progress: </Text>
          <Text color="green">{progressBar}</Text>
          <Text dimColor> {iterations}/{maxIterations} iterations</Text>
        </Box>
      </Box>

      {/* Search bar */}
      {searchActive && (
        <Box marginBottom={1} borderStyle="single" paddingX={1}>
          <Text bold color="yellow">Search: </Text>
          <TextInput
            value={searchInputValue}
            onChange={setSearchInputValue}
            onSubmit={handleSearchSubmit}
            placeholder="Enter search term..."
          />
          <Text dimColor> (Enter to search, ESC to cancel)</Text>
        </Box>
      )}

      {/* Search info bar - show when we have a search term */}
      {searchTerm && !searchActive && (
        <Box marginBottom={1}>
          <Text color="yellow">Search: </Text>
          <Text color="cyan">{searchTerm}</Text>
          <Text dimColor> - </Text>
          {matchIndices.length > 0 ? (
            <>
              <Text color="green">{matchIndices.length}</Text>
              <Text dimColor> match{matchIndices.length !== 1 ? 'es' : ''} (</Text>
              <Text color="cyan">{currentMatchIndex + 1}</Text>
              <Text dimColor>/{matchIndices.length})</Text>
              <Text dimColor> - n: next, N: prev, /: new search, ESC: clear</Text>
            </>
          ) : (
            <Text color="red">No matches found</Text>
          )}
        </Box>
      )}

      {/* Output section */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Output</Text>
        {totalLines > MAX_OUTPUT_LINES && (
          <Text dimColor>
            {' '}(lines {scrollOffset + 1}-{Math.min(scrollOffset + MAX_OUTPUT_LINES, totalLines)} of {totalLines}, ↑/↓ PgUp/PgDn to scroll)
          </Text>
        )}
      </Box>

      {/* Output content */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        flexGrow={1}
      >
        {outputLines.length === 0 ? (
          <Text dimColor>No output recorded yet.</Text>
        ) : (
          outputLines.slice(scrollOffset, scrollOffset + MAX_OUTPUT_LINES).map((line, idx) => {
            const lineNumber = scrollOffset + idx;
            const isMatch = visibleMatchLineNumbers.has(lineNumber);
            const isCurrentMatch = lineNumber === currentMatchLine;

            return (
              <Box key={idx}>
                <Text dimColor>{String(lineNumber + 1).padStart(4)} </Text>
                <HighlightedLine
                  text={line}
                  searchTerm={searchTerm}
                  isMatch={isMatch}
                  isCurrentMatch={isCurrentMatch}
                />
              </Box>
            );
          })
        )}
      </Box>

      {/* Navigation hints */}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ scroll | PgUp/PgDn page | g/G start/end | / search | ESC back</Text>
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailWorker, setDetailWorker] = useState<WorkerInfo | null>(null);

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

  // Reset selected index if workers list changes
  useEffect(() => {
    if (selectedIndex >= workers.length && workers.length > 0) {
      setSelectedIndex(workers.length - 1);
    }
  }, [workers.length, selectedIndex]);

  // Handle keyboard input for navigation
  useInput((input, key) => {
    // Don't handle input if showing detail view
    if (detailWorker) return;

    // Arrow key navigation
    if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    } else if (key.downArrow && selectedIndex < workers.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }

    // Enter opens detail view
    if (key.return && workers.length > 0) {
      setDetailWorker(workers[selectedIndex]);
    }
  });

  // Handle closing detail view
  const handleCloseDetail = useCallback(() => {
    setDetailWorker(null);
  }, []);

  // Show detail view if a worker is selected
  if (detailWorker) {
    return <WorkerDetailView worker={detailWorker} onClose={handleCloseDetail} />;
  }

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
        {workers.length > 0 && (
          <Text dimColor> - ↑/↓ navigate, Enter: view details</Text>
        )}
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
        <Box flexDirection="column" marginTop={1}>
          <WorkerListHeader />
          {workers.map((worker, index) => (
            <WorkerRow
              key={worker.execution.id}
              worker={worker}
              selected={index === selectedIndex}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

export default WorkersView;
