/**
 * Task Prioritizer - Quick-wins-first priority scoring system
 *
 * Calculates priority scores that favor high-value, low-effort tasks.
 * This ensures that bug fixes, tests, and documentation get processed
 * quickly while larger features wait for explicit approval.
 */

import type { TaskType, EffortLevel } from './task.js';

/**
 * Type scores - higher value tasks score higher
 * Bug fixes are most urgent, followed by tests, docs, refactors, then features
 */
export const TYPE_SCORES: Record<TaskType, number> = {
  bug_fix: 100,
  test: 90,
  docs: 85,
  refactor: 70,
  feature: 50,
};

/**
 * Effort multipliers - favor quick wins
 * Quick wins get 2x multiplier, while large tasks get 0.5x
 */
export const EFFORT_MULTIPLIERS: Record<EffortLevel, number> = {
  quick_win: 2.0,
  small: 1.5,
  medium: 1.0,
  large: 0.5,
};

/**
 * Default confidence value (can be adjusted based on source reliability)
 */
const DEFAULT_CONFIDENCE = 1.0;

/**
 * Calculate priority score for a task
 *
 * Formula: typeScore * effortMultiplier * confidence
 *
 * @param type - The type of task (bug_fix, test, etc.)
 * @param effort - Estimated effort level
 * @param confidence - Optional confidence modifier (default 1.0)
 * @returns Priority score (higher = more urgent)
 *
 * @example
 * // Bug fix quick win: 100 * 2.0 * 1.0 = 200
 * calculatePriorityScore('bug_fix', 'quick_win')
 *
 * // Large feature: 50 * 0.5 * 1.0 = 25
 * calculatePriorityScore('feature', 'large')
 */
export function calculatePriorityScore(
  type: TaskType,
  effort: EffortLevel,
  confidence: number = DEFAULT_CONFIDENCE
): number {
  const typeScore = TYPE_SCORES[type];
  const effortMultiplier = EFFORT_MULTIPLIERS[effort];
  return typeScore * effortMultiplier * confidence;
}

/**
 * Approval category for tasks
 */
export type ApprovalCategory = 'auto' | 'needs_approval';

/**
 * Categorize a task for approval workflow
 *
 * Auto-approve: type in ['bug_fix', 'docs', 'test'] AND effort in ['quick_win', 'small']
 * Needs approval: everything else (features, large tasks, refactors)
 *
 * @param type - The type of task
 * @param effort - Estimated effort level
 * @returns 'auto' if can auto-approve, 'needs_approval' if manual review required
 */
export function categorizeTask(type: TaskType, effort: EffortLevel): ApprovalCategory {
  const autoApproveTypes: TaskType[] = ['bug_fix', 'docs', 'test'];
  const autoApproveEfforts: EffortLevel[] = ['quick_win', 'small'];

  if (autoApproveTypes.includes(type) && autoApproveEfforts.includes(effort)) {
    return 'auto';
  }

  return 'needs_approval';
}

/**
 * Sort tasks by priority score (descending)
 * For equal scores, maintains original order (stable sort)
 */
export function sortByPriority<T extends { priorityScore: number }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => b.priorityScore - a.priorityScore);
}

/**
 * Get a human-readable description of why a task has its priority
 */
export function explainPriority(type: TaskType, effort: EffortLevel): string {
  const typeScore = TYPE_SCORES[type];
  const effortMultiplier = EFFORT_MULTIPLIERS[effort];
  const score = calculatePriorityScore(type, effort);
  const category = categorizeTask(type, effort);

  return `Score: ${score} (${type}=${typeScore} x ${effort}=${effortMultiplier}). ${
    category === 'auto' ? 'Auto-approved' : 'Requires approval'
  }.`;
}
