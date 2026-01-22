# PRD: Enhanced TDD + Codex Refinement Workflow

## Introduction

Implement a **fully autonomous** 6-phase feature implementation workflow for MetaRalph that produces production-ready code with P0/P1 bugs = 0 in ~65 min/feature. The workflow runs end-to-end without human approval gates, outputting a production-ready PR as the only human touchpoint.

**Target Workflow:**
```
RED (7m) → RESEARCH (5m, parallel) → GREEN (15m) → INTEGRATE (7m) → REFINE (30m) → COMMIT (3m)
                                                                      ↺ until P0/P1 = 0
```

This integrates with the existing `metaralph self-improve` command, adding TDD mode as an option.

## Goals

- Implement all 6 phases of the TDD workflow (RED, RESEARCH, GREEN, INTEGRATE, REFINE, COMMIT)
- Run fully autonomously with zero human approval gates during execution
- Use Claude API with Promise.all for parallel research agents (5× speedup)
- Escalate to more capable model on final REFINE attempt if P0/P1 bugs persist
- Integrate with existing `metaralph self-improve --tdd` command
- Generate comprehensive PR receipts documenting test coverage, bug resolution, and review proof
- Auto-rollback on unrecoverable failures

## User Stories

---

### US-001: Create TDD type definitions
**Description:** As a developer, I need TypeScript types for the TDD workflow so all modules share consistent interfaces.

**Acceptance Criteria:**
- [ ] Create `src/tdd/types.ts` with all type definitions
- [ ] Define `TddPhase` type: 'red' | 'research' | 'green' | 'integrate' | 'refine' | 'commit'
- [ ] Define `PhaseStatus` type: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
- [ ] Define `BugSeverity` type: 'P0' | 'P1' | 'P2' | 'P3'
- [ ] Define `ResearchAgentType`: 'patterns' | 'contracts' | 'testing' | 'security' | 'performance'
- [ ] Define interfaces: TddPhaseRecord, GeneratedTest, ResearchAgent, ResearchFindings, Bug, PrReceipt
- [ ] Define AutonomousTddConfig interface with maxRefineIterations, maxGreenRetries, timeouts
- [ ] Define PHASE_TIME_TARGETS constant with default durations per phase
- [ ] Export all types from `src/tdd/index.ts`
- [ ] Typecheck passes

---

### US-002: Add TDD database schema
**Description:** As a developer, I need database tables to persist TDD execution state so workflows can recover from interruptions.

**Acceptance Criteria:**
- [ ] Add `tdd_phases` table (id, execution_id, phase, status, started_at, completed_at, metrics, created_at)
- [ ] Add `generated_tests` table (id, phase_id, test_type, file_path, test_content, status, created_at)
- [ ] Add `research_agents` table (id, phase_id, agent_type, status, findings, started_at, completed_at)
- [ ] Add `contracts` table (id, execution_id, layer, contract_type, definition, frozen_at)
- [ ] Add `bugs` table (id, phase_id, severity, category, description, file_path, line_number, status, fixed_at)
- [ ] Add `pr_receipts` table (id, execution_id, test_receipt, integration_receipt, review_receipt, pr_url)
- [ ] Add foreign key constraints to executions table
- [ ] Add indexes on execution_id and phase_id columns
- [ ] Migration runs successfully on existing database
- [ ] Typecheck passes

---

### US-003: Create TDD phase repository
**Description:** As a developer, I need CRUD operations for TDD phases so the orchestrator can track phase state.

**Acceptance Criteria:**
- [ ] Create `src/tdd/repositories/phase-repository.ts`
- [ ] Implement `create(input)` - creates new phase record
- [ ] Implement `update(id, input)` - updates phase status and metrics
- [ ] Implement `findById(id)` - retrieves phase by ID
- [ ] Implement `findByExecution(executionId)` - retrieves all phases for execution
- [ ] Implement `getCurrentPhase(executionId)` - returns running or latest phase
- [ ] Implement `getPhaseHistory(executionId)` - returns ordered phase list
- [ ] All methods accept optional db parameter for testing
- [ ] Typecheck passes

---

### US-004: Create generated tests repository
**Description:** As a developer, I need CRUD operations for generated tests so the RED phase can store test artifacts.

**Acceptance Criteria:**
- [ ] Create `src/tdd/repositories/test-repository.ts`
- [ ] Implement `create(input)` - creates test record
- [ ] Implement `update(id, input)` - updates test status (failing/passing)
- [ ] Implement `findByPhase(phaseId)` - retrieves all tests for a phase
- [ ] Implement `findByType(phaseId, testType)` - filter by unit/integration/e2e
- [ ] Implement `countByStatus(phaseId)` - returns counts by status
- [ ] Typecheck passes

---

### US-005: Create research agents repository
**Description:** As a developer, I need CRUD operations for research agents so parallel research can be tracked.

**Acceptance Criteria:**
- [ ] Create `src/tdd/repositories/agent-repository.ts`
- [ ] Implement `create(input)` - creates agent record
- [ ] Implement `update(id, input)` - updates status and findings
- [ ] Implement `findByPhase(phaseId)` - retrieves all agents for a phase
- [ ] Implement `findByType(phaseId, agentType)` - retrieves specific agent
- [ ] Implement `allCompleted(phaseId)` - checks if all agents finished
- [ ] Typecheck passes

---

### US-006: Create bugs repository
**Description:** As a developer, I need CRUD operations for bugs so the REFINE phase can track bug resolution.

**Acceptance Criteria:**
- [ ] Create `src/tdd/repositories/bug-repository.ts`
- [ ] Implement `create(input)` - creates bug record
- [ ] Implement `update(id, input)` - updates bug status
- [ ] Implement `findByPhase(phaseId)` - retrieves all bugs for a phase
- [ ] Implement `findBySeverity(phaseId, severity)` - filter by P0/P1/P2/P3
- [ ] Implement `findOpen(phaseId)` - retrieves unresolved bugs
- [ ] Implement `countOpenByPriority(phaseId)` - returns {p0: n, p1: n, p2: n, p3: n}
- [ ] Implement `canExitRefineLoop(phaseId)` - returns true when P0=0 AND P1=0
- [ ] Typecheck passes

---

### US-007: Create PR receipts repository
**Description:** As a developer, I need CRUD operations for PR receipts so the COMMIT phase can store documentation.

**Acceptance Criteria:**
- [ ] Create `src/tdd/repositories/receipt-repository.ts`
- [ ] Implement `create(input)` - creates receipt record
- [ ] Implement `update(id, input)` - updates receipt with PR URL
- [ ] Implement `findByExecution(executionId)` - retrieves receipt for execution
- [ ] Typecheck passes

---

### US-008: Create Phase Orchestrator skeleton
**Description:** As a developer, I need the core orchestrator that manages autonomous phase transitions.

**Acceptance Criteria:**
- [ ] Create `src/tdd/phase-orchestrator.ts`
- [ ] Implement `PhaseOrchestrator` class with constructor accepting config
- [ ] Implement `runAutonomous(task, project)` method signature (stub implementation)
- [ ] Implement `transitionToPhase(executionId, phase)` - validates and transitions
- [ ] Implement `canTransition(executionId, targetPhase)` - checks valid transitions
- [ ] Implement `handlePhaseFailure(executionId, phase, error)` - triggers rollback
- [ ] Define phase transition rules: red→research→green→integrate→refine→commit
- [ ] Allow refine to loop back to itself (up to maxRefineIterations)
- [ ] Emit events: 'phase:started', 'phase:completed', 'phase:failed'
- [ ] Typecheck passes

---

### US-009: Extend Execution model for TDD
**Description:** As a developer, I need the Execution model to track TDD phase state.

**Acceptance Criteria:**
- [ ] Add `currentPhase` field to Execution interface (TddPhase | null)
- [ ] Add `phaseHistory` field to Execution interface (TddPhaseRecord[] | null)
- [ ] Add `tddEnabled` field to Execution interface (boolean)
- [ ] Add `tddConfig` field to Execution interface (AutonomousTddConfig | null)
- [ ] Update ExecutionRepository.create() to accept new fields
- [ ] Add ExecutionRepository.updateCurrentPhase(id, phase)
- [ ] Add ExecutionRepository.appendPhaseHistory(id, record)
- [ ] Update database schema with new columns
- [ ] Typecheck passes

---

### US-010: Implement RED phase - Test Generator
**Description:** As a developer, I need the RED phase to generate failing tests from PRD acceptance criteria.

**Acceptance Criteria:**
- [ ] Create `src/tdd/test-generator.ts`
- [ ] Implement `TestGenerator.generate(task, project)` - main entry point
- [ ] Implement `extractTestableRequirements(prdJson)` - parse PRD for test cases
- [ ] Implement `generateUnitTests(requirements, projectContext)` - create unit test stubs
- [ ] Implement `generateIntegrationTests(requirements)` - create integration test stubs
- [ ] Implement `generateE2eTests(userStories)` - create E2E test scenarios
- [ ] Use Claude API to generate meaningful test assertions
- [ ] Detect project test framework (vitest/jest) and generate appropriate syntax
- [ ] Write test files to appropriate locations (co-located or __tests__)
- [ ] Implement `verifyTestsFailing(testFiles)` - run tests and confirm they fail
- [ ] Store generated tests in database via test-repository
- [ ] Return list of GeneratedTest records
- [ ] Typecheck passes

---

### US-011: Implement RESEARCH phase - Research Coordinator
**Description:** As a developer, I need the RESEARCH phase to spawn parallel AI agents for codebase analysis.

**Acceptance Criteria:**
- [ ] Create `src/tdd/research-coordinator.ts`
- [ ] Implement `ResearchCoordinator.runParallel(agentTypes, context)` - spawns all agents
- [ ] Use Promise.all to run 5 agents concurrently via Claude API
- [ ] Implement `createPatternsAgent(context)` - researches code patterns in project
- [ ] Implement `createContractsAgent(context)` - researches API contracts/interfaces
- [ ] Implement `createTestingAgent(context)` - researches testing strategies
- [ ] Implement `createSecurityAgent(context)` - researches security concerns
- [ ] Implement `createPerformanceAgent(context)` - researches performance patterns
- [ ] Each agent receives: task PRD, project structure, relevant file contents
- [ ] Implement `synthesizeFindings(agentResults)` - combine agent outputs
- [ ] Return frozenContracts object with synthesized implementation guidance
- [ ] Store agent records and findings in database
- [ ] Handle individual agent failures gracefully (continue with partial results)
- [ ] Typecheck passes

---

### US-012: Implement GREEN phase - Ralph Integration
**Description:** As a developer, I need the GREEN phase to run Ralph with frozen contracts until tests pass.

**Acceptance Criteria:**
- [ ] Create `src/tdd/green-phase.ts`
- [ ] Implement `GreenPhase.run(task, project, frozenContracts, config)` - main entry
- [ ] Generate enhanced PRD JSON including: original requirements + frozen contracts + test specs
- [ ] Call RalphSpawner.spawn() with enhanced PRD
- [ ] After Ralph completes, run test suite to check if tests pass
- [ ] If tests fail and attempts < maxGreenRetries, regenerate PRD with error context and retry
- [ ] Track attempt count and test results in phase metrics
- [ ] Return success/failure with implementation details
- [ ] Typecheck passes

---

### US-013: Implement INTEGRATE phase - Contract Validator
**Description:** As a developer, I need the INTEGRATE phase to validate contracts across all layers.

**Acceptance Criteria:**
- [ ] Create `src/tdd/contract-validator.ts`
- [ ] Implement `ContractValidator.validate(frozenContracts, project)` - main entry
- [ ] Implement `extractImplementedContracts(project)` - parse contracts from code
- [ ] Implement `validateUIContract(uiCode, apiContract)` - check frontend matches API
- [ ] Implement `validateAPIContract(apiCode, dbSchema)` - check API matches DB
- [ ] Implement `checkErrorBoundaries(project)` - verify error handling exists
- [ ] Use Claude API to analyze contract compatibility
- [ ] Store validation results in contracts table
- [ ] Return validation report with pass/fail status and errors
- [ ] Typecheck passes

---

### US-014: Implement REFINE phase - Bug Classifier
**Description:** As a developer, I need the REFINE phase to find and classify bugs by severity.

**Acceptance Criteria:**
- [ ] Create `src/tdd/bug-classifier.ts`
- [ ] Implement `BugClassifier.aiReview(project, codeChanges)` - AI code review
- [ ] Use Claude API to analyze code for bugs with severity classification
- [ ] Classify bugs as P0 (critical), P1 (high), P2 (medium), P3 (low)
- [ ] Classify bug categories: logic, security, performance, style, compatibility
- [ ] Implement `parseBugsFromReview(reviewOutput)` - extract structured bugs
- [ ] Store bugs in database via bug-repository
- [ ] Return list of Bug records
- [ ] Typecheck passes

---

### US-015: Implement REFINE phase - Auto Fix Loop
**Description:** As a developer, I need the REFINE phase to automatically fix P0/P1 bugs until resolved.

**Acceptance Criteria:**
- [ ] Add `BugClassifier.autoFix(bugs, project)` method
- [ ] For each P0/P1 bug, generate fix using Claude API with bug context
- [ ] Apply fixes to code files
- [ ] Run tests after each fix to verify no regressions
- [ ] Update bug status to 'fixed' or 'wontfix' based on result
- [ ] Implement escalation: on final iteration, use claude-opus-4-20250514 model for harder bugs
- [ ] Track fix attempts and success rate in phase metrics
- [ ] Return updated bug list
- [ ] Typecheck passes

---

### US-016: Implement COMMIT phase - Receipt Builder
**Description:** As a developer, I need the COMMIT phase to generate comprehensive PR receipts.

**Acceptance Criteria:**
- [ ] Create `src/tdd/receipt-builder.ts`
- [ ] Implement `ReceiptBuilder.build(executionId)` - main entry
- [ ] Implement `buildTestReceipt(executionId)` - compile test results
- [ ] Include: total tests, passed, failed, skipped, coverage percentage
- [ ] Implement `buildIntegrationReceipt(executionId)` - compile contract validation
- [ ] Include: contracts validated, contracts failed, layers checked
- [ ] Implement `buildReviewReceipt(executionId)` - compile bug resolution
- [ ] Include: total bugs found, P0/P1 counts, bugs fixed, iterations required
- [ ] Implement `generatePrBody(receipts)` - format markdown PR description
- [ ] Store receipt in database via receipt-repository
- [ ] Return complete PrReceipt
- [ ] Typecheck passes

---

### US-017: Implement COMMIT phase - PR Creation
**Description:** As a developer, I need the COMMIT phase to create a GitHub PR with receipts.

**Acceptance Criteria:**
- [ ] Add `ReceiptBuilder.createPr(task, receipt, project)` method
- [ ] Generate PR title from task title
- [ ] Generate PR body using receipt markdown template
- [ ] Include sections: Summary, Test Coverage, Contract Validation, AI Review, Receipts
- [ ] Use `gh pr create` command to create PR
- [ ] Store PR URL in receipt record
- [ ] Return PR URL
- [ ] Typecheck passes

---

### US-018: Wire up Phase Orchestrator with all phases
**Description:** As a developer, I need the orchestrator to execute all phases in sequence.

**Acceptance Criteria:**
- [ ] Update `PhaseOrchestrator.runAutonomous()` to call all phases
- [ ] Create checkpoint before starting (Rollback.createCheckpoint)
- [ ] Execute RED phase, transition on success
- [ ] Execute RESEARCH phase, transition on success
- [ ] Execute GREEN phase with retry loop, transition on success
- [ ] Execute INTEGRATE phase, transition on success
- [ ] Execute REFINE phase with bug fix loop until P0/P1=0 or max iterations
- [ ] On final REFINE iteration, escalate to opus model
- [ ] Execute COMMIT phase, create PR
- [ ] On any unrecoverable failure, rollback to checkpoint
- [ ] Return TddResult with success status, PR URL, and receipt
- [ ] Typecheck passes

---

### US-019: Add TDD mode to self-improve command
**Description:** As a user, I want to run TDD workflow via `metaralph self-improve --tdd`.

**Acceptance Criteria:**
- [ ] Add `--tdd` flag to self-improve command in `src/cli/index.ts`
- [ ] Add `--max-refine <n>` option (default: 3)
- [ ] Add `--max-green-retries <n>` option (default: 2)
- [ ] When --tdd flag set, use PhaseOrchestrator.runAutonomous() instead of standard execution
- [ ] Display phase progress in real-time (phase name, status, duration)
- [ ] On completion, display PR URL and receipt summary
- [ ] On failure, display detailed failure report
- [ ] Typecheck passes

---

### US-020: Add tdd-status CLI command
**Description:** As a user, I want to view TDD execution progress via `metaralph tdd-status`.

**Acceptance Criteria:**
- [ ] Add `tdd-status <execution>` command to CLI
- [ ] Display current phase and status
- [ ] Display phase history with durations
- [ ] Display phase metrics (tests generated, bugs found, etc.)
- [ ] Show elapsed time and estimated remaining
- [ ] Typecheck passes

---

### US-021: Add tdd-bugs CLI command
**Description:** As a user, I want to view bugs found during refinement via `metaralph tdd-bugs`.

**Acceptance Criteria:**
- [ ] Add `tdd-bugs <execution>` command to CLI
- [ ] Add `--severity <P0|P1|P2|P3>` filter option
- [ ] Display bugs in table format: severity, category, status, description, file
- [ ] Show counts by severity
- [ ] Typecheck passes

---

### US-022: Add tdd-receipt CLI command
**Description:** As a user, I want to view PR receipts via `metaralph tdd-receipt`.

**Acceptance Criteria:**
- [ ] Add `tdd-receipt <execution>` command to CLI
- [ ] Display test receipt: total, passed, failed, coverage
- [ ] Display integration receipt: contracts validated, status
- [ ] Display review receipt: bugs found, fixed, iterations
- [ ] Display PR URL if created
- [ ] Typecheck passes

---

### US-023: Add tests for Phase Orchestrator
**Description:** As a developer, I need tests for the Phase Orchestrator to ensure reliable execution.

**Acceptance Criteria:**
- [ ] Create `src/tdd/phase-orchestrator.test.ts`
- [ ] Test phase transition rules (valid and invalid)
- [ ] Test rollback on phase failure
- [ ] Test max iterations limit on REFINE phase
- [ ] Test escalation to opus on final REFINE iteration
- [ ] Mock all phase implementations for unit testing
- [ ] All tests pass
- [ ] Typecheck passes

---

### US-024: Add tests for Test Generator
**Description:** As a developer, I need tests for the Test Generator to ensure quality test generation.

**Acceptance Criteria:**
- [ ] Create `src/tdd/test-generator.test.ts`
- [ ] Test PRD parsing for testable requirements
- [ ] Test unit test generation with mocked Claude API
- [ ] Test integration test generation
- [ ] Test E2E test generation
- [ ] Test test framework detection (vitest vs jest)
- [ ] Test verifyTestsFailing behavior
- [ ] All tests pass
- [ ] Typecheck passes

---

### US-025: Add tests for Research Coordinator
**Description:** As a developer, I need tests for the Research Coordinator to ensure parallel execution works.

**Acceptance Criteria:**
- [ ] Create `src/tdd/research-coordinator.test.ts`
- [ ] Test parallel agent spawning with Promise.all
- [ ] Test individual agent failure handling (partial results)
- [ ] Test findings synthesis
- [ ] Test timeout handling
- [ ] Mock Claude API calls
- [ ] All tests pass
- [ ] Typecheck passes

---

### US-026: Add tests for Bug Classifier
**Description:** As a developer, I need tests for the Bug Classifier to ensure accurate severity classification.

**Acceptance Criteria:**
- [ ] Create `src/tdd/bug-classifier.test.ts`
- [ ] Test bug severity classification (P0-P3)
- [ ] Test bug category classification
- [ ] Test autoFix behavior
- [ ] Test canExitRefineLoop logic (P0=0 AND P1=0)
- [ ] Test escalation to opus model
- [ ] Mock Claude API calls
- [ ] All tests pass
- [ ] Typecheck passes

---

## Functional Requirements

- FR-1: System must execute 6 phases autonomously without human approval gates
- FR-2: RED phase must generate failing tests from PRD acceptance criteria before implementation
- FR-3: RESEARCH phase must spawn 5 parallel Claude API calls for concurrent research
- FR-4: GREEN phase must retry implementation up to maxGreenRetries times until tests pass
- FR-5: INTEGRATE phase must validate contracts across UI, API, and DB layers
- FR-6: REFINE phase must loop until P0=0 AND P1=0, or max iterations reached
- FR-7: REFINE phase must escalate to claude-opus-4-20250514 on final iteration for difficult bugs
- FR-8: COMMIT phase must create GitHub PR with comprehensive receipts
- FR-9: System must auto-rollback to checkpoint on unrecoverable failure
- FR-10: All phase state must persist to database for recovery
- FR-11: CLI must integrate with existing `metaralph self-improve --tdd` command

## Non-Goals

- No interactive approval prompts during execution
- No manual phase skipping during execution (only via CLI flags at start)
- No WebSocket/real-time streaming of phase output (CLI polling only)
- No support for non-TypeScript projects in initial implementation
- No support for monorepos with multiple test configurations
- No automated deployment after PR creation

## Technical Considerations

- Use existing Rollback system for checkpoint/rollback functionality
- Use existing RalphSpawner for GREEN phase implementation
- Use Anthropic SDK for Claude API calls (already configured)
- Use existing database patterns (better-sqlite3)
- Follow existing repository pattern for new data access
- Detect test framework from package.json (vitest or jest)
- Use `gh` CLI for GitHub PR creation (already available)

## Success Metrics

- Full 6-phase workflow completes autonomously without human intervention
- P0/P1 bugs = 0 on successful completion
- PR created with complete receipts documenting quality
- Average execution time ~65 minutes per feature
- Rollback successfully restores state on failure

## Open Questions

- Should we add WebSocket support for real-time phase streaming in dashboard?
- Should we support custom test frameworks beyond vitest/jest?
- Should we add phase timeout configuration per project?
