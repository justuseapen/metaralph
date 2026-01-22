/**
 * TDD Type Definitions
 *
 * TypeScript types for the autonomous 6-phase TDD workflow:
 * RED -> RESEARCH -> GREEN -> INTEGRATE -> REFINE -> COMMIT
 *
 * These types ensure consistent interfaces across all TDD modules.
 */

/**
 * The six phases of the TDD workflow
 */
export type TddPhase =
  | 'red'
  | 'research'
  | 'green'
  | 'integrate'
  | 'refine'
  | 'commit';

/**
 * Status of a TDD phase
 */
export type PhaseStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

/**
 * Bug severity levels (P0 = most critical, P3 = least critical)
 */
export type BugSeverity = 'P0' | 'P1' | 'P2' | 'P3';

/**
 * Bug categories for classification
 */
export type BugCategory =
  | 'logic'
  | 'security'
  | 'performance'
  | 'style'
  | 'compatibility';

/**
 * Bug status in the refinement workflow
 */
export type BugStatus = 'open' | 'fixed' | 'wontfix' | 'deferred';

/**
 * Types of research agents spawned in the RESEARCH phase
 */
export type ResearchAgentType =
  | 'patterns'
  | 'contracts'
  | 'testing'
  | 'security'
  | 'performance';

/**
 * Status of a research agent
 */
export type ResearchAgentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout';

/**
 * Types of generated tests
 */
export type TestType = 'unit' | 'integration' | 'e2e';

/**
 * Status of a generated test
 */
export type TestStatus = 'failing' | 'passing' | 'error' | 'skipped';

/**
 * Record of a TDD phase execution
 */
export interface TddPhaseRecord {
  id: string;
  executionId: string;
  phase: TddPhase;
  status: PhaseStatus;
  startedAt: string | null;
  completedAt: string | null;
  /**
   * Phase-specific metrics (e.g., tests generated, bugs found, etc.)
   */
  metrics: Record<string, unknown>;
  createdAt: string;
}

/**
 * A test generated during the RED phase
 */
export interface GeneratedTest {
  id: string;
  phaseId: string;
  testType: TestType;
  /**
   * Path to the test file
   */
  filePath: string;
  /**
   * Content of the test file
   */
  testContent: string;
  /**
   * Current status of the test
   */
  status: TestStatus;
  /**
   * Error message if status is 'error'
   */
  errorMessage?: string;
  createdAt: string;
}

/**
 * A research agent spawned during the RESEARCH phase
 */
export interface ResearchAgent {
  id: string;
  phaseId: string;
  agentType: ResearchAgentType;
  status: ResearchAgentStatus;
  /**
   * Findings produced by the agent
   */
  findings: ResearchFindings | null;
  startedAt: string | null;
  completedAt: string | null;
  /**
   * Time taken in milliseconds
   */
  durationMs?: number;
}

/**
 * Findings from a research agent
 */
export interface ResearchFindings {
  /**
   * Type of agent that produced these findings
   */
  agentType: ResearchAgentType;
  /**
   * Summary of the findings
   */
  summary: string;
  /**
   * Detailed recommendations
   */
  recommendations: string[];
  /**
   * Code patterns discovered
   */
  patterns?: CodePattern[];
  /**
   * Contracts/interfaces identified
   */
  contracts?: ContractDefinition[];
  /**
   * Security concerns identified
   */
  securityConcerns?: SecurityConcern[];
  /**
   * Performance considerations
   */
  performanceNotes?: string[];
  /**
   * Testing strategies recommended
   */
  testingStrategies?: string[];
  /**
   * Raw output from the research agent
   */
  rawOutput?: string;
}

/**
 * A code pattern discovered during research
 */
export interface CodePattern {
  name: string;
  description: string;
  /**
   * Files where this pattern is used
   */
  examples: string[];
}

/**
 * A contract/interface definition
 */
export interface ContractDefinition {
  /**
   * Layer this contract belongs to (ui, api, db)
   */
  layer: 'ui' | 'api' | 'db';
  /**
   * Type of contract
   */
  contractType: string;
  /**
   * The contract definition (e.g., TypeScript interface)
   */
  definition: string;
  /**
   * Files that implement this contract
   */
  implementedBy?: string[];
}

/**
 * A security concern identified during research
 */
export interface SecurityConcern {
  severity: BugSeverity;
  category: string;
  description: string;
  recommendation: string;
}

/**
 * A bug found during the REFINE phase
 */
export interface Bug {
  id: string;
  phaseId: string;
  severity: BugSeverity;
  category: BugCategory;
  description: string;
  /**
   * File where the bug was found
   */
  filePath: string;
  /**
   * Line number where the bug was found
   */
  lineNumber?: number;
  /**
   * Current status of the bug
   */
  status: BugStatus;
  /**
   * Suggested fix for the bug
   */
  suggestedFix?: string;
  /**
   * When the bug was fixed (if applicable)
   */
  fixedAt?: string;
  /**
   * Number of fix attempts made
   */
  fixAttempts?: number;
  createdAt: string;
}

/**
 * Receipt documenting a PR created by the COMMIT phase
 */
export interface PrReceipt {
  id: string;
  executionId: string;
  /**
   * Summary of test results
   */
  testReceipt: TestReceipt;
  /**
   * Summary of contract validation
   */
  integrationReceipt: IntegrationReceipt;
  /**
   * Summary of code review and bug fixes
   */
  reviewReceipt: ReviewReceipt;
  /**
   * URL of the created PR
   */
  prUrl?: string;
  createdAt: string;
}

/**
 * Test results summary
 */
export interface TestReceipt {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  /**
   * Code coverage percentage (0-100)
   */
  coveragePercent?: number;
  /**
   * Time to run all tests in milliseconds
   */
  durationMs?: number;
}

/**
 * Contract validation summary
 */
export interface IntegrationReceipt {
  contractsValidated: number;
  contractsFailed: number;
  /**
   * Layers that were checked
   */
  layersChecked: ('ui' | 'api' | 'db')[];
  /**
   * Validation errors
   */
  errors?: string[];
}

/**
 * Code review and bug resolution summary
 */
export interface ReviewReceipt {
  totalBugsFound: number;
  p0Count: number;
  p1Count: number;
  p2Count: number;
  p3Count: number;
  bugsFixed: number;
  /**
   * Number of REFINE iterations performed
   */
  refineIterations: number;
  /**
   * Whether opus model escalation was used
   */
  opusEscalationUsed: boolean;
}

/**
 * Configuration for the autonomous TDD workflow
 */
export interface AutonomousTddConfig {
  /**
   * Maximum number of REFINE iterations before giving up
   * @default 3
   */
  maxRefineIterations: number;
  /**
   * Maximum number of GREEN phase retries (test passes)
   * @default 2
   */
  maxGreenRetries: number;
  /**
   * Timeouts for each phase in milliseconds
   */
  timeouts: PhaseTimeouts;
  /**
   * Whether to use opus model escalation on final REFINE iteration
   * @default true
   */
  useOpusEscalation: boolean;
  /**
   * Model to use for escalation
   * @default 'claude-opus-4-20250514'
   */
  escalationModel: string;
}

/**
 * Timeout configuration for each phase
 */
export interface PhaseTimeouts {
  red: number;
  research: number;
  green: number;
  integrate: number;
  refine: number;
  commit: number;
}

/**
 * Default time targets for each phase in milliseconds
 */
export const PHASE_TIME_TARGETS: PhaseTimeouts = {
  /** RED phase: Generate tests from PRD (5 minutes) */
  red: 5 * 60 * 1000,
  /** RESEARCH phase: Parallel AI research (10 minutes) */
  research: 10 * 60 * 1000,
  /** GREEN phase: Implementation until tests pass (30 minutes) */
  green: 30 * 60 * 1000,
  /** INTEGRATE phase: Contract validation (5 minutes) */
  integrate: 5 * 60 * 1000,
  /** REFINE phase: Bug detection and fixing (15 minutes per iteration) */
  refine: 15 * 60 * 1000,
  /** COMMIT phase: PR creation (2 minutes) */
  commit: 2 * 60 * 1000,
};

/**
 * Default configuration for autonomous TDD
 */
export const DEFAULT_TDD_CONFIG: AutonomousTddConfig = {
  maxRefineIterations: 3,
  maxGreenRetries: 2,
  timeouts: PHASE_TIME_TARGETS,
  useOpusEscalation: true,
  escalationModel: 'claude-opus-4-20250514',
};

/**
 * Result of running the autonomous TDD workflow
 */
export interface TddResult {
  success: boolean;
  executionId: string;
  /**
   * All phases that were executed
   */
  phases: TddPhaseRecord[];
  /**
   * The final PR receipt (if COMMIT phase succeeded)
   */
  receipt?: PrReceipt;
  /**
   * PR URL (if created)
   */
  prUrl?: string;
  /**
   * Error message (if failed)
   */
  error?: string;
  /**
   * Total duration in milliseconds
   */
  totalDurationMs: number;
}

/**
 * Frozen contracts from the RESEARCH phase
 * These are passed to the GREEN phase to guide implementation
 */
export interface FrozenContracts {
  /**
   * When these contracts were frozen
   */
  frozenAt: string;
  /**
   * UI layer contracts
   */
  ui: ContractDefinition[];
  /**
   * API layer contracts
   */
  api: ContractDefinition[];
  /**
   * Database layer contracts
   */
  db: ContractDefinition[];
  /**
   * Synthesized implementation guidance
   */
  implementationGuidance: string;
  /**
   * Code patterns to follow
   */
  patterns: CodePattern[];
}

/**
 * Events emitted by the Phase Orchestrator
 */
export interface PhaseOrchestratorEvents {
  'phase:started': {
    executionId: string;
    phase: TddPhase;
    startedAt: string;
  };
  'phase:completed': {
    executionId: string;
    phase: TddPhase;
    completedAt: string;
    metrics: Record<string, unknown>;
  };
  'phase:failed': {
    executionId: string;
    phase: TddPhase;
    error: string;
    failedAt: string;
  };
}
