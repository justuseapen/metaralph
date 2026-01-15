/**
 * QueueView - Displays the task queue in the dashboard
 *
 * Shows tasks in a table with: Priority, ID, Project, Type, Status
 * Automatically refreshes when data changes.
 * Supports filtering by status and type, with Tab key to cycle filters.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { TaskRepository, type Task, type TaskStatus, type TaskType } from '../../queue/index.js';
import { getProject, listProjects } from '../../registry/index.js';

/**
 * Status filter options for the filter bar
 */
type StatusFilter = 'all' | TaskStatus;
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

/**
 * Type filter options for the filter bar
 */
type TypeFilter = 'all' | TaskType;
const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'feature', label: 'Feature' },
  { value: 'bug_fix', label: 'Bug' },
  { value: 'test', label: 'Test' },
  { value: 'docs', label: 'Docs' },
  { value: 'refactor', label: 'Refactor' },
];

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
 * Highlight search term in text by rendering matching parts in yellow with inverse
 */
function HighlightedText({
  text,
  searchTerm,
  color,
  dimColor,
  maxLength,
}: {
  text: string;
  searchTerm: string;
  color?: string;
  dimColor?: boolean;
  maxLength?: number;
}): React.ReactElement {
  const displayText = maxLength ? truncate(text, maxLength) : text;

  if (!searchTerm) {
    return <Text color={color} dimColor={dimColor}>{displayText}</Text>;
  }

  const lowerText = displayText.toLowerCase();
  const lowerSearch = searchTerm.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerSearch);

  if (matchIndex === -1) {
    return <Text color={color} dimColor={dimColor}>{displayText}</Text>;
  }

  const before = displayText.slice(0, matchIndex);
  const match = displayText.slice(matchIndex, matchIndex + searchTerm.length);
  const after = displayText.slice(matchIndex + searchTerm.length);

  return (
    <Text color={color} dimColor={dimColor}>
      {before}
      <Text backgroundColor="yellow" color="black" bold>{match}</Text>
      {after}
    </Text>
  );
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
function TaskRow({
  task,
  index,
  searchTerm,
  projectName,
}: {
  task: Task;
  index: number;
  searchTerm: string;
  projectName: string;
}): React.ReactElement {
  const status = formatStatus(task.status);

  return (
    <Box paddingX={1}>
      <Box width={8}>
        <Text>{task.priorityScore}</Text>
      </Box>
      <Box width={10}>
        <Text dimColor>{truncate(task.id, 8)}</Text>
      </Box>
      <Box width={16}>
        <HighlightedText text={projectName} searchTerm={searchTerm} maxLength={14} />
      </Box>
      <Box width={10}>
        <HighlightedText text={formatType(task.type)} searchTerm={searchTerm} />
      </Box>
      <Box width={12}>
        <Text color={status.color}>{status.text}</Text>
      </Box>
      <Box flexGrow={1}>
        <HighlightedText text={task.title} searchTerm={searchTerm} maxLength={40} />
      </Box>
    </Box>
  );
}

/**
 * Task with resolved project name for display
 */
interface TaskWithProject extends Task {
  projectName: string;
}

/**
 * SearchInput component - Displays at the top when search is active
 */
function SearchInput({
  value,
  onChange,
  totalCount,
  filteredCount,
}: {
  value: string;
  onChange: (value: string) => void;
  totalCount: number;
  filteredCount: number;
}): React.ReactElement {
  return (
    <Box paddingX={1} marginBottom={1}>
      <Box marginRight={1}>
        <Text color="yellow">/</Text>
      </Box>
      <Box flexGrow={1}>
        <TextInput
          value={value}
          onChange={onChange}
          placeholder="Search by title, project, or type..."
        />
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>
          {filteredCount === totalCount
            ? `${totalCount} task${totalCount !== 1 ? 's' : ''}`
            : `${filteredCount} of ${totalCount}`}
        </Text>
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>ESC: clear</Text>
      </Box>
    </Box>
  );
}

/**
 * Filter field types for Tab key cycling
 */
type FilterField = 'status' | 'type';

/**
 * FilterBar component - Shows status and type filters at top of QueueView
 */
function FilterBar({
  statusFilter,
  typeFilter,
  activeField,
  onStatusChange,
  onTypeChange,
  totalCount,
  filteredCount,
}: {
  statusFilter: StatusFilter;
  typeFilter: TypeFilter;
  activeField: FilterField | null;
  onStatusChange: (status: StatusFilter) => void;
  onTypeChange: (type: TypeFilter) => void;
  totalCount: number;
  filteredCount: number;
}): React.ReactElement {
  return (
    <Box paddingX={1} marginBottom={1} flexDirection="row" gap={2}>
      {/* Status filter */}
      <Box>
        <Text bold={activeField === 'status'} color={activeField === 'status' ? 'cyan' : undefined}>
          Status:{' '}
        </Text>
        {STATUS_FILTERS.map((filter, index) => {
          const isSelected = statusFilter === filter.value;
          const isActive = activeField === 'status';
          return (
            <Text key={filter.value}>
              {index > 0 && <Text dimColor> | </Text>}
              <Text
                bold={isSelected}
                color={isSelected ? 'green' : isActive ? 'white' : 'gray'}
                inverse={isSelected && isActive}
              >
                {filter.label}
              </Text>
            </Text>
          );
        })}
      </Box>

      {/* Type filter */}
      <Box marginLeft={2}>
        <Text bold={activeField === 'type'} color={activeField === 'type' ? 'cyan' : undefined}>
          Type:{' '}
        </Text>
        {TYPE_FILTERS.map((filter, index) => {
          const isSelected = typeFilter === filter.value;
          const isActive = activeField === 'type';
          return (
            <Text key={filter.value}>
              {index > 0 && <Text dimColor> | </Text>}
              <Text
                bold={isSelected}
                color={isSelected ? 'green' : isActive ? 'white' : 'gray'}
                inverse={isSelected && isActive}
              >
                {filter.label}
              </Text>
            </Text>
          );
        })}
      </Box>

      {/* Filter count */}
      <Box marginLeft={2}>
        <Text dimColor>
          Showing {filteredCount} of {totalCount}
        </Text>
      </Box>

      {/* Tab hint */}
      <Box marginLeft={2}>
        <Text dimColor>Tab: cycle filters</Text>
      </Box>
    </Box>
  );
}

/**
 * QueueView component - main task queue display
 */
export function QueueView(): React.ReactElement {
  const [tasks, setTasks] = useState<TaskWithProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchActive, setSearchActive] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState(''); // Debounced search term
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [activeFilterField, setActiveFilterField] = useState<FilterField | null>(null);

  // Load tasks and project names, set up refresh interval
  useEffect(() => {
    const loadTasks = () => {
      try {
        const pendingTasks = TaskRepository.findPending();
        const projects = listProjects();
        const projectMap = new Map(projects.map(p => [p.id, p.name]));

        const tasksWithProjects: TaskWithProject[] = pendingTasks.map(task => ({
          ...task,
          projectName: projectMap.get(task.projectId) || 'Unknown',
        }));

        setTasks(tasksWithProjects);
        setLoading(false);
      } catch (error) {
        console.error('Failed to load tasks:', error);
        setLoading(false);
      }
    };

    loadTasks();

    const interval = setInterval(loadTasks, 2000);
    return () => clearInterval(interval);
  }, []);

  // Handle search input changes with debounce
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);

    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounce timer (150ms)
    debounceTimerRef.current = setTimeout(() => {
      setSearchTerm(value);
    }, 150);
  }, []);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Filter tasks based on search term and filters
  const filteredTasks = tasks.filter(task => {
    // Apply status filter
    if (statusFilter !== 'all' && task.status !== statusFilter) {
      return false;
    }

    // Apply type filter
    if (typeFilter !== 'all' && task.type !== typeFilter) {
      return false;
    }

    // Apply search term
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch =
        task.title.toLowerCase().includes(searchLower) ||
        task.projectName.toLowerCase().includes(searchLower) ||
        formatType(task.type).toLowerCase().includes(searchLower);
      if (!matchesSearch) {
        return false;
      }
    }

    return true;
  });

  // Handle keyboard input
  useInput((input, key) => {
    if (searchActive) {
      // Escape clears search and exits search mode
      if (key.escape) {
        setSearchActive(false);
        setSearchInput('');
        setSearchTerm('');
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        return;
      }
      return;
    }

    // '/' key activates search
    if (input === '/') {
      setSearchActive(true);
      return;
    }

    // Tab key cycles through filter fields (null -> status -> type -> null)
    if (key.tab) {
      if (activeFilterField === null) {
        setActiveFilterField('status');
      } else if (activeFilterField === 'status') {
        setActiveFilterField('type');
      } else {
        setActiveFilterField(null);
      }
      return;
    }

    // Escape deactivates filter field
    if (key.escape && activeFilterField !== null) {
      setActiveFilterField(null);
      return;
    }

    // Arrow keys change filter values when a filter field is active
    if (activeFilterField !== null) {
      if (key.leftArrow || key.rightArrow) {
        if (activeFilterField === 'status') {
          const currentIndex = STATUS_FILTERS.findIndex(f => f.value === statusFilter);
          const newIndex = key.rightArrow
            ? (currentIndex + 1) % STATUS_FILTERS.length
            : (currentIndex - 1 + STATUS_FILTERS.length) % STATUS_FILTERS.length;
          setStatusFilter(STATUS_FILTERS[newIndex].value);
        } else if (activeFilterField === 'type') {
          const currentIndex = TYPE_FILTERS.findIndex(f => f.value === typeFilter);
          const newIndex = key.rightArrow
            ? (currentIndex + 1) % TYPE_FILTERS.length
            : (currentIndex - 1 + TYPE_FILTERS.length) % TYPE_FILTERS.length;
          setTypeFilter(TYPE_FILTERS[newIndex].value);
        }
        return;
      }
    }
  });

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
        <Box marginTop={1}>
          <Text dimColor>/: Search</Text>
        </Box>
      </Box>
    );
  }

  // Check if any filters are active (for messaging)
  const hasActiveFilters = statusFilter !== 'all' || typeFilter !== 'all' || searchTerm !== '';

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <Box paddingX={1} marginBottom={0}>
        <Text bold color="blue">Task Queue</Text>
        {!searchActive && (
          <Text dimColor> — /: Search  Tab: filters</Text>
        )}
      </Box>

      {/* Filter bar */}
      <FilterBar
        statusFilter={statusFilter}
        typeFilter={typeFilter}
        activeField={activeFilterField}
        onStatusChange={setStatusFilter}
        onTypeChange={setTypeFilter}
        totalCount={tasks.length}
        filteredCount={filteredTasks.length}
      />

      {/* Search input when active */}
      {searchActive && (
        <SearchInput
          value={searchInput}
          onChange={handleSearchChange}
          totalCount={tasks.length}
          filteredCount={filteredTasks.length}
        />
      )}

      {/* Table */}
      <TableHeader />
      <Box flexDirection="column" borderStyle="single" borderTop={false}>
        {filteredTasks.length === 0 ? (
          <Box paddingX={1} paddingY={1}>
            <Text dimColor>
              No tasks match current filters
              {searchTerm && ` (search: "${searchTerm}")`}
              {statusFilter !== 'all' && ` (status: ${statusFilter})`}
              {typeFilter !== 'all' && ` (type: ${TYPE_FILTERS.find(f => f.value === typeFilter)?.label})`}
            </Text>
          </Box>
        ) : (
          filteredTasks.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              index={index}
              searchTerm={searchTerm}
              projectName={task.projectName}
            />
          ))
        )}
      </Box>
    </Box>
  );
}

export default QueueView;
