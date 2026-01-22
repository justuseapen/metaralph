/**
 * Green Phase - Implementation Phase of TDD Workflow
 *
 * Runs native Ralph execution with frozen contracts until tests pass.
 * This is the third phase (GREEN) of the 6-phase TDD workflow:
 * RED -> RESEARCH -> GREEN -> INTEGRATE -> REFINE -> COMMIT
 *
 * The GREEN phase:
 * 1. Generates enhanced PRD JSON including frozen contracts and test specs
 * 2. Executes implementation using native metaralph ralph command
 * 3. Runs test suite to verify implementation
 * 4. Retries with error context if tests fail
 * 5. Tracks attempt count and test results in phase metrics
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type FrozenContracts,
  type AutonomousTddConfig,
  DEFAULT_TDD_CONFIG,
} from './types.js';
import { type UserStory, type Prd } from '../collaboration/prd-builder.js';
import { type TestFramework } from './test-generator.js';

/**
 * Task context for GREEN phase
 */
export interface GreenPhaseTaskContext {
  /** User story being implemented */
  userStory: UserStory;
  /** Original PRD JSON string */
  prdJson: string;
  /** Generated test file paths from RED phase */
  testFiles?: string[];
}

/**
 * Project context for GREEN phase
 */
export interface GreenPhaseProjectContext {
  /** Project root path */
  path: string;
  /** Project name */
  name: string;
  /** Detected test framework */
  testFramework?: TestFramework;
  /** Source directory */
  srcDir?: string;
}

/**
 * Configuration for GREEN phase
 */
export interface GreenPhaseConfig {
  /** Maximum retries if tests fail (default: 2) */
  maxGreenRetries?: number;
  /** Timeout for each execution attempt in ms (default: 30 min) */
  executionTimeoutMs?: number;
  /** Maximum iterations for ralph command per attempt (default: 5) */
  maxRalphIterations?: number;
  /** Tool to use for execution */
  tool?: 'claude' | 'cursor';
}

/**
 * Result of a single GREEN phase attempt
 */
export interface GreenPhaseAttempt {
  /** Attempt number (1-based) */
  attemptNumber: number;
  /** Whether this attempt succeeded (tests passed) */
  success: boolean;
  /** Test results from this attempt */
  testResults: TestRunResult;
  /** Error message if failed */
  error?: string;
  /** Duration of this attempt in ms */
  durationMs: number;
}

/**
 * Result of running tests
 */
export interface TestRunResult {
  /** Whether all tests passed */
  passed: boolean;
  /** Total number of tests */
  totalTests: number;
  /** Number of passing tests */
  passingTests: number;
  /** Number of failing tests */
  failingTests: number;
  /** Test output */
  output: string;
  /** Exit code from test runner */
  exitCode: number | null;
}

/**
 * Result of the GREEN phase
 */
export interface GreenPhaseResult {
  /** Whether the GREEN phase succeeded */
  success: boolean;
  /** Number of attempts made */
  attempts: number;
  /** Details of each attempt */
  attemptDetails: GreenPhaseAttempt[];
  /** Final test results */
  testResults?: TestRunResult;
  /** Error message if failed */
  error?: string;
  /** Total duration in ms */
  totalDurationMs: number;
  /** Metrics for phase tracking */
  metrics: {
    attemptsUsed: number;
    maxAttempts: number;
    testsPassedOnAttempt: number | null;
    totalTestsRun: number;
    finalTestsPassing: number;
  };
}

/**
 * Enhanced PRD with frozen contracts
 */
export interface EnhancedPrd extends Prd {
  /** Frozen contracts from RESEARCH phase */
  frozenContracts: FrozenContracts;
  /** Test specifications from RED phase */
  testSpecs?: {
    testFiles: string[];
    testFramework: string;
    requirements: string[];
  };
  /** Context for implementation */
  implementationContext?: {
    /** Previous attempt errors (for retries) */
    previousErrors?: string[];
    /** Attempt number */
    attemptNumber: number;
    /** Max attempts allowed */
    maxAttempts: number;
  };
}

/**
 * Default configuration for GREEN phase
 */
const DEFAULT_GREEN_CONFIG: Required<GreenPhaseConfig> = {
  maxGreenRetries: DEFAULT_TDD_CONFIG.maxGreenRetries,
  executionTimeoutMs: DEFAULT_TDD_CONFIG.timeouts.green,
  maxRalphIterations: 5,
  tool: 'claude',
};

/**
 * Green Phase - Implementation until tests pass
 */
export const GreenPhase = {
  /**
   * Run the GREEN phase - implementation until tests pass
   *
   * @param task - Task context with user story and PRD
   * @param project - Project context with path and settings
   * @param frozenContracts - Frozen contracts from RESEARCH phase
   * @param config - Optional configuration
   * @returns GREEN phase result
   */
  async run(
    task: GreenPhaseTaskContext,
    project: GreenPhaseProjectContext,
    frozenContracts: FrozenContracts,
    config: GreenPhaseConfig = {}
  ): Promise<GreenPhaseResult> {
    const startTime = Date.now();
    const maxRetries = config.maxGreenRetries ?? DEFAULT_GREEN_CONFIG.maxGreenRetries;
    const tool = config.tool ?? DEFAULT_GREEN_CONFIG.tool;
    const maxRalphIterations = config.maxRalphIterations ?? DEFAULT_GREEN_CONFIG.maxRalphIterations;
    const executionTimeoutMs = config.executionTimeoutMs ?? DEFAULT_GREEN_CONFIG.executionTimeoutMs;

    const attemptDetails: GreenPhaseAttempt[] = [];
    const previousErrors: string[] = [];

    // Try up to maxRetries + 1 times (initial attempt + retries)
    const maxAttempts = maxRetries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStartTime = Date.now();

      try {
        // 1. Generate enhanced PRD with frozen contracts and context
        const enhancedPrd = this.generateEnhancedPrd(
          task,
          frozenContracts,
          project,
          previousErrors,
          attempt,
          maxAttempts
        );

        // 2. Write enhanced PRD to temporary location
        const enhancedPrdPath = this.writeEnhancedPrd(project.path, enhancedPrd);

        // 3. Execute native Ralph with the enhanced PRD
        const executionResult = await this.executeRalph(
          project.path,
          enhancedPrdPath,
          tool,
          maxRalphIterations,
          executionTimeoutMs
        );

        // 4. Run test suite to check if tests pass
        const testResults = await this.runTests(
          project.path,
          project.testFramework ?? 'vitest',
          task.testFiles
        );

        const attemptDurationMs = Date.now() - attemptStartTime;

        const attemptResult: GreenPhaseAttempt = {
          attemptNumber: attempt,
          success: testResults.passed,
          testResults,
          durationMs: attemptDurationMs,
        };

        attemptDetails.push(attemptResult);

        // If tests pass, we're done
        if (testResults.passed) {
          // Clean up temporary enhanced PRD
          this.cleanupEnhancedPrd(enhancedPrdPath);

          return {
            success: true,
            attempts: attempt,
            attemptDetails,
            testResults,
            totalDurationMs: Date.now() - startTime,
            metrics: {
              attemptsUsed: attempt,
              maxAttempts,
              testsPassedOnAttempt: attempt,
              totalTestsRun: attemptDetails.reduce((sum, a) => sum + a.testResults.totalTests, 0),
              finalTestsPassing: testResults.passingTests,
            },
          };
        }

        // Tests failed - collect error for next attempt
        const errorSummary = this.summarizeTestErrors(testResults);
        previousErrors.push(errorSummary);

        // Clean up temporary enhanced PRD before retry
        this.cleanupEnhancedPrd(enhancedPrdPath);

      } catch (error) {
        const attemptDurationMs = Date.now() - attemptStartTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        const attemptResult: GreenPhaseAttempt = {
          attemptNumber: attempt,
          success: false,
          testResults: {
            passed: false,
            totalTests: 0,
            passingTests: 0,
            failingTests: 0,
            output: errorMessage,
            exitCode: null,
          },
          error: errorMessage,
          durationMs: attemptDurationMs,
        };

        attemptDetails.push(attemptResult);
        previousErrors.push(`Attempt ${attempt} error: ${errorMessage}`);
      }
    }

    // All attempts exhausted
    const lastAttempt = attemptDetails[attemptDetails.length - 1];
    return {
      success: false,
      attempts: maxAttempts,
      attemptDetails,
      testResults: lastAttempt?.testResults,
      error: `GREEN phase failed after ${maxAttempts} attempts. Tests did not pass.`,
      totalDurationMs: Date.now() - startTime,
      metrics: {
        attemptsUsed: maxAttempts,
        maxAttempts,
        testsPassedOnAttempt: null,
        totalTestsRun: attemptDetails.reduce((sum, a) => sum + a.testResults.totalTests, 0),
        finalTestsPassing: lastAttempt?.testResults.passingTests ?? 0,
      },
    };
  },

  /**
   * Generate enhanced PRD with frozen contracts and implementation context
   */
  generateEnhancedPrd(
    task: GreenPhaseTaskContext,
    frozenContracts: FrozenContracts,
    project: GreenPhaseProjectContext,
    previousErrors: string[],
    attemptNumber: number,
    maxAttempts: number
  ): EnhancedPrd {
    // Parse original PRD
    let originalPrd: Prd;
    try {
      originalPrd = JSON.parse(task.prdJson);
    } catch {
      throw new Error('Failed to parse original PRD JSON');
    }

    // Build enhanced PRD
    const enhancedPrd: EnhancedPrd = {
      ...originalPrd,
      frozenContracts,
      testSpecs: task.testFiles
        ? {
            testFiles: task.testFiles,
            testFramework: project.testFramework ?? 'vitest',
            requirements: task.userStory.acceptanceCriteria,
          }
        : undefined,
      implementationContext: {
        previousErrors: previousErrors.length > 0 ? previousErrors : undefined,
        attemptNumber,
        maxAttempts,
      },
    };

    return enhancedPrd;
  },

  /**
   * Write enhanced PRD to a temporary file in the project
   */
  writeEnhancedPrd(projectPath: string, enhancedPrd: EnhancedPrd): string {
    const enhancedPrdPath = path.join(projectPath, '.green-phase-prd.json');
    fs.writeFileSync(enhancedPrdPath, JSON.stringify(enhancedPrd, null, 2), 'utf-8');
    return enhancedPrdPath;
  },

  /**
   * Clean up temporary enhanced PRD file
   */
  cleanupEnhancedPrd(enhancedPrdPath: string): void {
    try {
      if (fs.existsSync(enhancedPrdPath)) {
        fs.unlinkSync(enhancedPrdPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  },

  /**
   * Execute native Ralph command for implementation
   */
  async executeRalph(
    projectPath: string,
    enhancedPrdPath: string,
    tool: 'claude' | 'cursor',
    maxIterations: number,
    timeoutMs: number
  ): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve, reject) => {
      // Build the GREEN phase prompt that guides implementation
      const greenPhasePrompt = this.buildGreenPhasePrompt(enhancedPrdPath);

      // Spawn Claude CLI with the GREEN phase prompt
      const child = spawn(tool, ['--print', '--dangerously-skip-permissions', '-p', greenPhasePrompt], {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      let stdout = '';
      let stderr = '';

      // Set up timeout
      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Ralph execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        // Stream output for visibility
        process.stdout.write(chunk);
      });

      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        process.stderr.write(chunk);
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);

        // Check for completion indicator
        const completed = stdout.includes('<promise>COMPLETE</promise>');

        resolve({
          success: code === 0 || completed,
          output: stdout + stderr,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to spawn Ralph: ${err.message}`));
      });
    });
  },

  /**
   * Build the prompt for GREEN phase implementation
   */
  buildGreenPhasePrompt(enhancedPrdPath: string): string {
    return `# GREEN Phase - Implementation Agent

You are an autonomous coding agent implementing a feature in the GREEN phase of TDD.

## Context

In the RED phase, tests were generated that define the expected behavior.
In the RESEARCH phase, patterns and contracts were analyzed.
Now in GREEN phase, you must implement the code to make the tests pass.

## Your Task

1. Read the enhanced PRD at \`${path.basename(enhancedPrdPath)}\`
   - This contains the original requirements
   - FROZEN CONTRACTS that you MUST follow exactly
   - Test specifications that define expected behavior
   - Previous errors (if this is a retry attempt)

2. Read the test files to understand what behavior is expected

3. Implement the minimum code necessary to make ALL tests pass
   - Follow the frozen contracts exactly
   - Use the patterns discovered in research phase
   - Keep implementation simple and focused

4. Run the test suite to verify tests pass:
   - Use \`npm test\` or \`npx vitest run\` or equivalent

5. If tests pass:
   - Commit your changes with message: \`feat: [Story ID] - Implementation (GREEN phase)\`
   - Reply with: <promise>COMPLETE</promise>

6. If tests fail:
   - Review the test errors carefully
   - Fix the implementation issues
   - Repeat until tests pass

## Important Guidelines

- DO NOT modify the tests - only implement the production code
- Follow frozen contracts exactly as specified
- Keep implementation minimal - just enough to pass tests
- If this is a retry, pay special attention to the previous errors

## Stop Condition

When ALL tests pass, reply with:
<promise>COMPLETE</promise>`;
  },

  /**
   * Run the test suite
   */
  async runTests(
    projectPath: string,
    testFramework: TestFramework,
    testFiles?: string[]
  ): Promise<TestRunResult> {
    return new Promise((resolve) => {
      const command = 'npx';
      const args =
        testFramework === 'vitest'
          ? ['vitest', 'run', '--reporter=verbose', ...(testFiles ?? [])]
          : ['jest', '--verbose', ...(testFiles ?? [])];

      let output = '';
      let totalTests = 0;
      let passingTests = 0;
      let failingTests = 0;

      const proc = spawn(command, args, {
        cwd: projectPath,
        shell: true,
      });

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        // Parse test counts from output
        if (testFramework === 'vitest') {
          const totalMatch = output.match(/(\d+)\s+tests?/i);
          const failMatch = output.match(/(\d+)\s+failed/i);
          const passMatch = output.match(/(\d+)\s+passed/i);

          totalTests = totalMatch ? parseInt(totalMatch[1], 10) : 0;
          failingTests = failMatch ? parseInt(failMatch[1], 10) : 0;
          passingTests = passMatch ? parseInt(passMatch[1], 10) : 0;

          // If only total is found, calculate from pass/fail
          if (totalTests === 0 && (passingTests > 0 || failingTests > 0)) {
            totalTests = passingTests + failingTests;
          }
        } else {
          // Jest output format
          const statsMatch = output.match(/Tests:\s+(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+passed,?\s*)?(\d+)\s+total/i);
          if (statsMatch) {
            failingTests = statsMatch[1] ? parseInt(statsMatch[1], 10) : 0;
            passingTests = statsMatch[2] ? parseInt(statsMatch[2], 10) : 0;
            totalTests = statsMatch[3] ? parseInt(statsMatch[3], 10) : 0;
          }
        }

        // Tests pass if exit code is 0 AND there are no failing tests
        const passed = code === 0 && failingTests === 0;

        resolve({
          passed,
          totalTests,
          passingTests,
          failingTests,
          output,
          exitCode: code,
        });
      });

      proc.on('error', (err) => {
        resolve({
          passed: false,
          totalTests: 0,
          passingTests: 0,
          failingTests: 0,
          output: `Failed to run tests: ${err.message}`,
          exitCode: null,
        });
      });
    });
  },

  /**
   * Summarize test errors for retry context
   */
  summarizeTestErrors(testResults: TestRunResult): string {
    const lines = testResults.output.split('\n');
    const errorLines: string[] = [];

    // Extract error-related lines
    let inErrorBlock = false;
    for (const line of lines) {
      if (line.includes('FAIL') || line.includes('Error') || line.includes('error')) {
        inErrorBlock = true;
      }
      if (inErrorBlock) {
        errorLines.push(line);
        // Limit error context
        if (errorLines.length >= 20) {
          errorLines.push('... (truncated)');
          break;
        }
      }
      if (line.trim() === '' && inErrorBlock && errorLines.length > 5) {
        inErrorBlock = false;
      }
    }

    if (errorLines.length === 0) {
      return `Tests failed with ${testResults.failingTests} failing tests (no error details captured)`;
    }

    return `Tests failed with ${testResults.failingTests} failures:\n${errorLines.join('\n')}`;
  },

  /**
   * Detect test framework from project
   */
  detectTestFramework(projectPath: string): TestFramework {
    const packageJsonPath = path.join(projectPath, 'package.json');

    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const allDeps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };

        if (allDeps.vitest || allDeps['@vitest/runner']) {
          return 'vitest';
        }
        if (allDeps.jest || allDeps['@jest/core']) {
          return 'jest';
        }

        const scripts = packageJson.scripts || {};
        if (scripts.test?.includes('vitest')) {
          return 'vitest';
        }
        if (scripts.test?.includes('jest')) {
          return 'jest';
        }
      } catch {
        // Fall through to default
      }
    }

    return 'vitest';
  },
};
