/**
 * Receipt Builder - COMMIT Phase Implementation
 *
 * Generates comprehensive PR receipts during the COMMIT phase.
 * This is the sixth and final phase of the 6-phase TDD workflow:
 * RED -> RESEARCH -> GREEN -> INTEGRATE -> REFINE -> COMMIT
 *
 * The COMMIT phase:
 * 1. Compiles test results from the workflow
 * 2. Compiles contract validation results
 * 3. Compiles bug resolution results
 * 4. Generates a formatted PR description with all receipts
 * 5. Stores the receipt in the database
 */

import { spawn } from 'node:child_process';
import { type DatabaseInstance, initDatabase } from '../db/index.js';
import {
  type PrReceipt,
  type TestReceipt,
  type IntegrationReceipt,
  type ReviewReceipt,
} from './types.js';
import {
  ReceiptRepository,
  PhaseRepository,
  TestRepository,
  BugRepository,
} from './repositories/index.js';

/**
 * Configuration for ReceiptBuilder
 */
export interface ReceiptBuilderConfig {
  /** Database instance (optional, created if not provided) */
  db?: DatabaseInstance;
}

/**
 * Test results summary with additional details
 */
export interface TestResultsSummary {
  /** Total number of tests */
  totalTests: number;
  /** Number of passing tests */
  passed: number;
  /** Number of failing tests */
  failed: number;
  /** Number of skipped tests */
  skipped: number;
  /** Code coverage percentage (0-100), if available */
  coveragePercent?: number;
  /** Duration in milliseconds, if available */
  durationMs?: number;
  /** Tests by type (unit, integration, e2e) */
  testsByType?: {
    unit: number;
    integration: number;
    e2e: number;
  };
}

/**
 * Contract validation summary with additional details
 */
export interface ContractValidationSummary {
  /** Total contracts validated */
  contractsValidated: number;
  /** Contracts that failed validation */
  contractsFailed: number;
  /** Layers that were checked */
  layersChecked: ('ui' | 'api' | 'db')[];
  /** Validation errors (descriptions) */
  errors?: string[];
  /** Warnings */
  warnings?: string[];
}

/**
 * Bug resolution summary with additional details
 */
export interface BugResolutionSummary {
  /** Total bugs found */
  totalBugsFound: number;
  /** P0 (critical) bug count */
  p0Count: number;
  /** P1 (high) bug count */
  p1Count: number;
  /** P2 (medium) bug count */
  p2Count: number;
  /** P3 (low) bug count */
  p3Count: number;
  /** Number of bugs fixed */
  bugsFixed: number;
  /** REFINE iterations performed */
  refineIterations: number;
  /** Whether opus model escalation was used */
  opusEscalationUsed: boolean;
  /** Bugs by category */
  bugsByCategory?: {
    logic: number;
    security: number;
    performance: number;
    style: number;
    compatibility: number;
  };
}

/**
 * Input for building a PR body
 */
export interface PrBodyInput {
  /** Task title or summary */
  taskTitle: string;
  /** Task description */
  taskDescription?: string;
  /** PR receipts */
  testReceipt: TestReceipt;
  integrationReceipt: IntegrationReceipt;
  reviewReceipt: ReviewReceipt;
  /** Additional context */
  additionalContext?: string;
}

/**
 * Task context for PR creation
 */
export interface PrTaskContext {
  /** Story ID (e.g., US-001) */
  storyId?: string;
  /** Task title */
  title: string;
  /** Task description */
  description?: string;
}

/**
 * Project context for PR creation
 */
export interface PrProjectContext {
  /** Project directory path */
  path: string;
  /** Base branch for PR (defaults to main/master) */
  baseBranch?: string;
}

/**
 * Result of PR creation
 */
export interface CreatePrResult {
  /** Whether PR creation succeeded */
  success: boolean;
  /** PR URL (if created) */
  prUrl?: string;
  /** Error message (if failed) */
  error?: string;
  /** PR title used */
  title: string;
}

/**
 * Receipt Builder - Generates comprehensive PR receipts for COMMIT phase
 */
export const ReceiptBuilder = {
  /**
   * Build comprehensive receipts for an execution
   *
   * Collects test results, contract validation, and bug resolution data
   * from the database and combines them into a complete PrReceipt.
   *
   * @param executionId - Execution ID to build receipts for
   * @param config - Optional configuration
   * @returns Complete PrReceipt
   */
  build(executionId: string, config?: ReceiptBuilderConfig): PrReceipt {
    const db = config?.db ?? initDatabase();
    const shouldClose = !config?.db;

    try {
      // Build individual receipts
      const testReceipt = this.buildTestReceipt(executionId, db);
      const integrationReceipt = this.buildIntegrationReceipt(executionId, db);
      const reviewReceipt = this.buildReviewReceipt(executionId, db);

      // Create and store the receipt
      const receipt = ReceiptRepository.create(
        {
          executionId,
          testReceipt,
          integrationReceipt,
          reviewReceipt,
        },
        db
      );

      return receipt;
    } finally {
      if (shouldClose) {
        db.close();
      }
    }
  },

  /**
   * Build test receipt from test results
   *
   * Compiles test results from the RED phase to summarize:
   * - Total tests, passed, failed, skipped
   * - Coverage percentage (if available)
   *
   * @param executionId - Execution ID
   * @param db - Optional database instance
   * @returns TestReceipt
   */
  buildTestReceipt(executionId: string, db?: DatabaseInstance): TestReceipt {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      // Find the RED phase for this execution
      const phases = PhaseRepository.findByExecution(executionId, database);
      const redPhase = phases.find((p) => p.phase === 'red');

      if (!redPhase) {
        // No RED phase found - return empty receipt
        return {
          totalTests: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
        };
      }

      // Get test counts from the phase
      const testCounts = TestRepository.countByStatus(redPhase.id, database);

      // Build receipt
      const receipt: TestReceipt = {
        totalTests: testCounts.total,
        passed: testCounts.passing,
        failed: testCounts.failing,
        skipped: testCounts.skipped,
      };

      // Add coverage from phase metrics if available
      const metrics = redPhase.metrics as Record<string, unknown> | undefined;
      if (metrics?.coveragePercent !== undefined) {
        receipt.coveragePercent = metrics.coveragePercent as number;
      }
      if (metrics?.durationMs !== undefined) {
        receipt.durationMs = metrics.durationMs as number;
      }

      return receipt;
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Build integration receipt from contract validation
   *
   * Compiles contract validation results from the INTEGRATE phase:
   * - Contracts validated/failed
   * - Layers checked
   * - Validation errors
   *
   * @param executionId - Execution ID
   * @param db - Optional database instance
   * @returns IntegrationReceipt
   */
  buildIntegrationReceipt(
    executionId: string,
    db?: DatabaseInstance
  ): IntegrationReceipt {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      // Find the INTEGRATE phase for this execution
      const phases = PhaseRepository.findByExecution(executionId, database);
      const integratePhase = phases.find((p) => p.phase === 'integrate');

      if (!integratePhase) {
        // No INTEGRATE phase found - return empty receipt
        return {
          contractsValidated: 0,
          contractsFailed: 0,
          layersChecked: [],
        };
      }

      // Get integration metrics from phase
      const metrics = integratePhase.metrics as Record<string, unknown> | undefined;

      const receipt: IntegrationReceipt = {
        contractsValidated: (metrics?.contractsValidated as number) ?? 0,
        contractsFailed: (metrics?.contractsFailed as number) ?? 0,
        layersChecked: (metrics?.layersChecked as ('ui' | 'api' | 'db')[]) ?? [],
      };

      // Add errors if available
      if (metrics?.errors && Array.isArray(metrics.errors)) {
        receipt.errors = metrics.errors as string[];
      }

      return receipt;
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Build review receipt from bug resolution
   *
   * Compiles bug detection and resolution results from the REFINE phase:
   * - Total bugs found by severity
   * - Bugs fixed
   * - REFINE iterations required
   * - Whether opus escalation was used
   *
   * @param executionId - Execution ID
   * @param db - Optional database instance
   * @returns ReviewReceipt
   */
  buildReviewReceipt(executionId: string, db?: DatabaseInstance): ReviewReceipt {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      // Find the REFINE phase(s) for this execution
      const phases = PhaseRepository.findByExecution(executionId, database);
      const refinePhases = phases.filter((p) => p.phase === 'refine');

      if (refinePhases.length === 0) {
        // No REFINE phase found - return empty receipt
        return {
          totalBugsFound: 0,
          p0Count: 0,
          p1Count: 0,
          p2Count: 0,
          p3Count: 0,
          bugsFixed: 0,
          refineIterations: 0,
          opusEscalationUsed: false,
        };
      }

      // Use the latest REFINE phase for bug data
      const latestRefinePhase = refinePhases[refinePhases.length - 1];

      // Get all bugs from all REFINE phases
      let totalBugsFound = 0;
      let p0Count = 0;
      let p1Count = 0;
      let p2Count = 0;
      let p3Count = 0;
      let bugsFixed = 0;

      for (const phase of refinePhases) {
        const bugs = BugRepository.findByPhase(phase.id, database);
        totalBugsFound += bugs.length;

        for (const bug of bugs) {
          switch (bug.severity) {
            case 'P0':
              p0Count++;
              break;
            case 'P1':
              p1Count++;
              break;
            case 'P2':
              p2Count++;
              break;
            case 'P3':
              p3Count++;
              break;
          }

          if (bug.status === 'fixed') {
            bugsFixed++;
          }
        }
      }

      // Get metrics from latest REFINE phase
      const metrics = latestRefinePhase.metrics as Record<string, unknown> | undefined;
      const opusEscalationUsed = (metrics?.opusEscalationUsed as boolean) ?? false;

      const receipt: ReviewReceipt = {
        totalBugsFound,
        p0Count,
        p1Count,
        p2Count,
        p3Count,
        bugsFixed,
        refineIterations: refinePhases.length,
        opusEscalationUsed,
      };

      return receipt;
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Generate markdown PR body from receipts
   *
   * Formats the receipts into a comprehensive PR description with:
   * - Summary section
   * - Test Coverage section
   * - Contract Validation section
   * - AI Review section
   * - Receipts section
   *
   * @param input - PR body input with receipts
   * @returns Formatted markdown PR body
   */
  generatePrBody(input: PrBodyInput): string {
    const { taskTitle, taskDescription, testReceipt, integrationReceipt, reviewReceipt } =
      input;

    const sections: string[] = [];

    // Summary section
    sections.push('## Summary');
    sections.push('');
    sections.push(`**Task:** ${taskTitle}`);
    if (taskDescription) {
      sections.push('');
      sections.push(taskDescription);
    }
    sections.push('');

    // Test Coverage section
    sections.push('## Test Coverage');
    sections.push('');
    sections.push('| Metric | Value |');
    sections.push('| ------ | ----- |');
    sections.push(`| Total Tests | ${testReceipt.totalTests} |`);
    sections.push(`| Passed | ${testReceipt.passed} |`);
    sections.push(`| Failed | ${testReceipt.failed} |`);
    sections.push(`| Skipped | ${testReceipt.skipped} |`);
    if (testReceipt.coveragePercent !== undefined) {
      sections.push(`| Coverage | ${testReceipt.coveragePercent.toFixed(1)}% |`);
    }
    if (testReceipt.durationMs !== undefined) {
      sections.push(`| Duration | ${(testReceipt.durationMs / 1000).toFixed(2)}s |`);
    }
    sections.push('');

    // Test status indicator
    const allTestsPass = testReceipt.failed === 0 && testReceipt.totalTests > 0;
    sections.push(allTestsPass ? '✅ All tests passing' : '⚠️ Some tests failing');
    sections.push('');

    // Contract Validation section
    sections.push('## Contract Validation');
    sections.push('');
    sections.push('| Metric | Value |');
    sections.push('| ------ | ----- |');
    sections.push(`| Contracts Validated | ${integrationReceipt.contractsValidated} |`);
    sections.push(`| Contracts Failed | ${integrationReceipt.contractsFailed} |`);
    if (integrationReceipt.layersChecked.length > 0) {
      sections.push(`| Layers Checked | ${integrationReceipt.layersChecked.join(', ')} |`);
    }
    sections.push('');

    // Contract status indicator
    const allContractsPass = integrationReceipt.contractsFailed === 0;
    sections.push(
      allContractsPass
        ? '✅ All contracts validated successfully'
        : '⚠️ Some contracts failed validation'
    );

    if (integrationReceipt.errors && integrationReceipt.errors.length > 0) {
      sections.push('');
      sections.push('**Validation Errors:**');
      for (const error of integrationReceipt.errors.slice(0, 5)) {
        sections.push(`- ${error}`);
      }
      if (integrationReceipt.errors.length > 5) {
        sections.push(`- ... and ${integrationReceipt.errors.length - 5} more`);
      }
    }
    sections.push('');

    // AI Review section
    sections.push('## AI Review');
    sections.push('');
    sections.push('| Severity | Count |');
    sections.push('| -------- | ----- |');
    sections.push(`| P0 (Critical) | ${reviewReceipt.p0Count} |`);
    sections.push(`| P1 (High) | ${reviewReceipt.p1Count} |`);
    sections.push(`| P2 (Medium) | ${reviewReceipt.p2Count} |`);
    sections.push(`| P3 (Low) | ${reviewReceipt.p3Count} |`);
    sections.push(`| **Total** | ${reviewReceipt.totalBugsFound} |`);
    sections.push('');
    sections.push(`**Bugs Fixed:** ${reviewReceipt.bugsFixed}/${reviewReceipt.totalBugsFound}`);
    sections.push(`**REFINE Iterations:** ${reviewReceipt.refineIterations}`);
    if (reviewReceipt.opusEscalationUsed) {
      sections.push('**Model Escalation:** Opus was used for difficult bugs');
    }
    sections.push('');

    // Bug status indicator
    const noCriticalBugs = reviewReceipt.p0Count === 0 && reviewReceipt.p1Count === 0;
    sections.push(
      noCriticalBugs
        ? '✅ No P0/P1 bugs remaining'
        : '⚠️ P0/P1 bugs need attention'
    );
    sections.push('');

    // Receipts section (compact summary)
    sections.push('## Receipts');
    sections.push('');
    sections.push('<details>');
    sections.push('<summary>Click to expand full receipt details</summary>');
    sections.push('');
    sections.push('### Test Receipt');
    sections.push('```json');
    sections.push(JSON.stringify(testReceipt, null, 2));
    sections.push('```');
    sections.push('');
    sections.push('### Integration Receipt');
    sections.push('```json');
    sections.push(JSON.stringify(integrationReceipt, null, 2));
    sections.push('```');
    sections.push('');
    sections.push('### Review Receipt');
    sections.push('```json');
    sections.push(JSON.stringify(reviewReceipt, null, 2));
    sections.push('```');
    sections.push('');
    sections.push('</details>');
    sections.push('');

    // Additional context
    if (input.additionalContext) {
      sections.push('---');
      sections.push('');
      sections.push(input.additionalContext);
      sections.push('');
    }

    // Footer
    sections.push('---');
    sections.push('');
    sections.push('🤖 Generated with [metaRalph](https://github.com/conductor/metaralph) TDD Workflow');

    return sections.join('\n');
  },

  /**
   * Get an existing receipt for an execution
   *
   * @param executionId - Execution ID
   * @param db - Optional database instance
   * @returns PrReceipt or null if not found
   */
  getReceipt(executionId: string, db?: DatabaseInstance): PrReceipt | null {
    return ReceiptRepository.findByExecution(executionId, db);
  },

  /**
   * Update an existing receipt with PR URL
   *
   * @param receiptId - Receipt ID to update
   * @param prUrl - PR URL
   * @param db - Optional database instance
   * @returns Updated receipt or null if not found
   */
  updateWithPrUrl(
    receiptId: string,
    prUrl: string,
    db?: DatabaseInstance
  ): PrReceipt | null {
    return ReceiptRepository.update(receiptId, { prUrl }, db);
  },

  /**
   * Create a GitHub PR with receipts
   *
   * Creates a pull request on GitHub using the `gh` CLI command.
   * The PR includes the full receipt documentation in the body.
   *
   * @param task - Task context (title, description, storyId)
   * @param receipt - The PR receipt with test, integration, and review results
   * @param project - Project context (path, baseBranch)
   * @param config - Optional configuration
   * @returns CreatePrResult with success status and PR URL
   */
  async createPr(
    task: PrTaskContext,
    receipt: PrReceipt,
    project: PrProjectContext,
    config?: ReceiptBuilderConfig
  ): Promise<CreatePrResult> {
    const db = config?.db ?? initDatabase();
    const shouldClose = !config?.db;

    try {
      // Generate PR title from task
      const title = this.generatePrTitle(task);

      // Generate PR body using receipts
      const body = this.generatePrBody({
        taskTitle: task.title,
        taskDescription: task.description,
        testReceipt: receipt.testReceipt,
        integrationReceipt: receipt.integrationReceipt,
        reviewReceipt: receipt.reviewReceipt,
      });

      // Determine base branch (defaults to main, falls back to master)
      const baseBranch = project.baseBranch ?? (await this.detectBaseBranch(project.path));

      // Create PR using gh CLI
      const prUrl = await this.runGhPrCreate(project.path, title, body, baseBranch);

      // Store PR URL in receipt
      ReceiptRepository.update(receipt.id, { prUrl }, db);

      return {
        success: true,
        prUrl,
        title,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
        title: this.generatePrTitle(task),
      };
    } finally {
      if (shouldClose) {
        db.close();
      }
    }
  },

  /**
   * Generate PR title from task context
   *
   * Format: [Story ID] Task Title (if story ID present)
   * Or just: Task Title
   *
   * @param task - Task context
   * @returns Formatted PR title
   */
  generatePrTitle(task: PrTaskContext): string {
    if (task.storyId) {
      return `[${task.storyId}] ${task.title}`;
    }
    return task.title;
  },

  /**
   * Detect the base branch (main or master) for the repository
   *
   * @param projectPath - Path to the project
   * @returns Base branch name
   */
  async detectBaseBranch(projectPath: string): Promise<string> {
    return new Promise((resolve) => {
      const git = spawn('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
        cwd: projectPath,
        shell: true,
      });

      let stdout = '';
      git.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      git.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          // Output is like "origin/main" - extract branch name
          const branch = stdout.trim().replace(/^origin\//, '');
          resolve(branch);
        } else {
          // Fallback: check if 'main' exists, otherwise use 'master'
          const checkMain = spawn('git', ['show-ref', '--verify', '--quiet', 'refs/heads/main'], {
            cwd: projectPath,
            shell: true,
          });
          checkMain.on('close', (mainCode) => {
            resolve(mainCode === 0 ? 'main' : 'master');
          });
        }
      });
    });
  },

  /**
   * Run gh pr create command
   *
   * @param projectPath - Path to the project
   * @param title - PR title
   * @param body - PR body (markdown)
   * @param baseBranch - Base branch for PR
   * @returns PR URL
   * @throws Error if PR creation fails
   */
  async runGhPrCreate(
    projectPath: string,
    title: string,
    body: string,
    baseBranch: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // Use gh pr create with --body-file stdin to handle complex markdown
      const args = [
        'pr',
        'create',
        '--title',
        title,
        '--base',
        baseBranch,
        '--body',
        body,
      ];

      const gh = spawn('gh', args, {
        cwd: projectPath,
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      gh.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      gh.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      gh.on('close', (code) => {
        if (code === 0) {
          // gh pr create outputs the PR URL on success
          const prUrl = stdout.trim();
          if (prUrl.startsWith('https://')) {
            resolve(prUrl);
          } else {
            // Try to extract URL from output
            const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+/);
            if (urlMatch) {
              resolve(urlMatch[0]);
            } else {
              reject(new Error(`PR created but could not extract URL. Output: ${stdout}`));
            }
          }
        } else {
          reject(new Error(`gh pr create failed with code ${code}: ${stderr || stdout}`));
        }
      });

      gh.on('error', (error) => {
        reject(new Error(`Failed to spawn gh command: ${error.message}`));
      });
    });
  },
};
