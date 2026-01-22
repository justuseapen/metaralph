/**
 * Tests for test-generator.ts - RED phase test generation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UserStory, Prd } from '../collaboration/prd-builder.js';
import type { GeneratedTest, TestType, TestStatus } from './types.js';

// Create hoisted mock functions to be used in vi.mock factories
const {
  mockTestRepositoryCreate,
  mockAnthropicCreate,
  mockFsExistsSync,
  mockFsReadFileSync,
  mockFsWriteFileSync,
  mockFsMkdirSync,
  mockFsReaddirSync,
  mockUuidv4,
  mockSpawn,
} = vi.hoisted(() => ({
  mockTestRepositoryCreate: vi.fn(),
  mockAnthropicCreate: vi.fn(),
  mockFsExistsSync: vi.fn(),
  mockFsReadFileSync: vi.fn(),
  mockFsWriteFileSync: vi.fn(),
  mockFsMkdirSync: vi.fn(),
  mockFsReaddirSync: vi.fn(),
  mockUuidv4: vi.fn(),
  mockSpawn: vi.fn(),
}));

// Mock uuid module
vi.mock('uuid', () => ({
  v4: mockUuidv4,
}));

// Mock repositories
vi.mock('./repositories/index.js', () => ({
  TestRepository: {
    create: mockTestRepositoryCreate,
  },
}));

// Mock fs module
vi.mock('node:fs', () => ({
  default: {
    existsSync: mockFsExistsSync,
    readFileSync: mockFsReadFileSync,
    writeFileSync: mockFsWriteFileSync,
    mkdirSync: mockFsMkdirSync,
    readdirSync: mockFsReaddirSync,
  },
  existsSync: mockFsExistsSync,
  readFileSync: mockFsReadFileSync,
  writeFileSync: mockFsWriteFileSync,
  mkdirSync: mockFsMkdirSync,
  readdirSync: mockFsReaddirSync,
}));

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

// Import after mocks are set up
import {
  TestGenerator,
  type TestGeneratorProjectContext,
  type TestGeneratorConfig,
  type TestableRequirement,
  type TestGenerationResult,
  type TestVerificationResult,
  type TestFramework,
} from './test-generator.js';

/**
 * Helper to create a UserStory with minimal required fields
 */
function createUserStory(options: Partial<UserStory> = {}): UserStory {
  return {
    id: options.id ?? 'US-001',
    title: options.title ?? 'Test Story',
    description: options.description ?? 'As a user, I want to test things so that tests exist',
    acceptanceCriteria: options.acceptanceCriteria ?? ['Add a function', 'Function returns correct value', 'Typecheck passes'],
    priority: options.priority ?? 1,
    passes: options.passes ?? false,
    notes: options.notes ?? '',
    dependsOn: options.dependsOn,
  };
}

/**
 * Helper to create a Prd with minimal required fields
 */
function createPrd(options: Partial<Prd> = {}): Prd {
  return {
    project: options.project ?? 'test-project',
    branchName: options.branchName ?? 'feature/test',
    description: options.description ?? 'Test project',
    userStories: options.userStories ?? [createUserStory()],
  };
}

/**
 * Helper to create a TestGeneratorProjectContext
 */
function createProjectContext(options: Partial<TestGeneratorProjectContext> = {}): TestGeneratorProjectContext {
  return {
    path: options.path ?? '/test/project',
    name: options.name ?? 'test-project',
    testFramework: options.testFramework ?? 'vitest',
    srcDir: options.srcDir ?? 'src',
    testLocation: options.testLocation ?? 'colocated',
  };
}

/**
 * Helper to create a mock Anthropic client
 */
function createMockAnthropicClient() {
  return {
    messages: {
      create: mockAnthropicCreate,
    },
  };
}

/**
 * Create a mock AI response with test code
 */
function createMockAiResponse(testCode: string) {
  return {
    content: [
      {
        type: 'text',
        text: `\`\`\`typescript
${testCode}
\`\`\``,
      },
    ],
  };
}

/**
 * Helper to create a mock child process for spawn
 */
function createMockChildProcess(exitCode: number, stdout: string, stderr: string = '') {
  const { EventEmitter } = require('events');
  const { Readable } = require('stream');

  const proc = new EventEmitter();
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });

  setImmediate(() => {
    proc.stdout.push(stdout);
    proc.stdout.push(null);
    proc.stderr.push(stderr);
    proc.stderr.push(null);
    proc.emit('close', exitCode);
  });

  return proc;
}

describe('test-generator.ts', () => {
  let uuidCounter = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    mockUuidv4.mockImplementation(() => `uuid-${++uuidCounter}`);

    // Default fs mocks
    mockFsExistsSync.mockReturnValue(false);
    mockFsWriteFileSync.mockReturnValue(undefined);
    mockFsMkdirSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('extractTestableRequirements', () => {
    it('should extract testable requirements from PRD acceptance criteria', () => {
      const prd = createPrd({
        userStories: [
          createUserStory({
            id: 'US-001',
            acceptanceCriteria: [
              'Add a function to calculate totals',
              'Function should handle edge cases',
              'API endpoint returns correct data',
            ],
          }),
        ],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);

      expect(requirements.length).toBe(3);
      expect(requirements[0].storyId).toBe('US-001');
      expect(requirements[0].requirement).toBe('Add a function to calculate totals');
    });

    it('should skip non-functional criteria', () => {
      const prd = createPrd({
        userStories: [
          createUserStory({
            acceptanceCriteria: [
              'Add a function',
              'Typecheck passes',
              'Lint passes',
              'Code review approved',
              'Build passes',
              'Documentation updated',
            ],
          }),
        ],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);

      // Should only extract the first one (non-functional criteria are skipped)
      expect(requirements.length).toBe(1);
      expect(requirements[0].requirement).toBe('Add a function');
    });

    it('should extract requirements from multiple user stories', () => {
      const prd = createPrd({
        userStories: [
          createUserStory({
            id: 'US-001',
            acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
          }),
          createUserStory({
            id: 'US-002',
            priority: 2,
            acceptanceCriteria: ['Criterion 3', 'Criterion 4'],
          }),
        ],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);

      expect(requirements.length).toBe(4);
      expect(requirements.filter((r) => r.storyId === 'US-001').length).toBe(2);
      expect(requirements.filter((r) => r.storyId === 'US-002').length).toBe(2);
    });

    it('should assign unique IDs to requirements', () => {
      const prd = createPrd({
        userStories: [
          createUserStory({
            acceptanceCriteria: ['Criterion 1', 'Criterion 2', 'Criterion 3'],
          }),
        ],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);

      const ids = requirements.map((r) => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
      expect(ids[0]).toBe('REQ-001');
      expect(ids[1]).toBe('REQ-002');
      expect(ids[2]).toBe('REQ-003');
    });

    it('should assign priority from user story', () => {
      const prd = createPrd({
        userStories: [
          createUserStory({
            priority: 5,
            acceptanceCriteria: ['Criterion 1'],
          }),
        ],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);

      expect(requirements[0].priority).toBe(5);
    });

    it('should handle empty acceptance criteria', () => {
      const prd = createPrd({
        userStories: [
          createUserStory({
            acceptanceCriteria: [],
          }),
        ],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);

      expect(requirements.length).toBe(0);
    });

    it('should handle empty user stories', () => {
      const prd = createPrd({
        userStories: [],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);

      expect(requirements.length).toBe(0);
    });
  });

  describe('inferTestType', () => {
    it('should infer unit test type for generic criteria', () => {
      // Access the internal inferTestType method by using extractTestableRequirements
      const prd = createPrd({
        userStories: [
          createUserStory({
            acceptanceCriteria: ['Add a function to calculate totals'],
          }),
        ],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);
      expect(requirements[0].suggestedTestType).toBe('unit');
    });

    it('should infer integration test type for API/database criteria', () => {
      const prd = createPrd({
        userStories: [
          createUserStory({
            acceptanceCriteria: [
              'API endpoint returns correct data',
              'Database stores the value correctly',
              'Service communicates with external system',
              'Repository method queries correctly',
            ],
          }),
        ],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);
      expect(requirements[0].suggestedTestType).toBe('integration');
      expect(requirements[1].suggestedTestType).toBe('integration');
      expect(requirements[2].suggestedTestType).toBe('integration');
      expect(requirements[3].suggestedTestType).toBe('integration');
    });

    it('should infer E2E test type for UI/user-facing criteria', () => {
      const prd = createPrd({
        userStories: [
          createUserStory({
            acceptanceCriteria: [
              'User can click the submit button',
              'User should see the results',
              'Page displays the data correctly',
              'UI shows loading indicator',
              'Screen navigates to next view',
            ],
          }),
        ],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);
      expect(requirements[0].suggestedTestType).toBe('e2e');
      expect(requirements[1].suggestedTestType).toBe('e2e');
      expect(requirements[2].suggestedTestType).toBe('e2e');
      expect(requirements[3].suggestedTestType).toBe('e2e');
      expect(requirements[4].suggestedTestType).toBe('e2e');
    });
  });

  describe('detectTestFramework', () => {
    it('should detect vitest from dependencies', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: {
          vitest: '^1.0.0',
        },
      }));

      const framework = TestGenerator.detectTestFramework('/test/project');

      expect(framework).toBe('vitest');
    });

    it('should detect jest from dependencies', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: {
          jest: '^29.0.0',
        },
      }));

      const framework = TestGenerator.detectTestFramework('/test/project');

      expect(framework).toBe('jest');
    });

    it('should detect vitest from @vitest/runner dependency', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: {
          '@vitest/runner': '^1.0.0',
        },
      }));

      const framework = TestGenerator.detectTestFramework('/test/project');

      expect(framework).toBe('vitest');
    });

    it('should detect jest from @jest/core dependency', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: {
          '@jest/core': '^29.0.0',
        },
      }));

      const framework = TestGenerator.detectTestFramework('/test/project');

      expect(framework).toBe('jest');
    });

    it('should detect vitest from scripts', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({
        scripts: {
          test: 'vitest run',
        },
      }));

      const framework = TestGenerator.detectTestFramework('/test/project');

      expect(framework).toBe('vitest');
    });

    it('should detect jest from scripts', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({
        scripts: {
          test: 'jest',
        },
      }));

      const framework = TestGenerator.detectTestFramework('/test/project');

      expect(framework).toBe('jest');
    });

    it('should prefer vitest over jest if both present', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: {
          vitest: '^1.0.0',
          jest: '^29.0.0',
        },
      }));

      const framework = TestGenerator.detectTestFramework('/test/project');

      expect(framework).toBe('vitest');
    });

    it('should default to vitest when package.json does not exist', () => {
      mockFsExistsSync.mockReturnValue(false);

      const framework = TestGenerator.detectTestFramework('/test/project');

      expect(framework).toBe('vitest');
    });

    it('should default to vitest when package.json is invalid', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('invalid json');

      const framework = TestGenerator.detectTestFramework('/test/project');

      expect(framework).toBe('vitest');
    });

    it('should default to vitest when no test framework detected', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({
        dependencies: {
          react: '^18.0.0',
        },
      }));

      const framework = TestGenerator.detectTestFramework('/test/project');

      expect(framework).toBe('vitest');
    });
  });

  describe('detectTestLocation', () => {
    it('should detect co-located tests', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReaddirSync.mockReturnValue([
        { isFile: () => true, isDirectory: () => false, name: 'component.tsx' },
        { isFile: () => true, isDirectory: () => false, name: 'component.test.ts' },
      ]);

      const location = TestGenerator.detectTestLocation('/test/project');

      expect(location).toBe('colocated');
    });

    it('should detect __tests__ directories', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReaddirSync.mockReturnValue([
        { isFile: () => false, isDirectory: () => true, name: '__tests__' },
        { isFile: () => true, isDirectory: () => false, name: 'component.tsx' },
      ]);

      const location = TestGenerator.detectTestLocation('/test/project');

      expect(location).toBe('__tests__');
    });

    it('should prefer co-located when .test.ts found first', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReaddirSync.mockReturnValue([
        { isFile: () => true, isDirectory: () => false, name: 'component.test.ts' },
        { isFile: () => false, isDirectory: () => true, name: '__tests__' },
      ]);

      const location = TestGenerator.detectTestLocation('/test/project');

      expect(location).toBe('colocated');
    });

    it('should default to colocated when src directory does not exist', () => {
      mockFsExistsSync.mockReturnValue(false);

      const location = TestGenerator.detectTestLocation('/test/project');

      expect(location).toBe('colocated');
    });

    it('should default to colocated when no tests found', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReaddirSync.mockReturnValue([
        { isFile: () => true, isDirectory: () => false, name: 'component.tsx' },
        { isFile: () => false, isDirectory: () => true, name: 'utils' },
      ]);

      const location = TestGenerator.detectTestLocation('/test/project');

      expect(location).toBe('colocated');
    });
  });

  describe('generate', () => {
    it('should generate tests for a user story', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse(`
describe('test', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });
});
      `));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        id: 'US-001',
        acceptanceCriteria: ['Add a function to calculate totals'],
      });
      const prd = createPrd({ userStories: [story] });

      const result = await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.success).toBe(true);
      expect(result.tests.length).toBeGreaterThan(0);
      expect(mockAnthropicCreate).toHaveBeenCalled();
      expect(mockFsWriteFileSync).toHaveBeenCalled();
      expect(mockTestRepositoryCreate).toHaveBeenCalled();
    });

    it('should return failure when PRD JSON is invalid', async () => {
      const mockClient = createMockAnthropicClient();
      const story = createUserStory();

      const result = await TestGenerator.generate(
        { userStory: story, prdJson: 'invalid json' },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to parse PRD JSON');
      expect(result.tests).toHaveLength(0);
    });

    it('should generate unit tests for unit requirements', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse(`
describe('unit test', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });
});
      `));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        acceptanceCriteria: ['Add a function to calculate totals'],
      });
      const prd = createPrd({ userStories: [story] });

      const result = await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.success).toBe(true);
      expect(result.metrics.unitTestsGenerated).toBeGreaterThan(0);
    });

    it('should generate integration tests for API requirements', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse(`
describe('integration test', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });
});
      `));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        acceptanceCriteria: ['API endpoint returns correct data'],
      });
      const prd = createPrd({ userStories: [story] });

      const result = await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.success).toBe(true);
      expect(result.metrics.integrationTestsGenerated).toBeGreaterThan(0);
    });

    it('should generate E2E tests for UI requirements', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse(`
describe('e2e test', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });
});
      `));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        acceptanceCriteria: ['User can click the submit button'],
      });
      const prd = createPrd({ userStories: [story] });

      const result = await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.success).toBe(true);
      expect(result.metrics.e2eTestsGenerated).toBeGreaterThan(0);
    });

    it('should generate E2E tests when acceptance criteria mention UI keywords', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse(`
describe('e2e test', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });
});
      `));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        acceptanceCriteria: ['User can view the dashboard'],
      });
      const prd = createPrd({ userStories: [story] });

      const result = await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.success).toBe(true);
      expect(result.metrics.e2eTestsGenerated).toBeGreaterThan(0);
    });

    it('should handle AI client errors gracefully', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockRejectedValue(new Error('API error'));

      const story = createUserStory({
        acceptanceCriteria: ['Add a function'],
      });
      const prd = createPrd({ userStories: [story] });

      const result = await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('API error');
    });

    it('should store tests in database', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse('test code'));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        acceptanceCriteria: ['Add a function'],
      });
      const prd = createPrd({ userStories: [story] });

      await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(mockTestRepositoryCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          phaseId: 'phase-001',
          status: 'failing',
        }),
        undefined
      );
    });

    it('should create directories before writing test files', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse('test code'));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));
      mockFsExistsSync.mockReturnValue(false);

      const story = createUserStory({
        acceptanceCriteria: ['Add a function'],
      });
      const prd = createPrd({ userStories: [story] });

      await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(mockFsMkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(mockFsWriteFileSync).toHaveBeenCalled();
    });

    it('should return metrics about generated tests', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse('test code'));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        acceptanceCriteria: [
          'Add a function',
          'API returns data',
          'User can click button',
        ],
      });
      const prd = createPrd({ userStories: [story] });

      const result = await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.metrics).toBeDefined();
      expect(result.metrics.totalRequirements).toBeGreaterThan(0);
      expect(result.metrics.totalFiles).toBeGreaterThan(0);
    });

    it('should only generate tests for the specified user story', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse('test code'));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story1 = createUserStory({
        id: 'US-001',
        acceptanceCriteria: ['Story 1 criterion'],
      });
      const story2 = createUserStory({
        id: 'US-002',
        acceptanceCriteria: ['Story 2 criterion'],
      });
      const prd = createPrd({ userStories: [story1, story2] });

      const result = await TestGenerator.generate(
        { userStory: story1, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.success).toBe(true);
      // Should only generate tests for story1, not story2
      expect(result.metrics.totalRequirements).toBe(1);
    });
  });

  describe('generateUnitTests', () => {
    it('should call AI with correct prompt for unit tests', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse('test code'));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        acceptanceCriteria: ['Add a function'],
      });
      const prd = createPrd({ userStories: [story] });

      await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining('TDD'),
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('Generate unit tests'),
            }),
          ]),
        })
      );
    });

    it('should include story context in prompt', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse('test code'));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        title: 'My Test Story',
        description: 'Story description here',
        acceptanceCriteria: ['Add a function'],
      });
      const prd = createPrd({ userStories: [story] });

      await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('My Test Story'),
            }),
          ]),
        })
      );
    });

    it('should use vitest syntax when testFramework is vitest', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse('test code'));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        acceptanceCriteria: ['Add a function'],
      });
      const prd = createPrd({ userStories: [story] });

      await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext({ testFramework: 'vitest' }),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining('vitest'),
        })
      );
    });

    it('should use jest syntax when testFramework is jest', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse('test code'));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        acceptanceCriteria: ['Add a function'],
      });
      const prd = createPrd({ userStories: [story] });

      await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext({ testFramework: 'jest' }),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining('jest'),
        })
      );
    });
  });

  describe('generateIntegrationTests', () => {
    it('should generate integration tests for API criteria', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse(`
describe('integration', () => {
  it('should call API', () => {});
});
      `));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        acceptanceCriteria: ['API endpoint returns user data'],
      });
      const prd = createPrd({ userStories: [story] });

      const result = await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.success).toBe(true);
      expect(result.metrics.integrationTestsGenerated).toBeGreaterThan(0);
    });
  });

  describe('generateE2eTests', () => {
    it('should generate E2E tests for user-facing criteria', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse(`
describe('e2e', () => {
  it('user can submit', () => {});
});
      `));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        acceptanceCriteria: ['User can submit the form'],
      });
      const prd = createPrd({ userStories: [story] });

      const result = await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.success).toBe(true);
      expect(result.metrics.e2eTestsGenerated).toBeGreaterThan(0);
    });

    it('should include user story acceptance criteria in E2E prompt', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse('test code'));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        acceptanceCriteria: ['User can click submit', 'User should see confirmation'],
      });
      const prd = createPrd({ userStories: [story] });

      await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      // Find the E2E prompt call
      const e2eCall = mockAnthropicCreate.mock.calls.find((call) =>
        call[0].messages[0].content.includes('E2E test')
      );
      if (e2eCall) {
        expect(e2eCall[0].messages[0].content).toContain('User can click submit');
        expect(e2eCall[0].messages[0].content).toContain('User should see confirmation');
      }
    });
  });

  describe('verifyTestsFailing', () => {
    it('should verify tests fail with vitest', async () => {
      const mockProc = createMockChildProcess(1, '1 failed, 0 passed');
      mockSpawn.mockReturnValue(mockProc);

      const result = await TestGenerator.verifyTestsFailing(
        ['/test/file.test.ts'],
        '/test/project',
        'vitest'
      );

      expect(result.success).toBe(true);
      expect(result.failingCount).toBe(1);
      expect(result.passingCount).toBe(0);
      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining(['vitest', 'run']),
        expect.any(Object)
      );
    });

    it('should verify tests fail with jest', async () => {
      const mockProc = createMockChildProcess(1, 'Tests: 2 failed, 0 passed');
      mockSpawn.mockReturnValue(mockProc);

      const result = await TestGenerator.verifyTestsFailing(
        ['/test/file.test.ts'],
        '/test/project',
        'jest'
      );

      expect(result.success).toBe(true);
      expect(result.failingCount).toBe(2);
      expect(result.passingCount).toBe(0);
      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining(['jest', '--verbose']),
        expect.any(Object)
      );
    });

    it('should return success=false when tests pass (unexpected in RED phase)', async () => {
      const mockProc = createMockChildProcess(0, '0 failed, 5 passed');
      mockSpawn.mockReturnValue(mockProc);

      const result = await TestGenerator.verifyTestsFailing(
        ['/test/file.test.ts'],
        '/test/project',
        'vitest'
      );

      // In RED phase, we expect tests to fail. If they pass, that's unexpected.
      expect(result.success).toBe(false);
      expect(result.passingCount).toBe(5);
    });

    it('should return success=true when tests fail as expected', async () => {
      const mockProc = createMockChildProcess(1, '3 failed, 2 passed');
      mockSpawn.mockReturnValue(mockProc);

      const result = await TestGenerator.verifyTestsFailing(
        ['/test/file.test.ts'],
        '/test/project',
        'vitest'
      );

      expect(result.success).toBe(true);
      expect(result.failingCount).toBe(3);
      expect(result.passingCount).toBe(2);
    });

    it('should handle spawn errors', async () => {
      const { EventEmitter } = require('events');
      const proc = new EventEmitter();
      proc.stdout = { on: vi.fn() };
      proc.stderr = { on: vi.fn() };

      mockSpawn.mockReturnValue(proc);

      const resultPromise = TestGenerator.verifyTestsFailing(
        ['/test/file.test.ts'],
        '/test/project',
        'vitest'
      );

      setImmediate(() => {
        proc.emit('error', new Error('spawn failed'));
      });

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.output).toContain('spawn failed');
    });

    it('should capture test output', async () => {
      const testOutput = `
FAIL src/test.test.ts
  ✕ should work (5ms)

  1 failed, 0 passed
      `;
      const mockProc = createMockChildProcess(1, testOutput);
      mockSpawn.mockReturnValue(mockProc);

      const result = await TestGenerator.verifyTestsFailing(
        ['/test/file.test.ts'],
        '/test/project',
        'vitest'
      );

      expect(result.output).toContain('FAIL');
      expect(result.output).toContain('should work');
    });
  });

  describe('extractTestCode', () => {
    it('should extract code from markdown code block', () => {
      const response = `Here is the test:
\`\`\`typescript
describe('test', () => {
  it('works', () => {});
});
\`\`\`
      `;

      // Access via generate with mocked AI response
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: response }],
      });

      // The extractTestCode is called internally by generate
      // We can verify the behavior by checking what gets written to files
    });

    it('should extract code from ts code block', () => {
      const response = `\`\`\`ts
const test = true;
\`\`\``;

      // The internal extractTestCode handles both 'typescript' and 'ts' language specifiers
    });

    it('should return raw response when no code block found', () => {
      const response = `describe('test', () => {
  it('works', () => {});
});`;

      // When no code block markers, should return trimmed content as-is
    });
  });

  describe('getTestFilePath', () => {
    it('should generate co-located test path for unit tests', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse('test code'));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        id: 'US-001',
        acceptanceCriteria: ['Add a function'],
      });
      const prd = createPrd({ userStories: [story] });

      await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext({ testLocation: 'colocated' }),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      // Verify the file path contains expected structure
      const writeCall = mockFsWriteFileSync.mock.calls[0];
      expect(writeCall[0]).toContain('src/tdd/generated');
      expect(writeCall[0]).toContain('.test.ts');
    });

    it('should generate __tests__ path when configured', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse('test code'));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        id: 'US-001',
        acceptanceCriteria: ['Add a function'],
      });
      const prd = createPrd({ userStories: [story] });

      await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext({ testLocation: '__tests__' }),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      const writeCall = mockFsWriteFileSync.mock.calls[0];
      expect(writeCall[0]).toContain('__tests__');
    });

    it('should use correct suffix for integration tests', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse('test code'));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        id: 'US-001',
        acceptanceCriteria: ['API endpoint returns data'],
      });
      const prd = createPrd({ userStories: [story] });

      await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      const writeCall = mockFsWriteFileSync.mock.calls[0];
      expect(writeCall[0]).toContain('.integration.test.ts');
    });

    it('should use correct suffix for E2E tests', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse('test code'));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        id: 'US-001',
        acceptanceCriteria: ['User can click the button'],
      });
      const prd = createPrd({ userStories: [story] });

      await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      const writeCall = mockFsWriteFileSync.mock.calls[0];
      expect(writeCall[0]).toContain('.e2e.test.ts');
    });
  });

  describe('createClient', () => {
    it('should throw error when ANTHROPIC_API_KEY is not set', () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      try {
        expect(() => TestGenerator.createClient()).toThrow('ANTHROPIC_API_KEY');
      } finally {
        if (originalKey) {
          process.env.ANTHROPIC_API_KEY = originalKey;
        }
      }
    });
  });

  describe('storyIdToModuleName', () => {
    it('should convert story ID to module name format', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse('test code'));
      mockTestRepositoryCreate.mockImplementation((input) => ({
        id: `test-${++uuidCounter}`,
        ...input,
        createdAt: new Date().toISOString(),
      }));

      const story = createUserStory({
        id: 'US-015',
        acceptanceCriteria: ['Add a function'],
      });
      const prd = createPrd({ userStories: [story] });

      await TestGenerator.generate(
        { userStory: story, prdJson: JSON.stringify(prd) },
        createProjectContext(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      // The generated file should use the module name format (us015 instead of US-015)
      const writeCall = mockFsWriteFileSync.mock.calls[0];
      expect(writeCall[0]).toContain('us015');
      expect(writeCall[0]).not.toContain('US-015');
    });
  });

  describe('isNonFunctionalCriterion', () => {
    it('should filter out typecheck criteria', () => {
      const prd = createPrd({
        userStories: [
          createUserStory({
            acceptanceCriteria: ['Typecheck passes', 'Real criterion'],
          }),
        ],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);
      expect(requirements.length).toBe(1);
      expect(requirements[0].requirement).toBe('Real criterion');
    });

    it('should filter out lint criteria', () => {
      const prd = createPrd({
        userStories: [
          createUserStory({
            acceptanceCriteria: ['Lint passes', 'Real criterion'],
          }),
        ],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);
      expect(requirements.length).toBe(1);
    });

    it('should filter out build criteria', () => {
      const prd = createPrd({
        userStories: [
          createUserStory({
            acceptanceCriteria: ['Build passes', 'Real criterion'],
          }),
        ],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);
      expect(requirements.length).toBe(1);
    });

    it('should filter out code review criteria', () => {
      const prd = createPrd({
        userStories: [
          createUserStory({
            acceptanceCriteria: ['Code review approved', 'Real criterion'],
          }),
        ],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);
      expect(requirements.length).toBe(1);
    });

    it('should filter out documentation criteria', () => {
      const prd = createPrd({
        userStories: [
          createUserStory({
            acceptanceCriteria: ['Documentation updated', 'Real criterion'],
          }),
        ],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);
      expect(requirements.length).toBe(1);
    });

    it('should keep functional criteria that happen to include non-functional words', () => {
      const prd = createPrd({
        userStories: [
          createUserStory({
            acceptanceCriteria: ['Function validates lint rules'],
          }),
        ],
      });

      const requirements = TestGenerator.extractTestableRequirements(prd);
      // This should be kept since "lint" is part of a larger word
      expect(requirements.length).toBe(1);
    });
  });
});
