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
import { LoadingSpinner, RefreshingIndicator } from './LoadingStates.js';

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
 * Output level filter type
 */
type OutputLevelFilter = 'all' | 'errors' | 'warnings' | 'info';

/**
 * Output level filter options
 */
const OUTPUT_LEVEL_FILTERS: { value: OutputLevelFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'errors', label: 'Errors' },
  { value: 'warnings', label: 'Warnings' },
  { value: 'info', label: 'Info' },
];

/**
 * Check if a line contains error keywords
 */
function isErrorLine(line: string): boolean {
  const lower = line.toLowerCase();
  return lower.includes('error') || lower.includes('failed') || lower.includes('exception');
}

/**
 * Check if a line contains warning keywords
 */
function isWarningLine(line: string): boolean {
  const lower = line.toLowerCase();
  return lower.includes('warn') || lower.includes('warning');
}

/**
 * Get the level of a line
 */
function getLineLevel(line: string): 'error' | 'warning' | 'info' {
  if (isErrorLine(line)) return 'error';
  if (isWarningLine(line)) return 'warning';
  return 'info';
}

/**
 * Count lines by level
 */
function countLinesByLevel(lines: string[]): { errors: number; warnings: number; info: number } {
  let errors = 0;
  let warnings = 0;
  let info = 0;

  for (const line of lines) {
    const level = getLineLevel(line);
    if (level === 'error') errors++;
    else if (level === 'warning') warnings++;
    else info++;
  }

  return { errors, warnings, info };
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
  const [levelFilter, setLevelFilter] = useState<OutputLevelFilter>('all');
  const [filterActive, setFilterActive] = useState(false);

  // Maximum visible lines
  const MAX_OUTPUT_LINES = 20;

  // Parse output lines
  const allOutputLines = execution.ralphOutput?.split('\n') || [];

  // Count lines by level
  const levelCounts = countLinesByLevel(allOutputLines);

  // Filter lines by level
  const outputLinesWithIndex = allOutputLines.map((line, index) => ({ line, originalIndex: index }));
  const filteredLinesWithIndex = levelFilter === 'all'
    ? outputLinesWithIndex
    : outputLinesWithIndex.filter(({ line }) => {
        const level = getLineLevel(line);
        if (levelFilter === 'errors') return level === 'error';
        if (levelFilter === 'warnings') return level === 'warning';
        if (levelFilter === 'info') return level === 'info';
        return true;
      });

  const totalLines = filteredLinesWithIndex.length;
  const maxOffset = Math.max(0, totalLines - MAX_OUTPUT_LINES);

  // Update match indices when search term changes (works on filtered lines)
  useEffect(() => {
    if (!searchTerm) {
      setMatchIndices([]);
      setCurrentMatchIndex(0);
      return;
    }

    const lowerSearch = searchTerm.toLowerCase();
    const indices: number[] = [];

    filteredLinesWithIndex.forEach(({ line }, filteredIndex) => {
      if (line.toLowerCase().includes(lowerSearch)) {
        indices.push(filteredIndex);
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
  }, [searchTerm, filteredLinesWithIndex.map(l => l.line).join('\n'), maxOffset]);

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

    // Handle filter mode
    if (filterActive) {
      if (key.escape || key.return) {
        setFilterActive(false);
        return;
      }
      // Left/right arrow cycle through filter options
      if (key.leftArrow || key.rightArrow) {
        const currentIndex = OUTPUT_LEVEL_FILTERS.findIndex(f => f.value === levelFilter);
        const direction = key.rightArrow ? 1 : -1;
        const newIndex = (currentIndex + direction + OUTPUT_LEVEL_FILTERS.length) % OUTPUT_LEVEL_FILTERS.length;
        setLevelFilter(OUTPUT_LEVEL_FILTERS[newIndex].value);
        setScrollOffset(0); // Reset scroll when filter changes
        return;
      }
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

    // 'f' opens filter
    if (input === 'f') {
      setFilterActive(true);
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
          <Text dimColor> - Press Escape to go back, / to search, f to filter</Text>
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

      {/* Level counts header */}
      <Box marginBottom={1}>
        <Text dimColor>Lines: </Text>
        <Text color="red">{levelCounts.errors} errors</Text>
        <Text dimColor> | </Text>
        <Text color="yellow">{levelCounts.warnings} warnings</Text>
        <Text dimColor> | </Text>
        <Text>{levelCounts.info} info</Text>
      </Box>

      {/* Filter bar */}
      {filterActive && (
        <Box marginBottom={1} borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text bold color="cyan">Filter: </Text>
          {OUTPUT_LEVEL_FILTERS.map((filter, index) => (
            <Box key={filter.value} marginRight={1}>
              <Text
                inverse={filter.value === levelFilter}
                color={filter.value === levelFilter ? 'cyan' : undefined}
              >
                {filter.label}
              </Text>
            </Box>
          ))}
          <Text dimColor> (←/→ to change, Enter/ESC to close)</Text>
        </Box>
      )}

      {/* Filter info bar - show when not 'all' */}
      {!filterActive && levelFilter !== 'all' && (
        <Box marginBottom={1}>
          <Text color="cyan">Filter: </Text>
          <Text bold color={levelFilter === 'errors' ? 'red' : levelFilter === 'warnings' ? 'yellow' : undefined}>
            {OUTPUT_LEVEL_FILTERS.find(f => f.value === levelFilter)?.label}
          </Text>
          <Text dimColor> ({totalLines} lines shown) - press f to change</Text>
        </Box>
      )}

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
        {filteredLinesWithIndex.length === 0 ? (
          <Text dimColor>{levelFilter === 'all' ? 'No output recorded yet.' : `No ${levelFilter} found.`}</Text>
        ) : (
          filteredLinesWithIndex.slice(scrollOffset, scrollOffset + MAX_OUTPUT_LINES).map(({ line, originalIndex }, filteredIdx) => {
            const displayIndex = scrollOffset + filteredIdx;
            const isMatch = visibleMatchLineNumbers.has(displayIndex);
            const isCurrentMatch = displayIndex === currentMatchLine;
            const lineLevel = getLineLevel(line);

            // Color code based on level
            const levelColor = lineLevel === 'error' ? 'red' : lineLevel === 'warning' ? 'yellow' : undefined;

            return (
              <Box key={filteredIdx}>
                <Text dimColor>{String(originalIndex + 1).padStart(4)} </Text>
                {searchTerm && isMatch ? (
                  <HighlightedLine
                    text={line}
                    searchTerm={searchTerm}
                    isMatch={isMatch}
                    isCurrentMatch={isCurrentMatch}
                  />
                ) : (
                  <Text color={levelColor}>{line}</Text>
                )}
              </Box>
            );
          })
        )}
      </Box>

      {/* Navigation hints */}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ scroll | PgUp/PgDn page | g/G start/end | / search | f filter | ESC back</Text>
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailWorker, setDetailWorker] = useState<WorkerInfo | null>(null);

  // Load running workers and calculate stats
  const loadWorkers = useCallback(() => {
    // Show refreshing indicator for subsequent loads
    if (hasLoaded) {
      setIsRefreshing(true);
    }

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
      setHasLoaded(true);
      setIsRefreshing(false);
    } catch (error) {
      console.error('Failed to load workers:', error);
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [hasLoaded]);

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
        <Box marginBottom={1}>
          <Text bold color="blue">Active Workers</Text>
        </Box>
        <LoadingSpinner message="Loading workers..." />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} marginBottom={1}>
        <Text bold color="blue">Active Workers</Text>
        <Text dimColor> ({workers.length} running)</Text>
        {isRefreshing && (
          <Box marginLeft={2}>
            <RefreshingIndicator visible={isRefreshing} />
          </Box>
        )}
        {workers.length > 0 && !isRefreshing && (
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
