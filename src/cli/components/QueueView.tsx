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
import { TaskRepository, type Task, type TaskStatus, type TaskType, type EffortLevel } from '../../queue/index.js';
import { ExecutionRepository, type Execution } from '../../workers/index.js';
import { getProject, listProjects, type Project } from '../../registry/index.js';
import { LoadingSpinner, RefreshingIndicator, EmptyState } from './LoadingStates.js';
import {
  STATUS_COLORS,
  TASK_TYPE_COLORS,
  UI_COLORS,
  getTaskStatusColor,
  getExecutionStatusColor as getExecStatusColor,
  formatTaskType as formatTypeWithColor,
  formatTaskStatus,
  formatEffort as formatEffortWithColor,
} from './ColorScheme.js';

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
 * Format a task status for display - uses centralized ColorScheme
 */
function formatStatus(status: TaskStatus): { text: string; color: string } {
  return formatTaskStatus(status);
}

/**
 * Format a task type for display - uses centralized ColorScheme
 */
function formatType(type: string): string {
  return formatTypeWithColor(type).text;
}

/**
 * Get task type color for display
 */
function getTypeColor(type: string): string {
  return formatTypeWithColor(type).color;
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
  selected,
}: {
  task: Task;
  index: number;
  searchTerm: string;
  projectName: string;
  selected: boolean;
}): React.ReactElement {
  const status = formatStatus(task.status);

  const typeColor = getTypeColor(task.type);

  // Use simpler layout when no search term (supports inverse selection)
  if (!searchTerm) {
    return (
      <Box paddingX={1}>
        <Text inverse={selected}>
          {String(task.priorityScore).padEnd(8)}
          <Text dimColor>{truncate(task.id, 8).padEnd(10)}</Text>
          {truncate(projectName, 14).padEnd(16)}
          <Text color={typeColor}>{formatType(task.type).padEnd(10)}</Text>
          <Text color={status.color}>{status.text.padEnd(12)}</Text>
          {truncate(task.title, 40)}
        </Text>
      </Box>
    );
  }

  // Use highlight-enabled layout when searching
  return (
    <Box paddingX={1}>
      <Box width={8}>
        <Text inverse={selected}>{task.priorityScore}</Text>
      </Box>
      <Box width={10}>
        <Text inverse={selected} dimColor>{truncate(task.id, 8)}</Text>
      </Box>
      <Box width={16}>
        <HighlightedText text={projectName} searchTerm={searchTerm} maxLength={14} />
      </Box>
      <Box width={10}>
        <HighlightedText text={formatType(task.type)} searchTerm={searchTerm} color={typeColor} />
      </Box>
      <Box width={12}>
        <Text inverse={selected} color={status.color}>{status.text}</Text>
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
 * Format effort level for display
 */
function formatEffort(effort: string): string {
  const effortMap: Record<string, string> = {
    quick_win: 'Quick Win',
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
  };
  return effortMap[effort] || effort;
}

/**
 * Format approval status for display
 */
function formatApprovalStatus(status: string): { text: string; color: string } {
  const statusMap: Record<string, { text: string; color: string }> = {
    not_required: { text: 'Not Required', color: 'gray' },
    pending: { text: 'Pending', color: 'yellow' },
    approved: { text: 'Approved', color: 'green' },
    rejected: { text: 'Rejected', color: 'red' },
  };
  return statusMap[status] || { text: status, color: 'white' };
}

/**
 * Format source for display
 */
function formatSource(source: string): string {
  const sourceMap: Record<string, string> = {
    manual: 'Manual',
    onboarding: 'Onboarding',
    analysis: 'Analysis',
    conversation: 'Conversation',
    self_improvement: 'Self-Improvement',
  };
  return sourceMap[source] || source;
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
 * Get execution status color - uses centralized ColorScheme
 */
function getExecutionStatusColor(status: string): string {
  return getExecStatusColor(status);
}

/**
 * PRD data structure for acceptance criteria
 */
interface PrdData {
  acceptanceCriteria?: string[];
  userStories?: Array<{
    id: string;
    title: string;
    acceptanceCriteria?: string[];
  }>;
}

/**
 * Parse acceptance criteria from PRD JSON
 */
function parseAcceptanceCriteria(prdJson: string | null): string[] {
  if (!prdJson) return [];

  try {
    const prd = JSON.parse(prdJson) as PrdData;
    // Check for direct acceptanceCriteria
    if (prd.acceptanceCriteria && Array.isArray(prd.acceptanceCriteria)) {
      return prd.acceptanceCriteria;
    }
    // Check for userStories with acceptanceCriteria
    if (prd.userStories && prd.userStories.length > 0) {
      const firstStory = prd.userStories[0];
      if (firstStory.acceptanceCriteria) {
        return firstStory.acceptanceCriteria;
      }
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Props for TaskDetailView
 */
interface TaskDetailViewProps {
  task: TaskWithProject;
  onClose: () => void;
}

/**
 * Full-screen task detail view
 */
function TaskDetailView({ task, onClose }: TaskDetailViewProps): React.ReactElement {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [selectedExecutionIndex, setSelectedExecutionIndex] = useState(0);
  const [expandedExecution, setExpandedExecution] = useState<number | null>(null);
  const [outputScrollOffset, setOutputScrollOffset] = useState(0);

  const MAX_OUTPUT_LINES = 12;

  // Load executions for this task
  useEffect(() => {
    const loadExecutions = () => {
      try {
        const taskExecutions = ExecutionRepository.findByTask(task.id);
        setExecutions(taskExecutions);
      } catch (error) {
        console.error('Failed to load executions:', error);
      }
    };

    loadExecutions();
    const interval = setInterval(loadExecutions, 2000);
    return () => clearInterval(interval);
  }, [task.id]);

  // Reset output scroll when expanding a different execution
  useEffect(() => {
    setOutputScrollOffset(0);
  }, [expandedExecution]);

  useInput((input, key) => {
    if (key.escape) {
      if (expandedExecution !== null) {
        setExpandedExecution(null);
        setOutputScrollOffset(0);
      } else {
        onClose();
      }
      return;
    }

    // Handle output scrolling when expanded
    if (expandedExecution !== null) {
      const exec = executions[expandedExecution];
      if (exec?.ralphOutput) {
        const lines = exec.ralphOutput.split('\n');
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
          setOutputScrollOffset(0);
        } else if (input === 'G') {
          setOutputScrollOffset(maxOffset);
        }
      }
      return;
    }

    // Navigate executions list
    if (key.upArrow && selectedExecutionIndex > 0) {
      setSelectedExecutionIndex(selectedExecutionIndex - 1);
    } else if (key.downArrow && selectedExecutionIndex < executions.length - 1) {
      setSelectedExecutionIndex(selectedExecutionIndex + 1);
    } else if (key.return && executions.length > 0) {
      setExpandedExecution(selectedExecutionIndex);
    }
  });

  const status = formatStatus(task.status);
  const approvalStatus = formatApprovalStatus(task.approvalStatus);
  const acceptanceCriteria = parseAcceptanceCriteria(task.prdJson);

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="blue">Task Details</Text>
        <Text dimColor> — Escape: back  ↑↓: navigate  Enter: expand output</Text>
      </Box>

      {/* Task info section */}
      <Box flexDirection="column" borderStyle="single" paddingX={1} paddingY={0} marginBottom={1}>
        {/* Title */}
        <Box marginBottom={0}>
          <Text bold>Title: </Text>
          <Text>{task.title}</Text>
        </Box>

        {/* Description */}
        {task.description && (
          <Box marginBottom={0}>
            <Text bold>Description: </Text>
            <Text dimColor>{task.description}</Text>
          </Box>
        )}

        {/* Status row */}
        <Box marginBottom={0}>
          <Text bold>Status: </Text>
          <Text color={status.color}>{status.text}</Text>
          <Text>  </Text>
          <Text bold>Approval: </Text>
          <Text color={approvalStatus.color}>{approvalStatus.text}</Text>
        </Box>

        {/* Type and source */}
        <Box marginBottom={0}>
          <Text bold>Type: </Text>
          <Text color={getTypeColor(task.type)}>{formatType(task.type)}</Text>
          <Text>  </Text>
          <Text bold>Source: </Text>
          <Text dimColor>{formatSource(task.source)}</Text>
        </Box>

        {/* Project and effort */}
        <Box marginBottom={0}>
          <Text bold>Project: </Text>
          <Text color="cyan">{task.projectName}</Text>
          <Text>  </Text>
          <Text bold>Effort: </Text>
          <Text>{formatEffort(task.estimatedEffort)}</Text>
        </Box>

        {/* Priority */}
        <Box marginBottom={0}>
          <Text bold>Priority Score: </Text>
          <Text color={task.priorityScore >= 70 ? 'green' : task.priorityScore >= 40 ? 'yellow' : 'gray'}>
            {task.priorityScore.toFixed(1)}
          </Text>
        </Box>

        {/* Timestamps */}
        <Box marginBottom={0}>
          <Text bold>Created: </Text>
          <Text dimColor>{formatDate(task.createdAt)}</Text>
          <Text>  </Text>
          <Text bold>Updated: </Text>
          <Text dimColor>{formatDate(task.updatedAt)}</Text>
        </Box>
      </Box>

      {/* Acceptance Criteria section */}
      {acceptanceCriteria.length > 0 && (
        <Box flexDirection="column" borderStyle="single" paddingX={1} paddingY={0} marginBottom={1}>
          <Box marginBottom={0}>
            <Text bold color="cyan">Acceptance Criteria</Text>
          </Box>
          {acceptanceCriteria.map((criterion, index) => (
            <Box key={index}>
              <Text dimColor>• </Text>
              <Text>{criterion}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Execution History section */}
      <Box flexDirection="column" borderStyle="single" paddingX={1} paddingY={0} flexGrow={1}>
        <Box marginBottom={0}>
          <Text bold color="cyan">Execution History</Text>
          {executions.length > 0 && (
            <Text dimColor> ({executions.length} attempt{executions.length !== 1 ? 's' : ''})</Text>
          )}
        </Box>

        {executions.length === 0 ? (
          <Box>
            <Text dimColor>No execution history for this task.</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {/* Execution list header */}
            <Box marginBottom={0}>
              <Text bold dimColor>
                <Text>{'#'.padEnd(4)}</Text>
                <Text>{'Status'.padEnd(12)}</Text>
                <Text>{'Started'.padEnd(20)}</Text>
                <Text>{'Duration'.padEnd(12)}</Text>
                <Text>Exit</Text>
              </Text>
            </Box>

            {/* Execution rows */}
            {executions.map((exec, index) => {
              const execStatusColor = getExecutionStatusColor(exec.status);
              const isFailed = exec.status === 'failed';
              const isSelected = index === selectedExecutionIndex;
              const isExpanded = index === expandedExecution;

              return (
                <Box key={exec.id} flexDirection="column">
                  <Text inverse={isSelected} color={isFailed ? 'red' : undefined}>
                    <Text>{String(index + 1).padEnd(4)}</Text>
                    <Text color={execStatusColor} bold={isFailed}>
                      {exec.status.charAt(0).toUpperCase() + exec.status.slice(1).padEnd(11)}
                    </Text>
                    <Text>{(exec.startedAt ? formatDate(exec.startedAt) : '-').padEnd(20)}</Text>
                    <Text>{formatDuration(exec.startedAt, exec.completedAt).padEnd(12)}</Text>
                    <Text>{exec.exitCode !== null ? String(exec.exitCode) : '-'}</Text>
                  </Text>

                  {/* Expanded output view */}
                  {isExpanded && exec.ralphOutput && (
                    <Box
                      flexDirection="column"
                      borderStyle="single"
                      borderColor={isFailed ? 'red' : 'gray'}
                      marginY={0}
                      paddingX={1}
                    >
                      <Box>
                        <Text bold dimColor>
                          Output
                          {exec.ralphOutput.split('\n').length > MAX_OUTPUT_LINES && (
                            <Text>
                              {' '}(lines {outputScrollOffset + 1}-
                              {Math.min(outputScrollOffset + MAX_OUTPUT_LINES, exec.ralphOutput.split('\n').length)}
                              {' of '}{exec.ralphOutput.split('\n').length}){' '}
                              <Text color="cyan">↑↓: scroll  g/G: top/bottom</Text>
                            </Text>
                          )}
                        </Text>
                      </Box>
                      {exec.ralphOutput
                        .split('\n')
                        .slice(outputScrollOffset, outputScrollOffset + MAX_OUTPUT_LINES)
                        .map((line, lineIdx) => (
                          <Text key={lineIdx} dimColor wrap="truncate">
                            {line}
                          </Text>
                        ))}
                    </Box>
                  )}

                  {/* Error log for failed executions */}
                  {isExpanded && exec.errorLog && (
                    <Box
                      flexDirection="column"
                      borderStyle="single"
                      borderColor="red"
                      marginY={0}
                      paddingX={1}
                    >
                      <Box>
                        <Text bold color="red">Error Log</Text>
                      </Box>
                      {exec.errorLog.split('\n').slice(0, 5).map((line, lineIdx) => (
                        <Text key={lineIdx} color="red" wrap="truncate">
                          {line}
                        </Text>
                      ))}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}

/**
 * Infer task type from title keywords
 */
function inferTaskType(title: string): TaskType {
  const lowerTitle = title.toLowerCase();

  // Bug/fix keywords
  if (lowerTitle.includes('fix') || lowerTitle.includes('bug') || lowerTitle.includes('error') ||
      lowerTitle.includes('broken') || lowerTitle.includes('crash') || lowerTitle.includes('issue')) {
    return 'bug_fix';
  }

  // Test keywords
  if (lowerTitle.includes('test') || lowerTitle.includes('spec') || lowerTitle.includes('coverage')) {
    return 'test';
  }

  // Documentation keywords
  if (lowerTitle.includes('doc') || lowerTitle.includes('readme') || lowerTitle.includes('comment') ||
      lowerTitle.includes('jsdoc') || lowerTitle.includes('tsdoc')) {
    return 'docs';
  }

  // Refactor keywords
  if (lowerTitle.includes('refactor') || lowerTitle.includes('cleanup') || lowerTitle.includes('clean up') ||
      lowerTitle.includes('reorganize') || lowerTitle.includes('restructure') || lowerTitle.includes('simplify')) {
    return 'refactor';
  }

  // Default to feature
  return 'feature';
}

/**
 * Fields for quick task creation
 */
type QuickCreateField = 'title' | 'project' | 'type' | 'effort';
const QUICK_CREATE_FIELDS: QuickCreateField[] = ['title', 'project', 'type', 'effort'];

/**
 * Effort level options for quick create
 */
const EFFORT_OPTIONS: { value: EffortLevel; label: string }[] = [
  { value: 'quick_win', label: 'Quick Win' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

/**
 * Task type options for quick create
 */
const TASK_TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: 'feature', label: 'Feature' },
  { value: 'bug_fix', label: 'Bug Fix' },
  { value: 'test', label: 'Test' },
  { value: 'docs', label: 'Docs' },
  { value: 'refactor', label: 'Refactor' },
];

/**
 * Props for QuickCreateDialog
 */
interface QuickCreateDialogProps {
  projects: Project[];
  onClose: () => void;
  onCreate: () => void;
}

/**
 * Quick task creation dialog - minimal fields with smart defaults
 */
function QuickCreateDialog({ projects, onClose, onCreate }: QuickCreateDialogProps): React.ReactElement {
  const [activeField, setActiveField] = useState<QuickCreateField>('title');
  const [title, setTitle] = useState('');
  const [selectedProjectIndex, setSelectedProjectIndex] = useState(0);
  const [selectedTypeIndex, setSelectedTypeIndex] = useState(0);
  const [selectedEffortIndex, setSelectedEffortIndex] = useState(1); // Default to 'small'
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);

  // Auto-select project if only one registered
  useEffect(() => {
    if (projects.length === 1) {
      setSelectedProjectIndex(0);
    }
  }, [projects.length]);

  // Auto-infer type from title when title changes
  useEffect(() => {
    if (title.length > 3) {
      const inferredType = inferTaskType(title);
      const typeIndex = TASK_TYPE_OPTIONS.findIndex(t => t.value === inferredType);
      if (typeIndex !== -1) {
        setSelectedTypeIndex(typeIndex);
      }
    }
  }, [title]);

  const handleCreate = useCallback(() => {
    if (!title.trim()) {
      return; // Title is required
    }

    const project = projects[selectedProjectIndex];
    if (!project) {
      return; // Project is required
    }

    try {
      TaskRepository.create({
        projectId: project.id,
        type: TASK_TYPE_OPTIONS[selectedTypeIndex].value,
        title: title.trim(),
        source: 'manual',
        estimatedEffort: EFFORT_OPTIONS[selectedEffortIndex].value,
      });
      onCreate();
      onClose();
    } catch (error) {
      // Error creating task
      console.error('Failed to create task:', error);
    }
  }, [title, projects, selectedProjectIndex, selectedTypeIndex, selectedEffortIndex, onCreate, onClose]);

  useInput((input, key) => {
    // Escape closes dialog
    if (key.escape) {
      onClose();
      return;
    }

    // Enter submits (creates task)
    if (key.return && !showProjectDropdown) {
      handleCreate();
      return;
    }

    // Tab cycles through fields
    if (key.tab) {
      const currentIndex = QUICK_CREATE_FIELDS.indexOf(activeField);
      const nextIndex = key.shift
        ? (currentIndex - 1 + QUICK_CREATE_FIELDS.length) % QUICK_CREATE_FIELDS.length
        : (currentIndex + 1) % QUICK_CREATE_FIELDS.length;
      setActiveField(QUICK_CREATE_FIELDS[nextIndex]);
      setShowProjectDropdown(false);
      return;
    }

    // Handle project dropdown
    if (activeField === 'project') {
      if (key.return) {
        setShowProjectDropdown(!showProjectDropdown);
        return;
      }
      if (showProjectDropdown) {
        if (key.upArrow && selectedProjectIndex > 0) {
          setSelectedProjectIndex(selectedProjectIndex - 1);
        } else if (key.downArrow && selectedProjectIndex < projects.length - 1) {
          setSelectedProjectIndex(selectedProjectIndex + 1);
        } else if (key.return) {
          setShowProjectDropdown(false);
        }
        return;
      }
    }

    // Arrow keys change dropdown values when on type or effort fields
    if (activeField === 'type') {
      if (key.leftArrow || key.upArrow) {
        setSelectedTypeIndex((selectedTypeIndex - 1 + TASK_TYPE_OPTIONS.length) % TASK_TYPE_OPTIONS.length);
      } else if (key.rightArrow || key.downArrow) {
        setSelectedTypeIndex((selectedTypeIndex + 1) % TASK_TYPE_OPTIONS.length);
      }
      return;
    }

    if (activeField === 'effort') {
      if (key.leftArrow || key.upArrow) {
        setSelectedEffortIndex((selectedEffortIndex - 1 + EFFORT_OPTIONS.length) % EFFORT_OPTIONS.length);
      } else if (key.rightArrow || key.downArrow) {
        setSelectedEffortIndex((selectedEffortIndex + 1) % EFFORT_OPTIONS.length);
      }
      return;
    }
  });

  const selectedProject = projects[selectedProjectIndex];

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="cyan" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">Quick Create Task</Text>
        <Text dimColor> — Tab: next field  Enter: create  Escape: cancel</Text>
      </Box>

      {/* Title field - required */}
      <Box marginBottom={1}>
        <Box width={12}>
          <Text bold={activeField === 'title'} color={activeField === 'title' ? 'cyan' : undefined}>
            Title:
          </Text>
        </Box>
        <Box flexGrow={1}>
          {activeField === 'title' ? (
            <TextInput
              value={title}
              onChange={setTitle}
              placeholder="Enter task title (required)..."
            />
          ) : (
            <Text>{title || <Text dimColor>No title</Text>}</Text>
          )}
        </Box>
        {!title && <Text color="red">*</Text>}
      </Box>

      {/* Project field */}
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Box width={12}>
            <Text bold={activeField === 'project'} color={activeField === 'project' ? 'cyan' : undefined}>
              Project:
            </Text>
          </Box>
          <Box flexGrow={1}>
            <Text inverse={activeField === 'project' && !showProjectDropdown}>
              {selectedProject?.name || 'No project selected'}
            </Text>
            {activeField === 'project' && (
              <Text dimColor> (Enter to {showProjectDropdown ? 'confirm' : 'change'})</Text>
            )}
          </Box>
          {projects.length === 1 && <Text dimColor> (auto)</Text>}
        </Box>

        {/* Project dropdown */}
        {showProjectDropdown && (
          <Box flexDirection="column" marginLeft={12} marginTop={0}>
            {projects.map((project, index) => (
              <Text key={project.id} inverse={index === selectedProjectIndex}>
                {project.name}
              </Text>
            ))}
          </Box>
        )}
      </Box>

      {/* Type field */}
      <Box marginBottom={1}>
        <Box width={12}>
          <Text bold={activeField === 'type'} color={activeField === 'type' ? 'cyan' : undefined}>
            Type:
          </Text>
        </Box>
        <Box>
          {TASK_TYPE_OPTIONS.map((option, index) => {
            const isSelected = index === selectedTypeIndex;
            return (
              <Text key={option.value}>
                {index > 0 && <Text dimColor> | </Text>}
                <Text
                  bold={isSelected}
                  inverse={isSelected && activeField === 'type'}
                  color={isSelected ? 'green' : activeField === 'type' ? 'white' : 'gray'}
                >
                  {option.label}
                </Text>
              </Text>
            );
          })}
        </Box>
        {title.length > 3 && (
          <Text dimColor> (inferred)</Text>
        )}
      </Box>

      {/* Effort field */}
      <Box marginBottom={1}>
        <Box width={12}>
          <Text bold={activeField === 'effort'} color={activeField === 'effort' ? 'cyan' : undefined}>
            Effort:
          </Text>
        </Box>
        <Box>
          {EFFORT_OPTIONS.map((option, index) => {
            const isSelected = index === selectedEffortIndex;
            return (
              <Text key={option.value}>
                {index > 0 && <Text dimColor> | </Text>}
                <Text
                  bold={isSelected}
                  inverse={isSelected && activeField === 'effort'}
                  color={isSelected ? 'green' : activeField === 'effort' ? 'white' : 'gray'}
                >
                  {option.label}
                </Text>
              </Text>
            );
          })}
        </Box>
      </Box>

      {/* Footer hints */}
      <Box marginTop={1} borderTop borderColor="gray">
        <Text dimColor>
          Type is inferred from keywords: fix/bug → Bug Fix, test → Test, doc → Docs, refactor → Refactor
        </Text>
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState(''); // Debounced search term
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [activeFilterField, setActiveFilterField] = useState<FilterField | null>(null);

  // Navigation and detail view state
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailTask, setDetailTask] = useState<TaskWithProject | null>(null);

  // Quick create dialog state
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  // Load tasks and project names, set up refresh interval
  useEffect(() => {
    const loadTasks = () => {
      // Show refreshing indicator for subsequent loads
      if (hasLoaded) {
        setIsRefreshing(true);
      }

      try {
        const pendingTasks = TaskRepository.findPending();
        const projectList = listProjects();
        const projectMap = new Map(projectList.map(p => [p.id, p.name]));

        const tasksWithProjects: TaskWithProject[] = pendingTasks.map(task => ({
          ...task,
          projectName: projectMap.get(task.projectId) || 'Unknown',
        }));

        setTasks(tasksWithProjects);
        setProjects(projectList);
        setLoading(false);
        setHasLoaded(true);
        setIsRefreshing(false);
      } catch (error) {
        console.error('Failed to load tasks:', error);
        setLoading(false);
        setIsRefreshing(false);
      }
    };

    loadTasks();

    const interval = setInterval(loadTasks, 2000);
    return () => clearInterval(interval);
  }, [hasLoaded]);

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
    // If detail view is open, don't handle main view keys (detail view has its own handler)
    if (detailTask) {
      return;
    }

    // If quick create dialog is open, don't handle main view keys (dialog has its own handler)
    if (showQuickCreate) {
      return;
    }

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

    // 'c' key opens quick create dialog
    if (input === 'c' && projects.length > 0) {
      setShowQuickCreate(true);
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

    // Arrow key navigation for task list
    if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
      return;
    }
    if (key.downArrow && selectedIndex < filteredTasks.length - 1) {
      setSelectedIndex(selectedIndex + 1);
      return;
    }

    // Enter opens detail view for selected task
    if (key.return && filteredTasks.length > 0) {
      setDetailTask(filteredTasks[selectedIndex]);
      return;
    }
  });

  if (loading) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold color="blue">Task Queue</Text>
        </Box>
        <LoadingSpinner message="Loading task queue..." />
      </Box>
    );
  }

  if (tasks.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="blue">Task Queue</Text>
        {projects.length > 0 ? (
          <EmptyState
            message="No tasks yet."
            shortcutKey="c"
            shortcutAction="create one"
          />
        ) : (
          <EmptyState
            message="No tasks yet. Add a project first to create tasks."
          />
        )}
      </Box>
    );
  }

  // Check if any filters are active (for messaging)
  const hasActiveFilters = statusFilter !== 'all' || typeFilter !== 'all' || searchTerm !== '';

  // Handle closing detail view
  const handleCloseDetail = useCallback(() => {
    setDetailTask(null);
  }, []);

  // Handle closing quick create dialog
  const handleCloseQuickCreate = useCallback(() => {
    setShowQuickCreate(false);
  }, []);

  // Handle task creation - triggers refresh
  const handleTaskCreated = useCallback(() => {
    // Task list will refresh automatically via the interval
  }, []);

  // Reset selection when filter results change
  useEffect(() => {
    if (selectedIndex >= filteredTasks.length) {
      setSelectedIndex(Math.max(0, filteredTasks.length - 1));
    }
  }, [filteredTasks.length, selectedIndex]);

  // Render detail view if a task is selected
  if (detailTask) {
    return <TaskDetailView task={detailTask} onClose={handleCloseDetail} />;
  }

  // Render quick create dialog if open
  if (showQuickCreate) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <QuickCreateDialog
          projects={projects}
          onClose={handleCloseQuickCreate}
          onCreate={handleTaskCreated}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <Box paddingX={1} marginBottom={0}>
        <Text bold color="blue">Task Queue</Text>
        {isRefreshing && (
          <Box marginLeft={2}>
            <RefreshingIndicator visible={isRefreshing} />
          </Box>
        )}
        {!searchActive && !isRefreshing && (
          <Text dimColor> — /: Search  c: Create  Tab: filters  ↑↓: select  Enter: details</Text>
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
              selected={index === selectedIndex}
            />
          ))
        )}
      </Box>
    </Box>
  );
}

export default QueueView;
