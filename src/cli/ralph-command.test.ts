/**
 * Tests for ralph.ts - Native Ralph command execution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import type { UserStory } from '../collaboration/prd-builder.js';

// Create hoisted mock functions to be used in vi.mock factories
const { mockSpawn, mockReadFileSync, mockExistsSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockReadFileSync: vi.fn(() => '{}'),
  mockExistsSync: vi.fn(() => true),
  mockWriteFileSync: vi.fn(),
}));

// Mock console to suppress output during tests
const mockConsoleLog = vi.fn();
const mockConsoleError = vi.fn();
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// Mock modules
vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
  existsSync: mockExistsSync,
  writeFileSync: mockWriteFileSync,
  default: {
    readFileSync: mockReadFileSync,
    existsSync: mockExistsSync,
    writeFileSync: mockWriteFileSync,
  },
}));

vi.mock('node:path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
  resolve: vi.fn((...args: string[]) => args.join('/')),
  dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/')),
  basename: vi.fn((p: string) => p.split('/').pop()),
  default: {
    join: vi.fn((...args: string[]) => args.join('/')),
    resolve: vi.fn((...args: string[]) => args.join('/')),
    dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/')),
    basename: vi.fn((p: string) => p.split('/').pop()),
  },
}));

// Import module after mocks are set up
import {
  validatePrd,
  countCompletedStories,
  allStoriesComplete,
  executeRalph,
  displaySummary,
  formatDuration,
  type RalphPrd,
  type RalphResult,
  type RalphOptions,
} from './ralph.js';

/**
 * Helper to create a UserStory with minimal required fields
 */
function createStory(
  id: string,
  priority: number,
  options: {
    passes?: boolean;
    dependsOn?: string[];
    title?: string;
    description?: string;
    acceptanceCriteria?: string[];
    notes?: string;
  } = {}
): UserStory {
  return {
    id,
    title: options.title ?? `Story ${id}`,
    description: options.description ?? `Description for ${id}`,
    acceptanceCriteria: options.acceptanceCriteria ?? ['Criterion 1', 'Typecheck passes'],
    priority,
    passes: options.passes ?? false,
    notes: options.notes ?? '',
    dependsOn: options.dependsOn,
  };
}

/**
 * Helper to create a mock PRD
 */
function createPrd(stories: UserStory[]): RalphPrd {
  return {
    project: 'test-project',
    branchName: 'test/branch',
    description: 'Test PRD description',
    userStories: stories,
  };
}

/**
 * Helper to create a mock child process with proper stream types.
 * Uses setImmediate for event emission to work correctly with the code's event handling.
 */
function createMockChildProcess(options: {
  exitCode?: number | null;
  output?: string;
  errorOutput?: string;
  emitError?: Error;
} = {}): ChildProcess {
  const mockProcess = new EventEmitter() as ChildProcess;

  // Create mock readable streams for stdout/stderr
  const mockStdout = new Readable({ read() {} });
  const mockStderr = new Readable({ read() {} });

  // Assign streams to process
  Object.defineProperty(mockProcess, 'stdout', {
    value: mockStdout,
    writable: false,
    configurable: true,
  });
  Object.defineProperty(mockProcess, 'stderr', {
    value: mockStderr,
    writable: false,
    configurable: true,
  });

  // Use setImmediate for event emission to work with event handling
  setImmediate(() => {
    if (options.emitError) {
      mockProcess.emit('error', options.emitError);
      return;
    }

    if (options.output) {
      mockStdout.push(Buffer.from(options.output));
      mockStdout.push(null);
    }
    if (options.errorOutput) {
      mockStderr.push(Buffer.from(options.errorOutput));
      mockStderr.push(null);
    }
    // Emit close after ensuring data events are processed
    setImmediate(() => {
      mockProcess.emit('close', options.exitCode ?? 0);
    });
  });

  return mockProcess;
}

describe('ralph.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{}');
    // Suppress console output during tests
    console.log = mockConsoleLog;
    console.error = mockConsoleError;
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Restore console
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('validatePrd', () => {
    it('should return error when prd.json does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = validatePrd('/test/prd.json');

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('not found');
      }
    });

    it('should return error when prd.json is invalid JSON', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{ invalid json }');

      const result = validatePrd('/test/prd.json');

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('Failed to parse');
      }
    });

    it('should return error when project field is missing', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        branchName: 'test',
        description: 'test',
        userStories: [],
      }));

      const result = validatePrd('/test/prd.json');

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('"project"');
      }
    });

    it('should return error when branchName field is missing', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        project: 'test',
        description: 'test',
        userStories: [],
      }));

      const result = validatePrd('/test/prd.json');

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('"branchName"');
      }
    });

    it('should return error when description field is missing', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        project: 'test',
        branchName: 'test',
        userStories: [],
      }));

      const result = validatePrd('/test/prd.json');

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('"description"');
      }
    });

    it('should return error when userStories is not an array', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        project: 'test',
        branchName: 'test',
        description: 'test',
        userStories: 'not an array',
      }));

      const result = validatePrd('/test/prd.json');

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('"userStories"');
      }
    });

    it('should return error when user story is missing id', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        project: 'test',
        branchName: 'test',
        description: 'test',
        userStories: [{ title: 'Test', acceptanceCriteria: [] }],
      }));

      const result = validatePrd('/test/prd.json');

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('"id"');
      }
    });

    it('should return error when user story is missing title', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        project: 'test',
        branchName: 'test',
        description: 'test',
        userStories: [{ id: 'US-001', acceptanceCriteria: [] }],
      }));

      const result = validatePrd('/test/prd.json');

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('"title"');
      }
    });

    it('should return error when user story is missing acceptanceCriteria', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        project: 'test',
        branchName: 'test',
        description: 'test',
        userStories: [{ id: 'US-001', title: 'Test' }],
      }));

      const result = validatePrd('/test/prd.json');

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('"acceptanceCriteria"');
      }
    });

    it('should return valid PRD with all required fields', () => {
      const prd = createPrd([createStory('US-001', 1)]);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(prd));

      const result = validatePrd('/test/prd.json');

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.prd.project).toBe('test-project');
        expect(result.prd.branchName).toBe('test/branch');
        expect(result.prd.userStories).toHaveLength(1);
        expect(result.prd.userStories[0].id).toBe('US-001');
      }
    });

    it('should return valid PRD with empty user stories array', () => {
      const prd = createPrd([]);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(prd));

      const result = validatePrd('/test/prd.json');

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.prd.userStories).toHaveLength(0);
      }
    });

    it('should validate multiple user stories', () => {
      const prd = createPrd([
        createStory('US-001', 1),
        createStory('US-002', 2),
        createStory('US-003', 3),
      ]);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(prd));

      const result = validatePrd('/test/prd.json');

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.prd.userStories).toHaveLength(3);
      }
    });
  });

  describe('countCompletedStories', () => {
    it('should return 0 for no completed stories', () => {
      const prd = createPrd([
        createStory('US-001', 1, { passes: false }),
        createStory('US-002', 2, { passes: false }),
      ]);

      expect(countCompletedStories(prd)).toBe(0);
    });

    it('should count stories with passes=true', () => {
      const prd = createPrd([
        createStory('US-001', 1, { passes: true }),
        createStory('US-002', 2, { passes: false }),
        createStory('US-003', 3, { passes: true }),
      ]);

      expect(countCompletedStories(prd)).toBe(2);
    });

    it('should return total count when all stories pass', () => {
      const prd = createPrd([
        createStory('US-001', 1, { passes: true }),
        createStory('US-002', 2, { passes: true }),
      ]);

      expect(countCompletedStories(prd)).toBe(2);
    });

    it('should handle empty stories array', () => {
      const prd = createPrd([]);

      expect(countCompletedStories(prd)).toBe(0);
    });
  });

  describe('allStoriesComplete', () => {
    it('should return false when some stories are incomplete', () => {
      const prd = createPrd([
        createStory('US-001', 1, { passes: true }),
        createStory('US-002', 2, { passes: false }),
      ]);

      expect(allStoriesComplete(prd)).toBe(false);
    });

    it('should return true when all stories pass', () => {
      const prd = createPrd([
        createStory('US-001', 1, { passes: true }),
        createStory('US-002', 2, { passes: true }),
      ]);

      expect(allStoriesComplete(prd)).toBe(true);
    });

    it('should return true for empty stories array', () => {
      const prd = createPrd([]);

      expect(allStoriesComplete(prd)).toBe(true);
    });

    it('should return false when all stories are incomplete', () => {
      const prd = createPrd([
        createStory('US-001', 1, { passes: false }),
        createStory('US-002', 2, { passes: false }),
      ]);

      expect(allStoriesComplete(prd)).toBe(false);
    });
  });

  describe('formatDuration', () => {
    it('should format seconds correctly', () => {
      expect(formatDuration(5000)).toBe('5s');
      expect(formatDuration(30000)).toBe('30s');
      expect(formatDuration(59000)).toBe('59s');
    });

    it('should format minutes and seconds correctly', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(125000)).toBe('2m 5s');
    });

    it('should format hours, minutes, and seconds correctly', () => {
      expect(formatDuration(3600000)).toBe('1h 0m 0s');
      expect(formatDuration(3661000)).toBe('1h 1m 1s');
      expect(formatDuration(7323000)).toBe('2h 2m 3s');
    });

    it('should handle 0 milliseconds', () => {
      expect(formatDuration(0)).toBe('0s');
    });
  });

  describe('executeRalph', () => {
    describe('PRD validation errors', () => {
      it('should return error when prd.json does not exist', async () => {
        mockExistsSync.mockReturnValue(false);

        const result = await executeRalph('/test/project');

        expect(result.success).toBe(false);
        expect(result.completed).toBe(false);
        expect(result.error).toContain('not found');
        expect(result.iterationsUsed).toBe(0);
      });

      it('should return error when prd.json is invalid', async () => {
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue('invalid json');

        const result = await executeRalph('/test/project');

        expect(result.success).toBe(false);
        expect(result.completed).toBe(false);
        expect(result.error).toContain('Failed to parse');
      });

      it('should return error when prd.json is missing required fields', async () => {
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(JSON.stringify({
          project: 'test',
          // Missing branchName, description, userStories
        }));

        const result = await executeRalph('/test/project');

        expect(result.success).toBe(false);
        expect(result.completed).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('Already complete scenarios', () => {
      it('should return success immediately when all stories already pass', async () => {
        const prd = createPrd([
          createStory('US-001', 1, { passes: true }),
          createStory('US-002', 2, { passes: true }),
        ]);
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(JSON.stringify(prd));

        const result = await executeRalph('/test/project');

        expect(result.success).toBe(true);
        expect(result.completed).toBe(true);
        expect(result.iterationsUsed).toBe(0);
        expect(result.storiesCompleted).toBe(2);
        expect(mockSpawn).not.toHaveBeenCalled();
      });
    });

    describe('Iteration loop', () => {
      it('should spawn claude CLI with correct arguments', async () => {
        const prd = createPrd([createStory('US-001', 1)]);
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(JSON.stringify(prd));

        const mockProcess = createMockChildProcess({
          output: '<promise>COMPLETE</promise>',
          exitCode: 0,
        });
        mockSpawn.mockReturnValue(mockProcess);

        await executeRalph('/test/project');

        expect(mockSpawn).toHaveBeenCalledWith(
          'claude',
          expect.arrayContaining([
            '--print',
            '--dangerously-skip-permissions',
            '-p',
            expect.any(String),
          ]),
          expect.objectContaining({
            cwd: '/test/project',
          })
        );
      });

      it('should use cursor tool when configured', async () => {
        const prd = createPrd([createStory('US-001', 1)]);
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(JSON.stringify(prd));

        const mockProcess = createMockChildProcess({
          output: '<promise>COMPLETE</promise>',
          exitCode: 0,
        });
        mockSpawn.mockReturnValue(mockProcess);

        await executeRalph('/test/project', { tool: 'cursor' });

        expect(mockSpawn).toHaveBeenCalledWith(
          'cursor',
          expect.any(Array),
          expect.any(Object)
        );
      });

      it('should detect completion via <promise>COMPLETE</promise> marker', async () => {
        const prd = createPrd([createStory('US-001', 1)]);
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(JSON.stringify(prd));

        const mockProcess = createMockChildProcess({
          output: 'Working...\n<promise>COMPLETE</promise>\nDone.',
          exitCode: 0,
        });
        mockSpawn.mockReturnValue(mockProcess);

        const result = await executeRalph('/test/project');

        expect(result.success).toBe(true);
        expect(result.completed).toBe(true);
        expect(result.iterationsUsed).toBe(1);
      });

      it('should detect completion by re-reading prd.json after iteration', async () => {
        const incompletePrd = createPrd([createStory('US-001', 1, { passes: false })]);
        const completePrd = createPrd([createStory('US-001', 1, { passes: true })]);

        mockExistsSync.mockReturnValue(true);
        let readCount = 0;
        mockReadFileSync.mockImplementation(() => {
          readCount++;
          // First reads return incomplete PRD, later reads return complete
          if (readCount <= 1) {
            return JSON.stringify(incompletePrd);
          }
          return JSON.stringify(completePrd);
        });

        const mockProcess = createMockChildProcess({
          output: 'Work done but no COMPLETE marker',
          exitCode: 0,
        });
        mockSpawn.mockReturnValue(mockProcess);

        const result = await executeRalph('/test/project');

        expect(result.success).toBe(true);
        expect(result.completed).toBe(true);
      });
    });

    describe('Max iterations limit', () => {
      it('should stop after max iterations when not complete', async () => {
        const prd = createPrd([createStory('US-001', 1, { passes: false })]);
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(JSON.stringify(prd));

        // Use mockImplementation to return fresh process for each call
        mockSpawn.mockImplementation(() => createMockChildProcess({
          output: 'Work in progress',
          exitCode: 0,
        }));

        const result = await executeRalph('/test/project', { iterations: 3 });

        expect(result.success).toBe(false);
        expect(result.completed).toBe(false);
        expect(result.iterationsUsed).toBe(3);
        expect(mockSpawn).toHaveBeenCalledTimes(3);
      });

      it('should respect custom iterations option', async () => {
        const prd = createPrd([createStory('US-001', 1, { passes: false })]);
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(JSON.stringify(prd));

        // Use mockImplementation to return fresh process for each call
        mockSpawn.mockImplementation(() => createMockChildProcess({
          output: 'Work in progress',
          exitCode: 0,
        }));

        const result = await executeRalph('/test/project', { iterations: 5 });

        expect(result.iterationsUsed).toBe(5);
        expect(mockSpawn).toHaveBeenCalledTimes(5);
      });

      it('should default to 10 iterations', async () => {
        const prd = createPrd([createStory('US-001', 1, { passes: false })]);
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(JSON.stringify(prd));

        // Use mockImplementation to return fresh process for each call
        mockSpawn.mockImplementation(() => createMockChildProcess({
          output: 'Work in progress',
          exitCode: 0,
        }));

        const result = await executeRalph('/test/project');

        expect(result.iterationsUsed).toBe(10);
        expect(mockSpawn).toHaveBeenCalledTimes(10);
      });
    });

    describe('Error handling and exit codes', () => {
      it('should continue after iteration failure and allow subsequent success', async () => {
        const incompletePrd = createPrd([createStory('US-001', 1, { passes: false })]);

        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(JSON.stringify(incompletePrd));

        let callCount = 0;
        mockSpawn.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            // First call fails with non-zero exit code
            return createMockChildProcess({
              output: 'Error occurred',
              errorOutput: 'Some error',
              exitCode: 1,
            });
          }
          // Second call succeeds with COMPLETE marker
          return createMockChildProcess({
            output: '<promise>COMPLETE</promise>',
            exitCode: 0,
          });
        });

        const result = await executeRalph('/test/project', { iterations: 5 });

        // First iteration fails but execution continues
        // Second iteration succeeds with COMPLETE marker
        expect(result.success).toBe(true);
        expect(result.completed).toBe(true);
        expect(result.iterationsUsed).toBe(2);
        expect(mockSpawn).toHaveBeenCalledTimes(2);
      });

      it('should handle spawn error gracefully', async () => {
        const prd = createPrd([createStory('US-001', 1, { passes: false })]);
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(JSON.stringify(prd));

        const mockProcess = createMockChildProcess({
          emitError: new Error('Spawn failed'),
        });
        mockSpawn.mockReturnValue(mockProcess);

        const result = await executeRalph('/test/project', { iterations: 1 });

        expect(result.success).toBe(false);
        expect(result.iterations[0].success).toBe(false);
        expect(result.iterations[0].errorOutput).toContain('Spawn failed');
      });

      it('should track exit codes in iteration results', async () => {
        const prd = createPrd([createStory('US-001', 1, { passes: false })]);
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(JSON.stringify(prd));

        const mockProcess = createMockChildProcess({
          output: 'Failed',
          exitCode: 1,
        });
        mockSpawn.mockReturnValue(mockProcess);

        const result = await executeRalph('/test/project', { iterations: 1 });

        expect(result.iterations[0].exitCode).toBe(1);
      });

      it('should capture stdout and stderr in iteration results', async () => {
        const prd = createPrd([createStory('US-001', 1, { passes: false })]);
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(JSON.stringify(prd));

        const mockProcess = createMockChildProcess({
          output: 'Standard output content',
          errorOutput: 'Standard error content',
          exitCode: 0,
        });
        mockSpawn.mockReturnValue(mockProcess);

        const result = await executeRalph('/test/project', { iterations: 1 });

        expect(result.iterations[0].output).toContain('Standard output content');
        expect(result.iterations[0].errorOutput).toContain('Standard error content');
      });

      it('should track duration for each iteration', async () => {
        const prd = createPrd([createStory('US-001', 1)]);
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(JSON.stringify(prd));

        const mockProcess = createMockChildProcess({
          output: '<promise>COMPLETE</promise>',
          exitCode: 0,
        });
        mockSpawn.mockReturnValue(mockProcess);

        const result = await executeRalph('/test/project');

        expect(result.iterations[0].durationMs).toBeGreaterThanOrEqual(0);
        expect(result.timeElapsedMs).toBeGreaterThanOrEqual(0);
      });
    });

    describe('Story progress tracking', () => {
      it('should track stories completed count', async () => {
        const prd = createPrd([
          createStory('US-001', 1, { passes: false }),
          createStory('US-002', 2, { passes: true }),
          createStory('US-003', 3, { passes: false }),
        ]);
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(JSON.stringify(prd));

        const mockProcess = createMockChildProcess({
          output: 'Work done',
          exitCode: 0,
        });
        mockSpawn.mockReturnValue(mockProcess);

        const result = await executeRalph('/test/project', { iterations: 1 });

        expect(result.totalStories).toBe(3);
        expect(result.storiesCompleted).toBe(1); // Only US-002 was already passing
      });
    });
  });

  describe('displaySummary', () => {
    it('should display sequential execution summary', () => {
      const result: RalphResult = {
        success: true,
        completed: true,
        iterationsUsed: 3,
        storiesCompleted: 5,
        totalStories: 5,
        timeElapsedMs: 120000,
        iterations: [],
      };

      // Should not throw
      expect(() => displaySummary(result)).not.toThrow();
      expect(mockConsoleLog).toHaveBeenCalled();
    });

    it('should display parallel execution summary', () => {
      const result: RalphResult = {
        success: true,
        completed: true,
        iterationsUsed: 2,
        storiesCompleted: 5,
        totalStories: 5,
        timeElapsedMs: 60000,
        iterations: [],
        parallel: {
          batchesExecuted: 2,
          maxConcurrencyAchieved: 3,
          storiesFailed: 0,
          storiesSkipped: 0,
          estimatedSequentialTimeMs: 150000,
          timeSavingsMs: 90000,
          timeSavingsPercent: 60,
          conflictStrategy: 'pessimistic',
          conflictsDetected: 0,
          conflictedFiles: [],
        },
      };

      // Should not throw
      expect(() => displaySummary(result)).not.toThrow();
      expect(mockConsoleLog).toHaveBeenCalled();
    });

    it('should display failure information when present', () => {
      const result: RalphResult = {
        success: false,
        completed: false,
        iterationsUsed: 10,
        storiesCompleted: 3,
        totalStories: 5,
        timeElapsedMs: 300000,
        error: 'Max iterations reached',
        iterations: [],
      };

      expect(() => displaySummary(result)).not.toThrow();
      expect(mockConsoleLog).toHaveBeenCalled();
    });

    it('should display parallel failure and skip information', () => {
      const result: RalphResult = {
        success: false,
        completed: false,
        iterationsUsed: 3,
        storiesCompleted: 2,
        totalStories: 5,
        timeElapsedMs: 90000,
        iterations: [],
        parallel: {
          batchesExecuted: 3,
          maxConcurrencyAchieved: 2,
          storiesFailed: 1,
          storiesSkipped: 2,
          estimatedSequentialTimeMs: 150000,
          timeSavingsMs: 60000,
          timeSavingsPercent: 40,
          conflictStrategy: 'pessimistic',
          conflictsDetected: 3,
          conflictedFiles: ['src/file1.ts', 'src/file2.ts', 'src/file3.ts'],
        },
      };

      expect(() => displaySummary(result)).not.toThrow();
      expect(mockConsoleLog).toHaveBeenCalled();
    });
  });
});
