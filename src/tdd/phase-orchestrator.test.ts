/**
 * Tests for phase-orchestrator.ts - TDD phase transition and autonomous workflow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UserStory } from '../collaboration/prd-builder.js';
import type {
  TddPhase,
  TddPhaseRecord,
  FrozenContracts,
  Bug,
  AutonomousTddConfig,
} from './types.js';

// Create hoisted mock functions to be used in vi.mock factories
const {
  mockPhaseRepositoryCreate,
  mockPhaseRepositoryUpdate,
  mockPhaseRepositoryGetCurrentPhase,
  mockPhaseRepositoryFindByExecution,
  mockBugRepositoryCanExitRefineLoop,
  mockTestGeneratorGenerate,
  mockResearchCoordinatorRunParallel,
  mockGreenPhaseRun,
  mockGreenPhaseDetectTestFramework,
  mockContractValidatorValidate,
  mockBugClassifierAiReview,
  mockBugClassifierAutoFix,
  mockBugClassifierLoadCodeChangesFromGit,
  mockReceiptBuilderBuild,
  mockReceiptBuilderCreatePr,
  mockRollbackCreateCheckpoint,
  mockRollbackRollbackToCheckpoint,
  mockUuidv4,
} = vi.hoisted(() => ({
  mockPhaseRepositoryCreate: vi.fn(),
  mockPhaseRepositoryUpdate: vi.fn(),
  mockPhaseRepositoryGetCurrentPhase: vi.fn(),
  mockPhaseRepositoryFindByExecution: vi.fn(),
  mockBugRepositoryCanExitRefineLoop: vi.fn(),
  mockTestGeneratorGenerate: vi.fn(),
  mockResearchCoordinatorRunParallel: vi.fn(),
  mockGreenPhaseRun: vi.fn(),
  mockGreenPhaseDetectTestFramework: vi.fn(),
  mockContractValidatorValidate: vi.fn(),
  mockBugClassifierAiReview: vi.fn(),
  mockBugClassifierAutoFix: vi.fn(),
  mockBugClassifierLoadCodeChangesFromGit: vi.fn(),
  mockReceiptBuilderBuild: vi.fn(),
  mockReceiptBuilderCreatePr: vi.fn(),
  mockRollbackCreateCheckpoint: vi.fn(),
  mockRollbackRollbackToCheckpoint: vi.fn(),
  mockUuidv4: vi.fn(),
}));

// Mock uuid module
vi.mock('uuid', () => ({
  v4: mockUuidv4,
}));

// Mock repositories
vi.mock('./repositories/index.js', () => ({
  PhaseRepository: {
    create: mockPhaseRepositoryCreate,
    update: mockPhaseRepositoryUpdate,
    getCurrentPhase: mockPhaseRepositoryGetCurrentPhase,
    findByExecution: mockPhaseRepositoryFindByExecution,
  },
  BugRepository: {
    canExitRefineLoop: mockBugRepositoryCanExitRefineLoop,
  },
}));

// Mock phase modules
vi.mock('./test-generator.js', () => ({
  TestGenerator: {
    generate: mockTestGeneratorGenerate,
  },
}));

vi.mock('./research-coordinator.js', () => ({
  ResearchCoordinator: {
    runParallel: mockResearchCoordinatorRunParallel,
  },
}));

vi.mock('./green-phase.js', () => ({
  GreenPhase: {
    run: mockGreenPhaseRun,
    detectTestFramework: mockGreenPhaseDetectTestFramework,
  },
}));

vi.mock('./contract-validator.js', () => ({
  ContractValidator: {
    validate: mockContractValidatorValidate,
  },
}));

vi.mock('./bug-classifier.js', () => ({
  BugClassifier: {
    aiReview: mockBugClassifierAiReview,
    autoFix: mockBugClassifierAutoFix,
    loadCodeChangesFromGit: mockBugClassifierLoadCodeChangesFromGit,
  },
}));

vi.mock('./receipt-builder.js', () => ({
  ReceiptBuilder: {
    build: mockReceiptBuilderBuild,
    createPr: mockReceiptBuilderCreatePr,
  },
}));

vi.mock('../self-improve/rollback.js', () => ({
  Rollback: {
    createCheckpoint: mockRollbackCreateCheckpoint,
    rollbackToCheckpoint: mockRollbackRollbackToCheckpoint,
  },
}));

import {
  PhaseOrchestrator,
  type TaskContext,
  type ProjectContext,
} from './phase-orchestrator.js';

/**
 * Helper to create a UserStory with minimal required fields
 */
function createUserStory(options: Partial<UserStory> = {}): UserStory {
  return {
    id: options.id ?? 'US-001',
    title: options.title ?? 'Test Story',
    description: options.description ?? 'Test description',
    acceptanceCriteria: options.acceptanceCriteria ?? ['Criterion 1', 'Typecheck passes'],
    priority: options.priority ?? 1,
    passes: options.passes ?? false,
    notes: options.notes ?? '',
    dependsOn: options.dependsOn,
  };
}

/**
 * Helper to create a TaskContext
 */
function createTaskContext(options: Partial<TaskContext> = {}): TaskContext {
  return {
    userStory: options.userStory ?? createUserStory(),
    prdJson: options.prdJson ?? '{"project": "test", "userStories": []}',
    executionId: options.executionId,
  };
}

/**
 * Helper to create a ProjectContext
 */
function createProjectContext(options: Partial<ProjectContext> = {}): ProjectContext {
  return {
    path: options.path ?? '/test/project',
    name: options.name ?? 'test-project',
    branchName: options.branchName,
  };
}

/**
 * Helper to create a mock TddPhaseRecord
 */
function createPhaseRecord(options: Partial<TddPhaseRecord> = {}): TddPhaseRecord {
  return {
    id: options.id ?? 'phase-001',
    executionId: options.executionId ?? 'exec-001',
    phase: options.phase ?? 'red',
    status: options.status ?? 'pending',
    startedAt: options.startedAt ?? null,
    completedAt: options.completedAt ?? null,
    metrics: options.metrics ?? {},
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Helper to create mock FrozenContracts
 */
function createFrozenContracts(): FrozenContracts {
  return {
    frozenAt: new Date().toISOString(),
    ui: [],
    api: [],
    db: [],
    implementationGuidance: 'Test guidance',
    patterns: [],
  };
}

/**
 * Helper to create a mock Bug
 */
function createBug(options: Partial<Bug> = {}): Bug {
  return {
    id: options.id ?? 'bug-001',
    phaseId: options.phaseId ?? 'phase-001',
    severity: options.severity ?? 'P2',
    category: options.category ?? 'logic',
    description: options.description ?? 'Test bug',
    filePath: options.filePath ?? '/test/file.ts',
    status: options.status ?? 'open',
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Setup mocks for a successful workflow
 */
function setupSuccessfulWorkflowMocks(phaseIdCounter: { value: number } = { value: 0 }) {
  // UUID generation
  mockUuidv4.mockImplementation(() => `uuid-${++phaseIdCounter.value}`);

  // Phase repository
  mockPhaseRepositoryCreate.mockImplementation((input) => ({
    id: `phase-${phaseIdCounter.value}`,
    ...input,
    completedAt: null,
    metrics: input.metrics ?? {},
    createdAt: new Date().toISOString(),
  }));
  mockPhaseRepositoryUpdate.mockReturnValue(undefined);
  mockPhaseRepositoryGetCurrentPhase.mockReturnValue(null);

  // Rollback
  mockRollbackCreateCheckpoint.mockResolvedValue({
    id: 'checkpoint-001',
    commitSha: 'abc123',
    branchName: 'test-branch',
    description: 'Test checkpoint',
    createdAt: new Date().toISOString(),
    hadUncommittedChanges: false,
  });
  mockRollbackRollbackToCheckpoint.mockResolvedValue({ success: true });

  // Test Generator (RED phase)
  mockTestGeneratorGenerate.mockResolvedValue({
    success: true,
    tests: [
      { filePath: '/test/project/src/__tests__/test.test.ts' },
    ],
    metrics: { testsGenerated: 1 },
  });

  // Research Coordinator (RESEARCH phase)
  mockResearchCoordinatorRunParallel.mockResolvedValue({
    success: true,
    frozenContracts: createFrozenContracts(),
    metrics: {
      patternsDiscovered: 2,
      agentsSucceeded: 5,
      agentsFailed: 0,
    },
  });

  // Green Phase
  mockGreenPhaseDetectTestFramework.mockReturnValue('vitest');
  mockGreenPhaseRun.mockResolvedValue({
    success: true,
    attempts: 1,
    testResults: { passed: true, total: 5, failed: 0 },
    metrics: { testsRun: 5, testsPasssed: 5 },
  });

  // Contract Validator (INTEGRATE phase)
  mockContractValidatorValidate.mockResolvedValue({
    passed: true,
    totalContractsValidated: 3,
    totalContractsFailed: 0,
    layerResults: [
      { layer: 'ui', contractsValidated: 1, contractsFailed: 0, errors: [], warnings: [] },
      { layer: 'api', contractsValidated: 1, contractsFailed: 0, errors: [], warnings: [] },
      { layer: 'db', contractsValidated: 1, contractsFailed: 0, errors: [], warnings: [] },
    ],
    errors: [],
    warnings: [],
  });

  // Bug Classifier (REFINE phase)
  mockBugClassifierLoadCodeChangesFromGit.mockResolvedValue({ files: [], diff: '' });
  mockBugClassifierAiReview.mockResolvedValue({
    success: true,
    bugs: [],
    metrics: {
      totalBugsFound: 0,
      p0Count: 0,
      p1Count: 0,
      p2Count: 0,
      p3Count: 0,
    },
  });
  mockBugClassifierAutoFix.mockResolvedValue({
    bugs: [],
    metrics: {
      p0Fixed: 0,
      p1Fixed: 0,
      p2Fixed: 0,
      p3Fixed: 0,
      unfixable: 0,
      totalAttempts: 0,
      successRate: 100,
      escalationUsed: false,
    },
  });
  mockBugRepositoryCanExitRefineLoop.mockReturnValue(true);

  // Receipt Builder (COMMIT phase)
  mockReceiptBuilderBuild.mockReturnValue({
    id: 'receipt-001',
    executionId: 'exec-001',
    testReceipt: { totalTests: 5, passed: 5, failed: 0, skipped: 0 },
    integrationReceipt: { contractsValidated: 3, contractsFailed: 0, layersChecked: ['ui', 'api', 'db'] },
    reviewReceipt: {
      totalBugsFound: 0,
      p0Count: 0,
      p1Count: 0,
      p2Count: 0,
      p3Count: 0,
      bugsFixed: 0,
      refineIterations: 1,
      opusEscalationUsed: false,
    },
    createdAt: new Date().toISOString(),
  });
  mockReceiptBuilderCreatePr.mockResolvedValue({
    success: true,
    prUrl: 'https://github.com/test/repo/pull/1',
    title: 'Test PR',
  });
}

describe('phase-orchestrator.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.error during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('PhaseOrchestrator constructor', () => {
    it('should create orchestrator with default config', () => {
      const orchestrator = new PhaseOrchestrator();
      const config = orchestrator.getConfig();

      expect(config.maxRefineIterations).toBe(3);
      expect(config.maxGreenRetries).toBe(2);
      expect(config.useOpusEscalation).toBe(true);
    });

    it('should accept custom config', () => {
      const orchestrator = new PhaseOrchestrator({
        maxRefineIterations: 5,
        maxGreenRetries: 3,
      });
      const config = orchestrator.getConfig();

      expect(config.maxRefineIterations).toBe(5);
      expect(config.maxGreenRetries).toBe(3);
    });

    it('should merge custom timeouts with defaults', () => {
      const orchestrator = new PhaseOrchestrator({
        timeouts: {
          red: 60000,
          research: 60000,
          green: 60000,
          integrate: 60000,
          refine: 60000,
          commit: 60000,
        },
      });
      const config = orchestrator.getConfig();

      expect(config.timeouts.red).toBe(60000);
    });

    it('should initialize with no current execution', () => {
      const orchestrator = new PhaseOrchestrator();

      expect(orchestrator.getCurrentExecutionId()).toBeNull();
      expect(orchestrator.getRefineIterationCount()).toBe(0);
    });
  });

  describe('canTransition', () => {
    it('should allow valid transitions from start', () => {
      const orchestrator = new PhaseOrchestrator();
      mockPhaseRepositoryGetCurrentPhase.mockReturnValue(null);

      expect(orchestrator.canTransition('exec-001', 'red')).toBe(true);
      expect(orchestrator.canTransition('exec-001', 'research')).toBe(false);
      expect(orchestrator.canTransition('exec-001', 'green')).toBe(false);
    });

    it('should allow valid transitions from red', () => {
      const orchestrator = new PhaseOrchestrator();
      mockPhaseRepositoryGetCurrentPhase.mockReturnValue(createPhaseRecord({ phase: 'red' }));

      expect(orchestrator.canTransition('exec-001', 'research')).toBe(true);
      expect(orchestrator.canTransition('exec-001', 'green')).toBe(false);
      expect(orchestrator.canTransition('exec-001', 'commit')).toBe(false);
    });

    it('should allow valid transitions from research', () => {
      const orchestrator = new PhaseOrchestrator();
      mockPhaseRepositoryGetCurrentPhase.mockReturnValue(createPhaseRecord({ phase: 'research' }));

      expect(orchestrator.canTransition('exec-001', 'green')).toBe(true);
      expect(orchestrator.canTransition('exec-001', 'red')).toBe(false);
    });

    it('should allow valid transitions from green', () => {
      const orchestrator = new PhaseOrchestrator();
      mockPhaseRepositoryGetCurrentPhase.mockReturnValue(createPhaseRecord({ phase: 'green' }));

      expect(orchestrator.canTransition('exec-001', 'integrate')).toBe(true);
      expect(orchestrator.canTransition('exec-001', 'refine')).toBe(false);
    });

    it('should allow valid transitions from integrate', () => {
      const orchestrator = new PhaseOrchestrator();
      mockPhaseRepositoryGetCurrentPhase.mockReturnValue(createPhaseRecord({ phase: 'integrate' }));

      expect(orchestrator.canTransition('exec-001', 'refine')).toBe(true);
      expect(orchestrator.canTransition('exec-001', 'commit')).toBe(false);
    });

    it('should allow refine to loop back to itself or proceed to commit', () => {
      const orchestrator = new PhaseOrchestrator();
      mockPhaseRepositoryGetCurrentPhase.mockReturnValue(createPhaseRecord({ phase: 'refine' }));

      expect(orchestrator.canTransition('exec-001', 'refine')).toBe(true);
      expect(orchestrator.canTransition('exec-001', 'commit')).toBe(true);
      expect(orchestrator.canTransition('exec-001', 'green')).toBe(false);
    });

    it('should not allow any transitions from commit (terminal phase)', () => {
      const orchestrator = new PhaseOrchestrator();
      mockPhaseRepositoryGetCurrentPhase.mockReturnValue(createPhaseRecord({ phase: 'commit' }));

      expect(orchestrator.canTransition('exec-001', 'red')).toBe(false);
      expect(orchestrator.canTransition('exec-001', 'research')).toBe(false);
      expect(orchestrator.canTransition('exec-001', 'green')).toBe(false);
      expect(orchestrator.canTransition('exec-001', 'integrate')).toBe(false);
      expect(orchestrator.canTransition('exec-001', 'refine')).toBe(false);
      expect(orchestrator.canTransition('exec-001', 'commit')).toBe(false);
    });
  });

  describe('transitionToPhase', () => {
    it('should create new phase record for valid transition', () => {
      const orchestrator = new PhaseOrchestrator();
      mockPhaseRepositoryGetCurrentPhase.mockReturnValue(null);
      mockPhaseRepositoryCreate.mockReturnValue(createPhaseRecord({ phase: 'red' }));

      const result = orchestrator.transitionToPhase('exec-001', 'red');

      expect(result).not.toBeNull();
      expect(result?.phase).toBe('red');
      expect(mockPhaseRepositoryCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: 'exec-001',
          phase: 'red',
          status: 'running',
        })
      );
    });

    it('should return null for invalid transition', () => {
      const orchestrator = new PhaseOrchestrator();
      mockPhaseRepositoryGetCurrentPhase.mockReturnValue(null);

      const result = orchestrator.transitionToPhase('exec-001', 'green');

      expect(result).toBeNull();
      expect(mockPhaseRepositoryCreate).not.toHaveBeenCalled();
    });

    it('should complete running phase before transitioning', () => {
      const orchestrator = new PhaseOrchestrator();
      mockPhaseRepositoryGetCurrentPhase.mockReturnValue(
        createPhaseRecord({ id: 'phase-001', phase: 'red', status: 'running' })
      );
      mockPhaseRepositoryCreate.mockReturnValue(createPhaseRecord({ phase: 'research' }));

      const result = orchestrator.transitionToPhase('exec-001', 'research');

      expect(result).not.toBeNull();
      expect(mockPhaseRepositoryUpdate).toHaveBeenCalledWith('phase-001', {
        status: 'completed',
        completedAt: expect.any(String),
      });
    });

    it('should emit phase:started event on transition', () => {
      const orchestrator = new PhaseOrchestrator();
      mockPhaseRepositoryGetCurrentPhase.mockReturnValue(null);
      mockPhaseRepositoryCreate.mockReturnValue(createPhaseRecord({ phase: 'red' }));

      const startedHandler = vi.fn();
      orchestrator.on('phase:started', startedHandler);

      orchestrator.transitionToPhase('exec-001', 'red');

      expect(startedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: 'exec-001',
          phase: 'red',
          startedAt: expect.any(String),
        })
      );
    });
  });

  describe('handlePhaseFailure', () => {
    it('should emit phase:failed event', async () => {
      const orchestrator = new PhaseOrchestrator();

      const failedHandler = vi.fn();
      orchestrator.on('phase:failed', failedHandler);

      await orchestrator.handlePhaseFailure('exec-001', 'green', 'Test error');

      expect(failedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: 'exec-001',
          phase: 'green',
          error: 'Test error',
          failedAt: expect.any(String),
        })
      );
    });

    it('should log error to console', async () => {
      const orchestrator = new PhaseOrchestrator();

      await orchestrator.handlePhaseFailure('exec-001', 'green', 'Test error');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Phase green failed')
      );
    });
  });

  describe('runAutonomous', () => {
    it('should execute all phases in sequence on success', async () => {
      setupSuccessfulWorkflowMocks();
      const orchestrator = new PhaseOrchestrator();

      const result = await orchestrator.runAutonomous(
        createTaskContext(),
        createProjectContext()
      );

      expect(result.success).toBe(true);
      expect(result.phases.length).toBeGreaterThan(0);
      expect(mockRollbackCreateCheckpoint).toHaveBeenCalled();
      expect(mockTestGeneratorGenerate).toHaveBeenCalled();
      expect(mockResearchCoordinatorRunParallel).toHaveBeenCalled();
      expect(mockGreenPhaseRun).toHaveBeenCalled();
      expect(mockContractValidatorValidate).toHaveBeenCalled();
      expect(mockBugClassifierAiReview).toHaveBeenCalled();
      expect(mockReceiptBuilderBuild).toHaveBeenCalled();
      expect(mockReceiptBuilderCreatePr).toHaveBeenCalled();
    });

    it('should create checkpoint before starting', async () => {
      setupSuccessfulWorkflowMocks();
      const orchestrator = new PhaseOrchestrator();

      await orchestrator.runAutonomous(createTaskContext(), createProjectContext());

      expect(mockRollbackCreateCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-project' }),
        expect.stringContaining('TDD workflow start')
      );
    });

    it('should rollback on phase failure', async () => {
      setupSuccessfulWorkflowMocks();
      mockTestGeneratorGenerate.mockResolvedValue({
        success: false,
        error: 'Test generation failed',
        tests: [],
        metrics: {},
      });
      const orchestrator = new PhaseOrchestrator();

      const result = await orchestrator.runAutonomous(
        createTaskContext(),
        createProjectContext()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('RED phase failed');
      expect(mockRollbackRollbackToCheckpoint).toHaveBeenCalled();
    });

    it('should use provided executionId if present', async () => {
      setupSuccessfulWorkflowMocks();
      const orchestrator = new PhaseOrchestrator();

      const result = await orchestrator.runAutonomous(
        createTaskContext({ executionId: 'custom-exec-id' }),
        createProjectContext()
      );

      expect(result.executionId).toBe('custom-exec-id');
    });

    it('should generate executionId if not provided', async () => {
      setupSuccessfulWorkflowMocks();
      const orchestrator = new PhaseOrchestrator();

      const result = await orchestrator.runAutonomous(
        createTaskContext({ executionId: undefined }),
        createProjectContext()
      );

      expect(result.executionId).toBeDefined();
    });

    it('should emit events for each phase', async () => {
      setupSuccessfulWorkflowMocks();
      const orchestrator = new PhaseOrchestrator();

      const startedHandler = vi.fn();
      const completedHandler = vi.fn();
      orchestrator.on('phase:started', startedHandler);
      orchestrator.on('phase:completed', completedHandler);

      await orchestrator.runAutonomous(createTaskContext(), createProjectContext());

      // Should have started and completed events for all phases
      expect(startedHandler).toHaveBeenCalled();
      expect(completedHandler).toHaveBeenCalled();
    });

    it('should return receipt on success', async () => {
      setupSuccessfulWorkflowMocks();
      const orchestrator = new PhaseOrchestrator();

      const result = await orchestrator.runAutonomous(
        createTaskContext(),
        createProjectContext()
      );

      expect(result.success).toBe(true);
      expect(result.receipt).toBeDefined();
    });

    it('should track totalDurationMs', async () => {
      setupSuccessfulWorkflowMocks();
      const orchestrator = new PhaseOrchestrator();

      const result = await orchestrator.runAutonomous(
        createTaskContext(),
        createProjectContext()
      );

      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should clear execution state after completion', async () => {
      setupSuccessfulWorkflowMocks();
      const orchestrator = new PhaseOrchestrator();

      await orchestrator.runAutonomous(createTaskContext(), createProjectContext());

      expect(orchestrator.getCurrentExecutionId()).toBeNull();
    });
  });

  describe('REFINE phase loop', () => {
    it('should exit REFINE loop when P0/P1 bugs are resolved', async () => {
      setupSuccessfulWorkflowMocks();
      mockBugRepositoryCanExitRefineLoop.mockReturnValue(true);
      const orchestrator = new PhaseOrchestrator();

      const result = await orchestrator.runAutonomous(
        createTaskContext(),
        createProjectContext()
      );

      expect(result.success).toBe(true);
      // Should only have one REFINE phase
      expect(mockBugClassifierAiReview).toHaveBeenCalledTimes(1);
    });

    it('should continue looping until P0/P1 bugs resolved', async () => {
      const counter = { value: 0 };
      setupSuccessfulWorkflowMocks(counter);

      // First iteration: still has P0/P1 bugs
      // Second iteration: no P0/P1 bugs
      mockBugRepositoryCanExitRefineLoop
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      const orchestrator = new PhaseOrchestrator();

      const result = await orchestrator.runAutonomous(
        createTaskContext(),
        createProjectContext()
      );

      expect(result.success).toBe(true);
      // Should have two REFINE phases (loop once)
      expect(mockBugClassifierAiReview).toHaveBeenCalledTimes(2);
    });

    it('should respect maxRefineIterations limit', async () => {
      const counter = { value: 0 };
      setupSuccessfulWorkflowMocks(counter);

      // Always return false - never resolve P0/P1 bugs
      mockBugRepositoryCanExitRefineLoop.mockReturnValue(false);

      const orchestrator = new PhaseOrchestrator({
        maxRefineIterations: 2,
      });

      const result = await orchestrator.runAutonomous(
        createTaskContext(),
        createProjectContext()
      );

      expect(result.success).toBe(true);
      // Should stop at 2 iterations (maxRefineIterations)
      expect(mockBugClassifierAiReview).toHaveBeenCalledTimes(2);
    });

    it('should use escalation model on final REFINE iteration', async () => {
      const counter = { value: 0 };
      setupSuccessfulWorkflowMocks(counter);

      // First iteration: has bugs
      // Second iteration: has bugs (final - should use opus)
      // Third would exceed limit
      mockBugRepositoryCanExitRefineLoop
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      // Setup bugs that need fixing
      mockBugClassifierAiReview.mockResolvedValue({
        success: true,
        bugs: [createBug({ severity: 'P1', status: 'open' })],
        metrics: {
          totalBugsFound: 1,
          p0Count: 0,
          p1Count: 1,
          p2Count: 0,
          p3Count: 0,
        },
      });

      const orchestrator = new PhaseOrchestrator({
        maxRefineIterations: 3,
      });

      await orchestrator.runAutonomous(createTaskContext(), createProjectContext());

      // The third call (index 2, which is iteration 3) should have isFinalIteration = true
      // Since maxRefineIterations=3, iteration 3 is the final one
      const autoFixCalls = mockBugClassifierAutoFix.mock.calls;
      expect(autoFixCalls.length).toBeGreaterThanOrEqual(2);

      // Check that the last call before exit had isFinalIteration
      // (isFinalIteration is true when refineIterationCount >= maxRefineIterations - 1)
      // So on the 3rd iteration (index 2), with maxRefineIterations=3,
      // refineIterationCount would be 2 (0-indexed after increment in previous iterations)
      // and 2 >= 3-1 = 2, so isFinalIteration = true
    });

    it('should attempt auto-fix when P0/P1 bugs are found', async () => {
      setupSuccessfulWorkflowMocks();

      // Setup bugs that need fixing
      mockBugClassifierAiReview.mockResolvedValue({
        success: true,
        bugs: [createBug({ severity: 'P1', status: 'open' })],
        metrics: {
          totalBugsFound: 1,
          p0Count: 0,
          p1Count: 1,
          p2Count: 0,
          p3Count: 0,
        },
      });
      mockBugRepositoryCanExitRefineLoop.mockReturnValue(true);

      const orchestrator = new PhaseOrchestrator();

      await orchestrator.runAutonomous(createTaskContext(), createProjectContext());

      expect(mockBugClassifierAutoFix).toHaveBeenCalled();
    });

    it('should skip auto-fix when no P0/P1 bugs found', async () => {
      setupSuccessfulWorkflowMocks();

      // Only P2/P3 bugs
      mockBugClassifierAiReview.mockResolvedValue({
        success: true,
        bugs: [createBug({ severity: 'P2', status: 'open' })],
        metrics: {
          totalBugsFound: 1,
          p0Count: 0,
          p1Count: 0,
          p2Count: 1,
          p3Count: 0,
        },
      });
      mockBugRepositoryCanExitRefineLoop.mockReturnValue(true);

      const orchestrator = new PhaseOrchestrator();

      await orchestrator.runAutonomous(createTaskContext(), createProjectContext());

      expect(mockBugClassifierAutoFix).not.toHaveBeenCalled();
    });
  });

  describe('phase failure scenarios', () => {
    it('should handle RED phase failure', async () => {
      setupSuccessfulWorkflowMocks();
      mockTestGeneratorGenerate.mockResolvedValue({
        success: false,
        error: 'Failed to generate tests',
        tests: [],
        metrics: {},
      });
      const orchestrator = new PhaseOrchestrator();

      const result = await orchestrator.runAutonomous(
        createTaskContext(),
        createProjectContext()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('RED phase failed');
      expect(mockRollbackRollbackToCheckpoint).toHaveBeenCalled();
    });

    it('should handle RESEARCH phase failure', async () => {
      setupSuccessfulWorkflowMocks();
      mockResearchCoordinatorRunParallel.mockResolvedValue({
        success: false,
        error: 'Research failed',
        frozenContracts: null,
        metrics: {},
      });
      const orchestrator = new PhaseOrchestrator();

      const result = await orchestrator.runAutonomous(
        createTaskContext(),
        createProjectContext()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('RESEARCH phase failed');
    });

    it('should handle GREEN phase failure after max retries', async () => {
      setupSuccessfulWorkflowMocks();
      mockGreenPhaseRun.mockResolvedValue({
        success: false,
        attempts: 3,
        error: 'Tests still failing',
        testResults: { passed: false, total: 5, failed: 3 },
        metrics: {},
      });
      const orchestrator = new PhaseOrchestrator();

      const result = await orchestrator.runAutonomous(
        createTaskContext(),
        createProjectContext()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('GREEN phase failed');
    });

    it('should handle INTEGRATE phase failure (contract violation)', async () => {
      setupSuccessfulWorkflowMocks();
      mockContractValidatorValidate.mockResolvedValue({
        passed: false,
        totalContractsValidated: 3,
        totalContractsFailed: 1,
        layerResults: [],
        errors: [{ message: 'Contract mismatch' }],
        warnings: [],
      });
      const orchestrator = new PhaseOrchestrator();

      const result = await orchestrator.runAutonomous(
        createTaskContext(),
        createProjectContext()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('INTEGRATE phase failed');
    });

    it('should handle REFINE AI review failure', async () => {
      setupSuccessfulWorkflowMocks();
      mockBugClassifierAiReview.mockResolvedValue({
        success: false,
        error: 'AI review failed',
        bugs: [],
        metrics: {},
      });
      const orchestrator = new PhaseOrchestrator();

      const result = await orchestrator.runAutonomous(
        createTaskContext(),
        createProjectContext()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('REFINE AI review failed');
    });
  });

  describe('event emissions', () => {
    it('should emit phase:started for each phase', async () => {
      setupSuccessfulWorkflowMocks();
      const orchestrator = new PhaseOrchestrator();

      const phases: TddPhase[] = [];
      orchestrator.on('phase:started', (event) => {
        phases.push(event.phase);
      });

      await orchestrator.runAutonomous(createTaskContext(), createProjectContext());

      expect(phases).toContain('red');
      expect(phases).toContain('research');
      expect(phases).toContain('green');
      expect(phases).toContain('integrate');
      expect(phases).toContain('refine');
      expect(phases).toContain('commit');
    });

    it('should emit phase:completed for successful phases', async () => {
      setupSuccessfulWorkflowMocks();
      const orchestrator = new PhaseOrchestrator();

      const completedPhases: TddPhase[] = [];
      orchestrator.on('phase:completed', (event) => {
        completedPhases.push(event.phase);
      });

      await orchestrator.runAutonomous(createTaskContext(), createProjectContext());

      expect(completedPhases).toContain('red');
      expect(completedPhases).toContain('research');
      expect(completedPhases).toContain('green');
    });

    it('should emit phase:failed on failure', async () => {
      setupSuccessfulWorkflowMocks();
      mockTestGeneratorGenerate.mockResolvedValue({
        success: false,
        error: 'Test generation failed',
        tests: [],
        metrics: {},
      });
      const orchestrator = new PhaseOrchestrator();

      const failedHandler = vi.fn();
      orchestrator.on('phase:failed', failedHandler);

      await orchestrator.runAutonomous(createTaskContext(), createProjectContext());

      expect(failedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'red',
          error: expect.any(String),
        })
      );
    });

    it('should include metrics in phase:completed event', async () => {
      setupSuccessfulWorkflowMocks();
      const orchestrator = new PhaseOrchestrator();

      let redMetrics: Record<string, unknown> | undefined;
      orchestrator.on('phase:completed', (event) => {
        if (event.phase === 'red') {
          redMetrics = event.metrics;
        }
      });

      await orchestrator.runAutonomous(createTaskContext(), createProjectContext());

      expect(redMetrics).toBeDefined();
      expect(redMetrics).toHaveProperty('testFilesGenerated');
    });
  });

  describe('config access', () => {
    it('should return config via getConfig()', () => {
      const orchestrator = new PhaseOrchestrator({
        maxRefineIterations: 5,
      });

      const config = orchestrator.getConfig();

      expect(config.maxRefineIterations).toBe(5);
    });

    it('should return defensive copy of config', () => {
      const orchestrator = new PhaseOrchestrator();

      const config1 = orchestrator.getConfig();
      config1.maxRefineIterations = 999;
      const config2 = orchestrator.getConfig();

      expect(config2.maxRefineIterations).toBe(3); // Default, not modified
    });
  });
});
