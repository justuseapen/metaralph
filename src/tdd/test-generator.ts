/**
 * Test Generator - RED Phase Implementation
 *
 * Generates failing tests from PRD acceptance criteria during the RED phase.
 * This is the first phase of the TDD workflow where tests are written before
 * implementation.
 *
 * The generator:
 * 1. Extracts testable requirements from the PRD
 * 2. Generates unit, integration, and E2E test stubs
 * 3. Writes test files to appropriate locations
 * 4. Verifies tests fail (as expected in TDD)
 * 5. Stores test metadata in the database
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import {
  type TestType,
  type TestStatus,
  type GeneratedTest,
} from './types.js';
import { TestRepository, type CreateTestInput } from './repositories/index.js';
import { type UserStory, type Prd } from '../collaboration/prd-builder.js';
import { type DatabaseInstance } from '../db/index.js';

/**
 * Supported test frameworks
 */
export type TestFramework = 'vitest' | 'jest';

/**
 * Project context for test generation
 */
export interface TestGeneratorProjectContext {
  /** Project root path */
  path: string;
  /** Project name */
  name: string;
  /** Detected test framework */
  testFramework: TestFramework;
  /** Source directory (e.g., 'src', 'lib') */
  srcDir: string;
  /** Test location preference: co-located with source or __tests__ directory */
  testLocation: 'colocated' | '__tests__';
}

/**
 * A testable requirement extracted from the PRD
 */
export interface TestableRequirement {
  /** Unique identifier */
  id: string;
  /** User story this requirement comes from */
  storyId: string;
  /** The requirement text (from acceptance criteria) */
  requirement: string;
  /** Suggested test type based on the requirement */
  suggestedTestType: TestType;
  /** Priority for test generation (lower = higher priority) */
  priority: number;
}

/**
 * Result of test generation
 */
export interface TestGenerationResult {
  success: boolean;
  /** Generated tests */
  tests: GeneratedTest[];
  /** Error message if failed */
  error?: string;
  /** Metrics about the generation */
  metrics: {
    unitTestsGenerated: number;
    integrationTestsGenerated: number;
    e2eTestsGenerated: number;
    totalFiles: number;
    totalRequirements: number;
  };
}

/**
 * Result of running tests to verify they fail
 */
export interface TestVerificationResult {
  /** Whether verification succeeded (all tests failed as expected) */
  success: boolean;
  /** Number of tests that failed (expected in RED phase) */
  failingCount: number;
  /** Number of tests that passed unexpectedly */
  passingCount: number;
  /** Error output from test runner */
  output: string;
}

/**
 * Configuration for TestGenerator
 */
export interface TestGeneratorConfig {
  /** Anthropic client (optional, created if not provided) */
  anthropicClient?: Anthropic;
  /** Max tokens for AI responses */
  maxTokens?: number;
  /** Model to use for generation */
  model?: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<Omit<TestGeneratorConfig, 'anthropicClient'>> = {
  maxTokens: 4096,
  model: 'claude-sonnet-4-20250514',
};

/**
 * Test Generator - Generates failing tests from PRD acceptance criteria
 */
export const TestGenerator = {
  /**
   * Create an Anthropic client
   */
  createClient(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is required for test generation. ' +
          'Set it in your shell or .env file.'
      );
    }
    return new Anthropic({ apiKey });
  },

  /**
   * Main entry point: Generate failing tests from a PRD
   *
   * @param task - Task context with user story and PRD
   * @param project - Project context with path and test settings
   * @param phaseId - The TDD phase ID for database records
   * @param config - Optional configuration
   * @param db - Optional database instance
   * @returns Generation result with created tests
   */
  async generate(
    task: { userStory: UserStory; prdJson: string },
    project: TestGeneratorProjectContext,
    phaseId: string,
    config: TestGeneratorConfig = {},
    db?: DatabaseInstance
  ): Promise<TestGenerationResult> {
    const client = config.anthropicClient ?? this.createClient();
    const maxTokens = config.maxTokens ?? DEFAULT_CONFIG.maxTokens;
    const model = config.model ?? DEFAULT_CONFIG.model;

    try {
      // Parse PRD to get the full context
      let prd: Prd;
      try {
        prd = JSON.parse(task.prdJson);
      } catch {
        return {
          success: false,
          tests: [],
          error: 'Failed to parse PRD JSON',
          metrics: {
            unitTestsGenerated: 0,
            integrationTestsGenerated: 0,
            e2eTestsGenerated: 0,
            totalFiles: 0,
            totalRequirements: 0,
          },
        };
      }

      // 1. Extract testable requirements from PRD
      const requirements = this.extractTestableRequirements(prd);

      // 2. Generate tests for each type
      const generatedTests: GeneratedTest[] = [];

      // Filter requirements by the current user story
      const storyRequirements = requirements.filter(
        (r) => r.storyId === task.userStory.id
      );

      const unitRequirements = storyRequirements.filter(
        (r) => r.suggestedTestType === 'unit'
      );
      const integrationRequirements = storyRequirements.filter(
        (r) => r.suggestedTestType === 'integration'
      );
      const e2eRequirements = storyRequirements.filter(
        (r) => r.suggestedTestType === 'e2e'
      );

      // Generate unit tests
      if (unitRequirements.length > 0) {
        const unitTests = await this.generateUnitTests(
          unitRequirements,
          project,
          task.userStory,
          { client, maxTokens, model }
        );
        generatedTests.push(...unitTests);
      }

      // Generate integration tests
      if (integrationRequirements.length > 0) {
        const integrationTests = await this.generateIntegrationTests(
          integrationRequirements,
          project,
          task.userStory,
          { client, maxTokens, model }
        );
        generatedTests.push(...integrationTests);
      }

      // Generate E2E tests (based on entire user stories for better context)
      if (e2eRequirements.length > 0 || task.userStory.acceptanceCriteria.some(c =>
        c.toLowerCase().includes('ui') ||
        c.toLowerCase().includes('user can') ||
        c.toLowerCase().includes('user should')
      )) {
        const e2eTests = await this.generateE2eTests(
          [task.userStory],
          project,
          { client, maxTokens, model }
        );
        generatedTests.push(...e2eTests);
      }

      // 3. Write test files to disk
      for (const test of generatedTests) {
        this.writeTestFile(test.filePath, test.testContent);
      }

      // 4. Store tests in database
      for (const test of generatedTests) {
        TestRepository.create(
          {
            phaseId,
            testType: test.testType,
            filePath: test.filePath,
            testContent: test.testContent,
            status: 'failing', // Tests start as failing in RED phase
          },
          db
        );
      }

      return {
        success: true,
        tests: generatedTests,
        metrics: {
          unitTestsGenerated: generatedTests.filter((t) => t.testType === 'unit').length,
          integrationTestsGenerated: generatedTests.filter((t) => t.testType === 'integration').length,
          e2eTestsGenerated: generatedTests.filter((t) => t.testType === 'e2e').length,
          totalFiles: generatedTests.length,
          totalRequirements: storyRequirements.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        tests: [],
        error: error instanceof Error ? error.message : String(error),
        metrics: {
          unitTestsGenerated: 0,
          integrationTestsGenerated: 0,
          e2eTestsGenerated: 0,
          totalFiles: 0,
          totalRequirements: 0,
        },
      };
    }
  },

  /**
   * Extract testable requirements from PRD acceptance criteria
   *
   * @param prd - The PRD to extract requirements from
   * @returns Array of testable requirements
   */
  extractTestableRequirements(prd: Prd): TestableRequirement[] {
    const requirements: TestableRequirement[] = [];
    let reqId = 1;

    for (const story of prd.userStories) {
      for (const criterion of story.acceptanceCriteria) {
        // Skip non-functional criteria
        if (this.isNonFunctionalCriterion(criterion)) {
          continue;
        }

        const testType = this.inferTestType(criterion);
        requirements.push({
          id: `REQ-${String(reqId).padStart(3, '0')}`,
          storyId: story.id,
          requirement: criterion,
          suggestedTestType: testType,
          priority: story.priority,
        });
        reqId++;
      }
    }

    return requirements;
  },

  /**
   * Generate unit tests for requirements
   *
   * @param requirements - Requirements to generate tests for
   * @param project - Project context
   * @param story - User story for context
   * @param aiConfig - AI configuration
   * @returns Generated test records (not yet saved to DB)
   */
  async generateUnitTests(
    requirements: TestableRequirement[],
    project: TestGeneratorProjectContext,
    story: UserStory,
    aiConfig: { client: Anthropic; maxTokens: number; model: string }
  ): Promise<GeneratedTest[]> {
    const { client, maxTokens, model } = aiConfig;
    const tests: GeneratedTest[] = [];

    // Group requirements by inferred module
    const moduleGroups = this.groupRequirementsByModule(requirements, story);

    for (const [moduleName, moduleReqs] of Object.entries(moduleGroups)) {
      const testFilePath = this.getTestFilePath(project, moduleName, 'unit');

      const prompt = this.buildUnitTestPrompt(
        moduleReqs,
        story,
        project,
        moduleName
      );

      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: this.getTestGeneratorSystemPrompt(project.testFramework),
        messages: [{ role: 'user', content: prompt }],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (textContent && textContent.type === 'text') {
        const testContent = this.extractTestCode(textContent.text);

        tests.push({
          id: uuidv4(),
          phaseId: '', // Will be set when saving to DB
          testType: 'unit',
          filePath: testFilePath,
          testContent,
          status: 'failing',
          createdAt: new Date().toISOString(),
        });
      }
    }

    return tests;
  },

  /**
   * Generate integration tests for requirements
   *
   * @param requirements - Requirements to generate tests for
   * @param project - Project context
   * @param story - User story for context
   * @param aiConfig - AI configuration
   * @returns Generated test records
   */
  async generateIntegrationTests(
    requirements: TestableRequirement[],
    project: TestGeneratorProjectContext,
    story: UserStory,
    aiConfig: { client: Anthropic; maxTokens: number; model: string }
  ): Promise<GeneratedTest[]> {
    const { client, maxTokens, model } = aiConfig;
    const tests: GeneratedTest[] = [];

    const testFilePath = this.getTestFilePath(
      project,
      `${this.storyIdToModuleName(story.id)}-integration`,
      'integration'
    );

    const prompt = this.buildIntegrationTestPrompt(requirements, story, project);

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: this.getTestGeneratorSystemPrompt(project.testFramework),
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = response.content.find((c) => c.type === 'text');
    if (textContent && textContent.type === 'text') {
      const testContent = this.extractTestCode(textContent.text);

      tests.push({
        id: uuidv4(),
        phaseId: '',
        testType: 'integration',
        filePath: testFilePath,
        testContent,
        status: 'failing',
        createdAt: new Date().toISOString(),
      });
    }

    return tests;
  },

  /**
   * Generate E2E tests for user stories
   *
   * @param stories - User stories to generate E2E tests for
   * @param project - Project context
   * @param aiConfig - AI configuration
   * @returns Generated test records
   */
  async generateE2eTests(
    stories: UserStory[],
    project: TestGeneratorProjectContext,
    aiConfig: { client: Anthropic; maxTokens: number; model: string }
  ): Promise<GeneratedTest[]> {
    const { client, maxTokens, model } = aiConfig;
    const tests: GeneratedTest[] = [];

    for (const story of stories) {
      const testFilePath = this.getTestFilePath(
        project,
        `${this.storyIdToModuleName(story.id)}-e2e`,
        'e2e'
      );

      const prompt = this.buildE2eTestPrompt(story, project);

      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: this.getE2eTestGeneratorSystemPrompt(project.testFramework),
        messages: [{ role: 'user', content: prompt }],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (textContent && textContent.type === 'text') {
        const testContent = this.extractTestCode(textContent.text);

        tests.push({
          id: uuidv4(),
          phaseId: '',
          testType: 'e2e',
          filePath: testFilePath,
          testContent,
          status: 'failing',
          createdAt: new Date().toISOString(),
        });
      }
    }

    return tests;
  },

  /**
   * Verify that generated tests fail (as expected in RED phase)
   *
   * @param testFiles - Paths to test files to verify
   * @param projectPath - Project root path
   * @param testFramework - Test framework to use
   * @returns Verification result
   */
  async verifyTestsFailing(
    testFiles: string[],
    projectPath: string,
    testFramework: TestFramework
  ): Promise<TestVerificationResult> {
    return new Promise((resolve) => {
      const command = testFramework === 'vitest' ? 'npx' : 'npx';
      const args =
        testFramework === 'vitest'
          ? ['vitest', 'run', '--reporter=verbose', ...testFiles]
          : ['jest', '--verbose', ...testFiles];

      let output = '';
      let failingCount = 0;
      let passingCount = 0;

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
        // Parse output to count failing/passing tests
        if (testFramework === 'vitest') {
          const failMatch = output.match(/(\d+)\s+failed/);
          const passMatch = output.match(/(\d+)\s+passed/);
          failingCount = failMatch ? parseInt(failMatch[1], 10) : 0;
          passingCount = passMatch ? parseInt(passMatch[1], 10) : 0;
        } else {
          const failMatch = output.match(/Tests:\s+(\d+)\s+failed/);
          const passMatch = output.match(/Tests:\s+(\d+)\s+passed/);
          failingCount = failMatch ? parseInt(failMatch[1], 10) : 0;
          passingCount = passMatch ? parseInt(passMatch[1], 10) : 0;
        }

        // In RED phase, we expect all tests to fail (code !== 0)
        // Success means tests failed as expected
        resolve({
          success: code !== 0 && failingCount > 0,
          failingCount,
          passingCount,
          output,
        });
      });

      proc.on('error', (err) => {
        resolve({
          success: false,
          failingCount: 0,
          passingCount: 0,
          output: `Failed to run tests: ${err.message}`,
        });
      });
    });
  },

  /**
   * Detect the test framework used by a project
   *
   * @param projectPath - Project root path
   * @returns Detected test framework
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

        // Check for vitest first (more specific)
        if (allDeps.vitest || allDeps['@vitest/runner']) {
          return 'vitest';
        }
        // Check for jest
        if (allDeps.jest || allDeps['@jest/core']) {
          return 'jest';
        }

        // Check scripts for hints
        const scripts = packageJson.scripts || {};
        if (scripts.test?.includes('vitest')) {
          return 'vitest';
        }
        if (scripts.test?.includes('jest')) {
          return 'jest';
        }
      } catch {
        // Fallback to vitest if package.json parsing fails
      }
    }

    // Default to vitest
    return 'vitest';
  },

  /**
   * Detect if tests are co-located with source or in __tests__ directories
   *
   * @param projectPath - Project root path
   * @returns Test location preference
   */
  detectTestLocation(projectPath: string): 'colocated' | '__tests__' {
    const srcPath = path.join(projectPath, 'src');

    if (fs.existsSync(srcPath)) {
      // Check for co-located tests
      const entries = fs.readdirSync(srcPath, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.test.ts')) {
          return 'colocated';
        }
      }

      // Check for __tests__ directories
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name === '__tests__') {
          return '__tests__';
        }
      }
    }

    // Default to co-located (modern convention)
    return 'colocated';
  },

  // ============ Private Helper Methods ============

  /**
   * Check if a criterion is non-functional (shouldn't generate tests)
   */
  isNonFunctionalCriterion(criterion: string): boolean {
    const nonFunctionalPatterns = [
      /typecheck\s+passes/i,
      /lint\s+passes/i,
      /build\s+passes/i,
      /code\s+review/i,
      /documentation/i,
      /commented/i,
    ];
    return nonFunctionalPatterns.some((p) => p.test(criterion));
  },

  /**
   * Infer the appropriate test type from a requirement
   */
  inferTestType(criterion: string): TestType {
    const lower = criterion.toLowerCase();

    // E2E indicators
    if (
      lower.includes('user can') ||
      lower.includes('user should') ||
      lower.includes('ui') ||
      lower.includes('page') ||
      lower.includes('screen') ||
      lower.includes('click') ||
      lower.includes('navigate') ||
      lower.includes('display')
    ) {
      return 'e2e';
    }

    // Integration indicators
    if (
      lower.includes('api') ||
      lower.includes('database') ||
      lower.includes('endpoint') ||
      lower.includes('service') ||
      lower.includes('repository') ||
      lower.includes('external')
    ) {
      return 'integration';
    }

    // Default to unit tests
    return 'unit';
  },

  /**
   * Group requirements by inferred module name
   */
  groupRequirementsByModule(
    requirements: TestableRequirement[],
    story: UserStory
  ): Record<string, TestableRequirement[]> {
    // For simplicity, group all requirements under the story module
    const moduleName = this.storyIdToModuleName(story.id);
    return { [moduleName]: requirements };
  },

  /**
   * Convert story ID to module name (e.g., US-015 -> us015)
   */
  storyIdToModuleName(storyId: string): string {
    return storyId.toLowerCase().replace(/-/g, '');
  },

  /**
   * Get the test file path based on project settings
   */
  getTestFilePath(
    project: TestGeneratorProjectContext,
    moduleName: string,
    testType: TestType
  ): string {
    const testSuffix = testType === 'unit' ? '.test.ts' : `.${testType}.test.ts`;

    if (project.testLocation === '__tests__') {
      return path.join(
        project.path,
        project.srcDir,
        '__tests__',
        testType,
        `${moduleName}${testSuffix}`
      );
    }

    // Co-located tests
    return path.join(
      project.path,
      project.srcDir,
      'tdd',
      'generated',
      `${moduleName}${testSuffix}`
    );
  },

  /**
   * Write test file to disk, creating directories as needed
   */
  writeTestFile(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
  },

  /**
   * Extract test code from AI response (handles markdown code blocks)
   */
  extractTestCode(response: string): string {
    // Try to extract from markdown code block
    const codeBlockMatch = response.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Return as-is if no code block found
    return response.trim();
  },

  /**
   * Get system prompt for unit/integration test generation
   */
  getTestGeneratorSystemPrompt(framework: TestFramework): string {
    const importStatement = framework === 'vitest'
      ? "import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';"
      : "import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';";

    return `You are an expert test generator for TDD (Test-Driven Development).

Your task is to generate failing tests that define the expected behavior BEFORE implementation.

IMPORTANT PRINCIPLES:
1. Tests MUST fail initially because the code doesn't exist yet
2. Write tests that clearly specify the expected behavior
3. Use descriptive test names that explain what should happen
4. Include edge cases and error scenarios
5. Focus on the public API/interface, not implementation details

Use ${framework} syntax:
${importStatement}

Output ONLY the test code in a markdown typescript code block. Do not include any explanations.

The tests should:
- Import from the expected module path (use placeholders if unsure)
- Use mock implementations where dependencies are needed
- Be self-documenting with clear describe/it blocks
- Cover both success and failure scenarios`;
  },

  /**
   * Get system prompt for E2E test generation
   */
  getE2eTestGeneratorSystemPrompt(framework: TestFramework): string {
    const importStatement = framework === 'vitest'
      ? "import { describe, it, expect, beforeAll, afterAll } from 'vitest';"
      : "import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';";

    return `You are an expert E2E test generator for TDD (Test-Driven Development).

Your task is to generate E2E test scenarios that describe user workflows BEFORE implementation.

IMPORTANT PRINCIPLES:
1. Tests MUST fail initially because the functionality doesn't exist yet
2. Focus on user-visible behavior and workflows
3. Write tests from the user's perspective
4. Use clear, descriptive test names
5. Structure tests as user journey scenarios

Use ${framework} syntax:
${importStatement}

Output ONLY the test code in a markdown typescript code block. Do not include any explanations.

The tests should:
- Describe complete user workflows
- Include setup and teardown as needed
- Use comments to explain the expected user journey
- Be integration-ready (can be adapted for actual E2E tools later)`;
  },

  /**
   * Build prompt for unit test generation
   */
  buildUnitTestPrompt(
    requirements: TestableRequirement[],
    story: UserStory,
    project: TestGeneratorProjectContext,
    moduleName: string
  ): string {
    return `Generate unit tests for the following requirements:

## User Story: ${story.title}
${story.description}

## Requirements to Test:
${requirements.map((r) => `- ${r.requirement}`).join('\n')}

## Project Context:
- Project: ${project.name}
- Module Name: ${moduleName}
- Test Framework: ${project.testFramework}

Generate comprehensive unit tests that will FAIL initially (since implementation doesn't exist yet).
Focus on testing the public interface and expected behavior.`;
  },

  /**
   * Build prompt for integration test generation
   */
  buildIntegrationTestPrompt(
    requirements: TestableRequirement[],
    story: UserStory,
    project: TestGeneratorProjectContext
  ): string {
    return `Generate integration tests for the following requirements:

## User Story: ${story.title}
${story.description}

## Requirements to Test:
${requirements.map((r) => `- ${r.requirement}`).join('\n')}

## Project Context:
- Project: ${project.name}
- Test Framework: ${project.testFramework}

Generate integration tests that verify components work together correctly.
These tests should FAIL initially since the integration doesn't exist yet.
Focus on testing interactions between modules, API calls, and data flow.`;
  },

  /**
   * Build prompt for E2E test generation
   */
  buildE2eTestPrompt(story: UserStory, project: TestGeneratorProjectContext): string {
    return `Generate E2E test scenarios for the following user story:

## User Story: ${story.title}
${story.description}

## Acceptance Criteria:
${story.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

## Project Context:
- Project: ${project.name}
- Test Framework: ${project.testFramework}

Generate E2E tests that describe the complete user journey.
These tests should FAIL initially since the feature doesn't exist yet.
Focus on user-visible behavior and expected outcomes.`;
  },
};
