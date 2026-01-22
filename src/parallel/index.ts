/**
 * Parallel Execution Module
 *
 * Provides tools for analyzing and executing user stories in parallel
 * while respecting dependencies between them.
 */

export {
  DependencyAnalyzer,
  CycleDetectedError,
  type StoryStatus,
  type StoryState,
  type ParallelBatch,
} from './dependency-analyzer.js';

export {
  ParallelScheduler,
  type WorkerState,
  type StoryExecutionState,
  type SchedulerStatus,
  type ParallelExecutionSummary,
  type ParallelSchedulerConfig,
  type ParallelSchedulerEvents,
} from './scheduler.js';

export {
  ConflictDetector,
  type ConflictStrategy,
  type FileChange,
  type FileConflict,
  type PredictedChanges,
  type SchedulingDecision,
  type ConflictDetectorConfig,
} from './conflict-detector.js';
