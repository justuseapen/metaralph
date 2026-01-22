/**
 * TDD Module
 *
 * Implements the autonomous 6-phase TDD workflow:
 * RED -> RESEARCH -> GREEN -> INTEGRATE -> REFINE -> COMMIT
 *
 * This workflow produces production-ready PRs with P0/P1 bugs = 0.
 */

// Export Phase Orchestrator
export {
  PhaseOrchestrator,
  type ProjectContext,
  type TaskContext,
  type PhaseFailure,
} from './phase-orchestrator.js';

// Export Test Generator (RED phase)
export {
  TestGenerator,
  type TestFramework,
  type TestGeneratorProjectContext,
  type TestableRequirement,
  type TestGenerationResult,
  type TestVerificationResult,
  type TestGeneratorConfig,
} from './test-generator.js';

// Export Research Coordinator (RESEARCH phase)
export {
  ResearchCoordinator,
  type ResearchContext,
  type AgentResult,
  type ResearchResult,
  type ResearchCoordinatorConfig,
} from './research-coordinator.js';

// Export Green Phase (GREEN phase)
export {
  GreenPhase,
  type GreenPhaseTaskContext,
  type GreenPhaseProjectContext,
  type GreenPhaseConfig,
  type GreenPhaseAttempt,
  type TestRunResult,
  type GreenPhaseResult,
  type EnhancedPrd,
} from './green-phase.js';

// Export Contract Validator (INTEGRATE phase)
export {
  ContractValidator,
  type ContractValidatorProjectContext,
  type ContractValidatorConfig,
  type LayerValidationResult,
  type ValidationError,
  type ContractValidationResult,
  type ImplementedContract,
} from './contract-validator.js';

// Export Bug Classifier (REFINE phase)
export {
  BugClassifier,
  type BugClassifierProjectContext,
  type BugClassifierConfig,
  type CodeChanges,
  type ModifiedFile,
  type NewFile,
  type BugClassificationResult,
  type BugClassificationMetrics,
  type AutoFixConfig,
  type AutoFixResult,
  type AutoFixMetrics,
} from './bug-classifier.js';

// Export Receipt Builder (COMMIT phase)
export {
  ReceiptBuilder,
  type ReceiptBuilderConfig,
  type TestResultsSummary,
  type ContractValidationSummary,
  type BugResolutionSummary,
  type PrBodyInput,
} from './receipt-builder.js';

// Export repositories
export {
  PhaseRepository,
  type CreatePhaseInput,
  type UpdatePhaseInput,
  TestRepository,
  type CreateTestInput,
  type UpdateTestInput,
  type TestStatusCounts,
  AgentRepository,
  type CreateAgentInput,
  type UpdateAgentInput,
  BugRepository,
  type CreateBugInput,
  type UpdateBugInput,
  type BugPriorityCounts,
  ReceiptRepository,
  type CreateReceiptInput,
  type UpdateReceiptInput,
} from './repositories/index.js';

// Export all types
export {
  // Phase types
  type TddPhase,
  type PhaseStatus,
  type PhaseTimeouts,

  // Bug types
  type BugSeverity,
  type BugCategory,
  type BugStatus,
  type Bug,

  // Research types
  type ResearchAgentType,
  type ResearchAgentStatus,
  type ResearchAgent,
  type ResearchFindings,
  type CodePattern,
  type ContractDefinition,
  type SecurityConcern,

  // Test types
  type TestType,
  type TestStatus,
  type GeneratedTest,

  // Phase record
  type TddPhaseRecord,

  // Receipt types
  type PrReceipt,
  type TestReceipt,
  type IntegrationReceipt,
  type ReviewReceipt,

  // Config types
  type AutonomousTddConfig,

  // Result types
  type TddResult,
  type FrozenContracts,

  // Event types
  type PhaseOrchestratorEvents,

  // Constants
  PHASE_TIME_TARGETS,
  DEFAULT_TDD_CONFIG,
} from './types.js';
