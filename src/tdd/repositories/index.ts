/**
 * TDD Repositories Module
 *
 * Exports all repository classes for TDD data persistence.
 */

export {
  PhaseRepository,
  type CreatePhaseInput,
  type UpdatePhaseInput,
} from './phase-repository.js';

export {
  TestRepository,
  type CreateTestInput,
  type UpdateTestInput,
  type TestStatusCounts,
} from './test-repository.js';

export {
  AgentRepository,
  type CreateAgentInput,
  type UpdateAgentInput,
} from './agent-repository.js';

export {
  BugRepository,
  type CreateBugInput,
  type UpdateBugInput,
  type BugPriorityCounts,
} from './bug-repository.js';
