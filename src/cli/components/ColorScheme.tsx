/**
 * ColorScheme - Centralized color constants for consistent UI theming
 *
 * This module provides a standardized color scheme for the entire dashboard.
 * Use these constants instead of hardcoded color strings to maintain consistency.
 */

/**
 * Status colors - Used for task status, loop status, execution status, etc.
 *
 * Semantic meaning:
 * - green: active/running operations
 * - red: failures/errors/stopped
 * - yellow: warnings/paused/pending attention
 * - cyan: completed/success
 * - gray: pending/inactive/not started
 * - blue: queued/in-progress (secondary active state)
 */
export const STATUS_COLORS = {
  // Success states
  success: 'cyan',
  completed: 'cyan',

  // Active states
  running: 'green',
  active: 'green',

  // Warning/attention states
  warning: 'yellow',
  paused: 'yellow',
  pending: 'gray',

  // Queued/waiting states
  queued: 'blue',
  approved: 'cyan',

  // Error states
  failed: 'red',
  error: 'red',
  stopped: 'red',
  critical: 'red',

  // Inactive states
  inactive: 'gray',
} as const;

/**
 * Task type colors - Used for categorizing different types of tasks
 *
 * Semantic meaning:
 * - magenta: features (new functionality)
 * - red: bug fixes (corrections)
 * - cyan: tests (verification)
 * - blue: documentation (information)
 * - yellow: refactoring (improvement)
 */
export const TASK_TYPE_COLORS = {
  feature: 'magenta',
  bug_fix: 'red',
  test: 'cyan',
  docs: 'blue',
  refactor: 'yellow',
} as const;

/**
 * Risk level colors - Used for proposal risk scoring
 *
 * Semantic meaning:
 * - green: low risk (safe)
 * - yellow: medium risk (caution)
 * - red: high/critical risk (danger)
 */
export const RISK_COLORS = {
  low: 'green',
  medium: 'yellow',
  high: 'red',
  critical: 'red',
} as const;

/**
 * Severity colors - Used for notifications and alerts
 *
 * Semantic meaning:
 * - cyan: info (informational)
 * - yellow: warning (attention needed)
 * - red: critical (immediate action)
 */
export const SEVERITY_COLORS = {
  info: 'cyan',
  warning: 'yellow',
  critical: 'red',
} as const;

/**
 * Effort level colors - Used for task effort estimation
 *
 * Semantic meaning:
 * - greenBright: quick wins (minimal effort)
 * - green: small (low effort)
 * - yellow: medium (moderate effort)
 * - red: large (significant effort)
 */
export const EFFORT_COLORS = {
  quick_win: 'greenBright',
  small: 'green',
  medium: 'yellow',
  large: 'red',
} as const;

/**
 * UI element colors - Used for headers, highlights, and interactive elements
 */
export const UI_COLORS = {
  // Headers and titles
  header: 'blue',
  sectionHeader: 'cyan',

  // Interactive elements
  highlight: 'yellow',
  selection: 'cyan',

  // Action keys
  actionKeyPrimary: 'green',
  actionKeyDanger: 'red',
  actionKeyCyan: 'cyan',

  // Misc
  dimmed: 'gray',
} as const;

/**
 * Get status color for task status
 */
export function getTaskStatusColor(status: string): string {
  const colorMap: Record<string, string> = {
    pending: STATUS_COLORS.pending,
    approved: STATUS_COLORS.approved,
    queued: STATUS_COLORS.queued,
    running: STATUS_COLORS.running,
    completed: STATUS_COLORS.completed,
    failed: STATUS_COLORS.failed,
  };
  return colorMap[status] || 'white';
}

/**
 * Get status color for loop status
 */
export function getLoopStatusColor(status: string): string {
  const colorMap: Record<string, string> = {
    pending: STATUS_COLORS.pending,
    running: STATUS_COLORS.running,
    paused: STATUS_COLORS.paused,
    completed: STATUS_COLORS.completed,
    failed: STATUS_COLORS.failed,
    stopped: STATUS_COLORS.stopped,
  };
  return colorMap[status] || 'white';
}

/**
 * Get status color for execution/iteration status
 */
export function getExecutionStatusColor(status: string): string {
  const colorMap: Record<string, string> = {
    completed: STATUS_COLORS.completed,
    running: STATUS_COLORS.running,
    failed: STATUS_COLORS.failed,
    pending: STATUS_COLORS.pending,
  };
  return colorMap[status] || 'gray';
}

/**
 * Get color for task type
 */
export function getTaskTypeColor(type: string): string {
  return (TASK_TYPE_COLORS as Record<string, string>)[type] || 'white';
}

/**
 * Get color for risk score (0-100)
 */
export function getRiskColor(score: number): string {
  if (score < 40) return RISK_COLORS.low;
  if (score <= 70) return RISK_COLORS.medium;
  return RISK_COLORS.high;
}

/**
 * Get color for risk level
 */
export function getRiskLevelColor(level: string): string {
  return (RISK_COLORS as Record<string, string>)[level] || 'yellow';
}

/**
 * Get color for notification severity
 */
export function getSeverityColor(severity: string): string {
  return (SEVERITY_COLORS as Record<string, string>)[severity] || 'cyan';
}

/**
 * Get color for effort level
 */
export function getEffortColor(effort: string): string {
  return (EFFORT_COLORS as Record<string, string>)[effort] || 'white';
}

/**
 * Format task type for display with color
 */
export function formatTaskType(type: string): { text: string; color: string } {
  const typeMap: Record<string, { text: string; color: string }> = {
    bug_fix: { text: 'Bug Fix', color: TASK_TYPE_COLORS.bug_fix },
    test: { text: 'Test', color: TASK_TYPE_COLORS.test },
    docs: { text: 'Docs', color: TASK_TYPE_COLORS.docs },
    refactor: { text: 'Refactor', color: TASK_TYPE_COLORS.refactor },
    feature: { text: 'Feature', color: TASK_TYPE_COLORS.feature },
  };
  return typeMap[type] || { text: type, color: 'white' };
}

/**
 * Format task status for display with color
 */
export function formatTaskStatus(status: string): { text: string; color: string } {
  const statusMap: Record<string, { text: string; color: string }> = {
    pending: { text: 'Pending', color: STATUS_COLORS.pending },
    approved: { text: 'Approved', color: STATUS_COLORS.approved },
    queued: { text: 'Queued', color: STATUS_COLORS.queued },
    running: { text: 'Running', color: STATUS_COLORS.running },
    completed: { text: 'Completed', color: STATUS_COLORS.completed },
    failed: { text: 'Failed', color: STATUS_COLORS.failed },
  };
  return statusMap[status] || { text: status, color: 'white' };
}

/**
 * Format effort level for display with color
 */
export function formatEffort(effort: string): { text: string; color: string } {
  const effortMap: Record<string, { text: string; color: string }> = {
    quick_win: { text: 'Quick Win', color: EFFORT_COLORS.quick_win },
    small: { text: 'Small', color: EFFORT_COLORS.small },
    medium: { text: 'Medium', color: EFFORT_COLORS.medium },
    large: { text: 'Large', color: EFFORT_COLORS.large },
  };
  return effortMap[effort] || { text: effort, color: 'white' };
}
