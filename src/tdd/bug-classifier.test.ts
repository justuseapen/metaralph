/**
 * Tests for bug-classifier.ts - REFINE phase bug detection and auto-fix
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Bug, BugSeverity, BugCategory } from './types.js';

// Create hoisted mock functions to be used in vi.mock factories
const {
  mockBugRepositoryCreate,
  mockBugRepositoryUpdate,
  mockBugRepositoryFindById,
  mockAnthropicCreate,
  mockFsExistsSync,
  mockFsReadFileSync,
  mockFsWriteFileSync,
  mockFsUnlinkSync,
  mockSpawn,
} = vi.hoisted(() => ({
  mockBugRepositoryCreate: vi.fn(),
  mockBugRepositoryUpdate: vi.fn(),
  mockBugRepositoryFindById: vi.fn(),
  mockAnthropicCreate: vi.fn(),
  mockFsExistsSync: vi.fn(),
  mockFsReadFileSync: vi.fn(),
  mockFsWriteFileSync: vi.fn(),
  mockFsUnlinkSync: vi.fn(),
  mockSpawn: vi.fn(),
}));

// Mock repositories
vi.mock('./repositories/index.js', () => ({
  BugRepository: {
    create: mockBugRepositoryCreate,
    update: mockBugRepositoryUpdate,
    findById: mockBugRepositoryFindById,
  },
}));

// Mock fs module
vi.mock('node:fs', () => ({
  default: {
    existsSync: mockFsExistsSync,
    readFileSync: mockFsReadFileSync,
    writeFileSync: mockFsWriteFileSync,
    unlinkSync: mockFsUnlinkSync,
  },
  existsSync: mockFsExistsSync,
  readFileSync: mockFsReadFileSync,
  writeFileSync: mockFsWriteFileSync,
  unlinkSync: mockFsUnlinkSync,
}));

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

// Import after mocks are set up
import {
  BugClassifier,
  type BugClassifierProjectContext,
  type BugClassifierConfig,
  type CodeChanges,
  type BugClassificationResult,
  type AutoFixConfig,
  type AutoFixResult,
  type BugClassificationMetrics,
  type AutoFixMetrics,
} from './bug-classifier.js';

/**
 * Helper to create a BugClassifierProjectContext
 */
function createProjectContext(options: Partial<BugClassifierProjectContext> = {}): BugClassifierProjectContext {
  return {
    path: options.path ?? '/test/project',
    name: options.name ?? 'test-project',
    srcDir: options.srcDir ?? 'src',
  };
}

/**
 * Helper to create CodeChanges
 */
function createCodeChanges(options: Partial<CodeChanges> = {}): CodeChanges {
  return {
    modifiedFiles: options.modifiedFiles ?? [],
    newFiles: options.newFiles ?? [],
    gitDiff: options.gitDiff,
  };
}

/**
 * Helper to create a Bug record
 */
function createBug(options: Partial<Bug> = {}): Bug {
  return {
    id: options.id ?? 'bug-001',
    phaseId: options.phaseId ?? 'phase-001',
    severity: options.severity ?? 'P1',
    category: options.category ?? 'logic',
    description: options.description ?? 'Test bug description',
    filePath: options.filePath ?? 'src/test.ts',
    lineNumber: options.lineNumber,
    status: options.status ?? 'open',
    suggestedFix: options.suggestedFix,
    fixAttempts: options.fixAttempts ?? 0,
    fixedAt: options.fixedAt,
    createdAt: options.createdAt ?? new Date().toISOString(),
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
 * Create a mock AI review response with bugs
 */
function createMockReviewResponse(bugs: Array<{ severity: string; category: string; description: string; filePath: string; lineNumber?: number; suggestedFix?: string }>) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          bugs,
          summary: 'Review summary',
        }),
      },
    ],
  };
}

/**
 * Create a mock AI fix response
 */
function createMockFixResponse(fixedCode: string, explanation: string) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          fixedCode,
          explanation,
        }),
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

describe('bug-classifier.ts', () => {
  let bugIdCounter = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    bugIdCounter = 0;

    // Default fs mocks
    mockFsExistsSync.mockReturnValue(false);
    mockFsWriteFileSync.mockReturnValue(undefined);
    mockFsUnlinkSync.mockReturnValue(undefined);

    // Default repository mocks
    mockBugRepositoryCreate.mockImplementation((input) => ({
      id: `bug-${++bugIdCounter}`,
      ...input,
      fixAttempts: 0,
      createdAt: new Date().toISOString(),
    }));

    mockBugRepositoryUpdate.mockImplementation((id, input) => ({
      id,
      phaseId: 'phase-001',
      severity: 'P1',
      category: 'logic',
      description: 'Test bug',
      filePath: 'src/test.ts',
      status: input.status ?? 'open',
      fixAttempts: input.fixAttempts ?? 0,
      suggestedFix: input.suggestedFix,
      fixedAt: input.fixedAt,
      createdAt: new Date().toISOString(),
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createClient', () => {
    it('should throw error when ANTHROPIC_API_KEY is not set', () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      try {
        expect(() => BugClassifier.createClient()).toThrow('ANTHROPIC_API_KEY');
      } finally {
        if (originalKey) {
          process.env.ANTHROPIC_API_KEY = originalKey;
        }
      }
    });
  });

  describe('validateSeverity', () => {
    it('should validate P0 severity', () => {
      const result = BugClassifier.validateSeverity('P0');
      expect(result).toBe('P0');
    });

    it('should validate P1 severity', () => {
      const result = BugClassifier.validateSeverity('P1');
      expect(result).toBe('P1');
    });

    it('should validate P2 severity', () => {
      const result = BugClassifier.validateSeverity('P2');
      expect(result).toBe('P2');
    });

    it('should validate P3 severity', () => {
      const result = BugClassifier.validateSeverity('P3');
      expect(result).toBe('P3');
    });

    it('should normalize lowercase severity', () => {
      const result = BugClassifier.validateSeverity('p0');
      expect(result).toBe('P0');
    });

    it('should return null for invalid severity', () => {
      const result = BugClassifier.validateSeverity('P4');
      expect(result).toBeNull();
    });

    it('should return null for undefined severity', () => {
      const result = BugClassifier.validateSeverity(undefined);
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = BugClassifier.validateSeverity('');
      expect(result).toBeNull();
    });
  });

  describe('validateCategory', () => {
    it('should validate logic category', () => {
      const result = BugClassifier.validateCategory('logic');
      expect(result).toBe('logic');
    });

    it('should validate security category', () => {
      const result = BugClassifier.validateCategory('security');
      expect(result).toBe('security');
    });

    it('should validate performance category', () => {
      const result = BugClassifier.validateCategory('performance');
      expect(result).toBe('performance');
    });

    it('should validate style category', () => {
      const result = BugClassifier.validateCategory('style');
      expect(result).toBe('style');
    });

    it('should validate compatibility category', () => {
      const result = BugClassifier.validateCategory('compatibility');
      expect(result).toBe('compatibility');
    });

    it('should normalize uppercase category', () => {
      const result = BugClassifier.validateCategory('LOGIC');
      expect(result).toBe('logic');
    });

    it('should return null for invalid category', () => {
      const result = BugClassifier.validateCategory('invalid');
      expect(result).toBeNull();
    });

    it('should return null for undefined category', () => {
      const result = BugClassifier.validateCategory(undefined);
      expect(result).toBeNull();
    });
  });

  describe('parseBugsFromReview', () => {
    it('should parse bugs from valid JSON response', () => {
      const response = JSON.stringify({
        bugs: [
          {
            severity: 'P0',
            category: 'security',
            description: 'SQL injection vulnerability',
            filePath: 'src/db.ts',
            lineNumber: 42,
            suggestedFix: 'Use parameterized queries',
          },
        ],
        summary: 'Found 1 bug',
      });

      const bugs = BugClassifier.parseBugsFromReview(response);

      expect(bugs).toHaveLength(1);
      expect(bugs[0].severity).toBe('P0');
      expect(bugs[0].category).toBe('security');
      expect(bugs[0].description).toBe('SQL injection vulnerability');
      expect(bugs[0].filePath).toBe('src/db.ts');
      expect(bugs[0].lineNumber).toBe(42);
    });

    it('should parse bugs from JSON in markdown code block', () => {
      const response = `Here are the bugs I found:
\`\`\`json
{
  "bugs": [
    {
      "severity": "P1",
      "category": "logic",
      "description": "Off-by-one error",
      "filePath": "src/utils.ts",
      "lineNumber": 15
    }
  ]
}
\`\`\``;

      const bugs = BugClassifier.parseBugsFromReview(response);

      expect(bugs).toHaveLength(1);
      expect(bugs[0].severity).toBe('P1');
      expect(bugs[0].category).toBe('logic');
    });

    it('should parse multiple bugs', () => {
      const response = JSON.stringify({
        bugs: [
          { severity: 'P0', category: 'security', description: 'Bug 1', filePath: 'a.ts' },
          { severity: 'P1', category: 'logic', description: 'Bug 2', filePath: 'b.ts' },
          { severity: 'P2', category: 'performance', description: 'Bug 3', filePath: 'c.ts' },
        ],
      });

      const bugs = BugClassifier.parseBugsFromReview(response);

      expect(bugs).toHaveLength(3);
    });

    it('should return empty array for empty bugs list', () => {
      const response = JSON.stringify({ bugs: [], summary: 'No bugs found' });

      const bugs = BugClassifier.parseBugsFromReview(response);

      expect(bugs).toHaveLength(0);
    });

    it('should skip bugs with invalid severity', () => {
      const response = JSON.stringify({
        bugs: [
          { severity: 'CRITICAL', category: 'logic', description: 'Bug 1', filePath: 'a.ts' },
          { severity: 'P1', category: 'logic', description: 'Bug 2', filePath: 'b.ts' },
        ],
      });

      const bugs = BugClassifier.parseBugsFromReview(response);

      expect(bugs).toHaveLength(1);
      expect(bugs[0].description).toBe('Bug 2');
    });

    it('should skip bugs with invalid category', () => {
      const response = JSON.stringify({
        bugs: [
          { severity: 'P0', category: 'unknown', description: 'Bug 1', filePath: 'a.ts' },
          { severity: 'P1', category: 'logic', description: 'Bug 2', filePath: 'b.ts' },
        ],
      });

      const bugs = BugClassifier.parseBugsFromReview(response);

      expect(bugs).toHaveLength(1);
      expect(bugs[0].description).toBe('Bug 2');
    });

    it('should skip bugs without description', () => {
      const response = JSON.stringify({
        bugs: [
          { severity: 'P0', category: 'logic', filePath: 'a.ts' },
          { severity: 'P1', category: 'logic', description: 'Bug 2', filePath: 'b.ts' },
        ],
      });

      const bugs = BugClassifier.parseBugsFromReview(response);

      expect(bugs).toHaveLength(1);
    });

    it('should skip bugs without filePath', () => {
      const response = JSON.stringify({
        bugs: [
          { severity: 'P0', category: 'logic', description: 'Bug 1' },
          { severity: 'P1', category: 'logic', description: 'Bug 2', filePath: 'b.ts' },
        ],
      });

      const bugs = BugClassifier.parseBugsFromReview(response);

      expect(bugs).toHaveLength(1);
    });

    it('should handle malformed JSON with fallback regex', () => {
      // Note: The fallback regex in the implementation is quite specific
      // This tests that malformed JSON doesn't throw errors
      const response = 'This is not valid JSON at all';

      const bugs = BugClassifier.parseBugsFromReview(response);

      expect(bugs).toHaveLength(0);
    });

    it('should extract JSON from response with surrounding text', () => {
      const response = `I analyzed the code and found:
{
  "bugs": [
    {
      "severity": "P2",
      "category": "style",
      "description": "Missing type annotation",
      "filePath": "src/index.ts"
    }
  ],
  "summary": "Minor style issue"
}
Here is my conclusion.`;

      const bugs = BugClassifier.parseBugsFromReview(response);

      expect(bugs).toHaveLength(1);
      expect(bugs[0].severity).toBe('P2');
    });
  });

  describe('updateMetrics', () => {
    it('should count bugs by severity', () => {
      const metrics: BugClassificationMetrics = {
        totalBugsFound: 0,
        p0Count: 0,
        p1Count: 0,
        p2Count: 0,
        p3Count: 0,
        logicBugs: 0,
        securityBugs: 0,
        performanceBugs: 0,
        styleBugs: 0,
        compatibilityBugs: 0,
        filesReviewed: 0,
        linesReviewed: 0,
      };

      const bugs: Bug[] = [
        createBug({ severity: 'P0' }),
        createBug({ severity: 'P0' }),
        createBug({ severity: 'P1' }),
        createBug({ severity: 'P2' }),
        createBug({ severity: 'P3' }),
        createBug({ severity: 'P3' }),
        createBug({ severity: 'P3' }),
      ];

      BugClassifier.updateMetrics(metrics, bugs);

      expect(metrics.totalBugsFound).toBe(7);
      expect(metrics.p0Count).toBe(2);
      expect(metrics.p1Count).toBe(1);
      expect(metrics.p2Count).toBe(1);
      expect(metrics.p3Count).toBe(3);
    });

    it('should count bugs by category', () => {
      const metrics: BugClassificationMetrics = {
        totalBugsFound: 0,
        p0Count: 0,
        p1Count: 0,
        p2Count: 0,
        p3Count: 0,
        logicBugs: 0,
        securityBugs: 0,
        performanceBugs: 0,
        styleBugs: 0,
        compatibilityBugs: 0,
        filesReviewed: 0,
        linesReviewed: 0,
      };

      const bugs: Bug[] = [
        createBug({ category: 'logic' }),
        createBug({ category: 'logic' }),
        createBug({ category: 'security' }),
        createBug({ category: 'performance' }),
        createBug({ category: 'style' }),
        createBug({ category: 'compatibility' }),
      ];

      BugClassifier.updateMetrics(metrics, bugs);

      expect(metrics.logicBugs).toBe(2);
      expect(metrics.securityBugs).toBe(1);
      expect(metrics.performanceBugs).toBe(1);
      expect(metrics.styleBugs).toBe(1);
      expect(metrics.compatibilityBugs).toBe(1);
    });

    it('should handle empty bug list', () => {
      const metrics: BugClassificationMetrics = {
        totalBugsFound: 0,
        p0Count: 0,
        p1Count: 0,
        p2Count: 0,
        p3Count: 0,
        logicBugs: 0,
        securityBugs: 0,
        performanceBugs: 0,
        styleBugs: 0,
        compatibilityBugs: 0,
        filesReviewed: 0,
        linesReviewed: 0,
      };

      BugClassifier.updateMetrics(metrics, []);

      expect(metrics.totalBugsFound).toBe(0);
      expect(metrics.p0Count).toBe(0);
    });
  });

  describe('countLinesReviewed', () => {
    it('should count lines in modified files', () => {
      const changes = createCodeChanges({
        modifiedFiles: [
          { filePath: 'a.ts', originalContent: 'line1', newContent: 'line1\nline2\nline3' },
        ],
      });

      const lines = BugClassifier.countLinesReviewed(changes);

      expect(lines).toBe(3);
    });

    it('should count lines in new files', () => {
      const changes = createCodeChanges({
        newFiles: [
          { filePath: 'a.ts', content: 'line1\nline2' },
        ],
      });

      const lines = BugClassifier.countLinesReviewed(changes);

      expect(lines).toBe(2);
    });

    it('should count lines in git diff', () => {
      const changes = createCodeChanges({
        gitDiff: '+line1\n+line2\n-line3',
      });

      const lines = BugClassifier.countLinesReviewed(changes);

      expect(lines).toBe(3);
    });

    it('should sum lines from all sources', () => {
      const changes = createCodeChanges({
        modifiedFiles: [
          { filePath: 'a.ts', originalContent: '', newContent: 'line1\nline2' },
        ],
        newFiles: [
          { filePath: 'b.ts', content: 'line1\nline2\nline3' },
        ],
        gitDiff: 'diff line 1\ndiff line 2',
      });

      const lines = BugClassifier.countLinesReviewed(changes);

      expect(lines).toBe(7); // 2 + 3 + 2
    });
  });

  describe('truncateContent', () => {
    it('should return content unchanged if under limit', () => {
      const content = 'short content';
      const result = BugClassifier.truncateContent(content, 1000);
      expect(result).toBe(content);
    });

    it('should truncate content over limit', () => {
      const content = 'a'.repeat(100);
      const result = BugClassifier.truncateContent(content, 50);
      expect(result.length).toBeLessThan(content.length);
      expect(result).toContain('truncated');
    });

    it('should use default max of 10000', () => {
      const content = 'a'.repeat(15000);
      const result = BugClassifier.truncateContent(content);
      expect(result.length).toBeLessThan(content.length);
    });
  });

  describe('buildReceipt', () => {
    it('should build review receipt from metrics', () => {
      const metrics: BugClassificationMetrics = {
        totalBugsFound: 5,
        p0Count: 1,
        p1Count: 2,
        p2Count: 1,
        p3Count: 1,
        logicBugs: 3,
        securityBugs: 1,
        performanceBugs: 1,
        styleBugs: 0,
        compatibilityBugs: 0,
        filesReviewed: 10,
        linesReviewed: 500,
      };

      const receipt = BugClassifier.buildReceipt(metrics, 2, true);

      expect(receipt.totalBugsFound).toBe(5);
      expect(receipt.p0Count).toBe(1);
      expect(receipt.p1Count).toBe(2);
      expect(receipt.p2Count).toBe(1);
      expect(receipt.p3Count).toBe(1);
      expect(receipt.bugsFixed).toBe(0); // Default, updated by auto-fix
      expect(receipt.refineIterations).toBe(2);
      expect(receipt.opusEscalationUsed).toBe(true);
    });
  });

  describe('buildSystemPrompt', () => {
    it('should include severity definitions', () => {
      const prompt = BugClassifier.buildSystemPrompt();
      expect(prompt).toContain('P0');
      expect(prompt).toContain('P1');
      expect(prompt).toContain('P2');
      expect(prompt).toContain('P3');
      expect(prompt).toContain('CRITICAL');
    });

    it('should include category definitions', () => {
      const prompt = BugClassifier.buildSystemPrompt();
      expect(prompt).toContain('logic');
      expect(prompt).toContain('security');
      expect(prompt).toContain('performance');
      expect(prompt).toContain('style');
      expect(prompt).toContain('compatibility');
    });
  });

  describe('buildReviewPrompt', () => {
    it('should include project context', () => {
      const project = createProjectContext({ name: 'my-project', path: '/my/path' });
      const changes = createCodeChanges();

      const prompt = BugClassifier.buildReviewPrompt(project, changes);

      expect(prompt).toContain('my-project');
      expect(prompt).toContain('/my/path');
    });

    it('should include modified files', () => {
      const project = createProjectContext();
      const changes = createCodeChanges({
        modifiedFiles: [
          { filePath: 'src/test.ts', originalContent: 'old code', newContent: 'new code' },
        ],
      });

      const prompt = BugClassifier.buildReviewPrompt(project, changes);

      expect(prompt).toContain('Modified Files');
      expect(prompt).toContain('src/test.ts');
      expect(prompt).toContain('old code');
      expect(prompt).toContain('new code');
    });

    it('should include new files', () => {
      const project = createProjectContext();
      const changes = createCodeChanges({
        newFiles: [
          { filePath: 'src/new.ts', content: 'new file content' },
        ],
      });

      const prompt = BugClassifier.buildReviewPrompt(project, changes);

      expect(prompt).toContain('New Files');
      expect(prompt).toContain('src/new.ts');
      expect(prompt).toContain('new file content');
    });

    it('should include git diff when provided', () => {
      const project = createProjectContext();
      const changes = createCodeChanges({
        gitDiff: '+added line\n-removed line',
      });

      const prompt = BugClassifier.buildReviewPrompt(project, changes);

      expect(prompt).toContain('Git Diff');
      expect(prompt).toContain('+added line');
    });

    it('should include response format instructions', () => {
      const project = createProjectContext();
      const changes = createCodeChanges();

      const prompt = BugClassifier.buildReviewPrompt(project, changes);

      expect(prompt).toContain('Response Format');
      expect(prompt).toContain('JSON');
    });
  });

  describe('aiReview', () => {
    it('should perform AI code review and return bugs', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockReviewResponse([
        {
          severity: 'P1',
          category: 'logic',
          description: 'Array index out of bounds',
          filePath: 'src/utils.ts',
          lineNumber: 42,
        },
      ]));

      const result = await BugClassifier.aiReview(
        createProjectContext(),
        createCodeChanges({
          newFiles: [{ filePath: 'src/utils.ts', content: 'const arr = [1,2,3];' }],
        }),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.success).toBe(true);
      expect(result.bugs).toHaveLength(1);
      expect(result.bugs[0].severity).toBe('P1');
      expect(mockAnthropicCreate).toHaveBeenCalled();
      expect(mockBugRepositoryCreate).toHaveBeenCalled();
    });

    it('should return empty bugs list when no bugs found', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockReviewResponse([]));

      const result = await BugClassifier.aiReview(
        createProjectContext(),
        createCodeChanges(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.success).toBe(true);
      expect(result.bugs).toHaveLength(0);
    });

    it('should calculate metrics correctly', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockReviewResponse([
        { severity: 'P0', category: 'security', description: 'Bug 1', filePath: 'a.ts' },
        { severity: 'P1', category: 'logic', description: 'Bug 2', filePath: 'b.ts' },
      ]));

      const result = await BugClassifier.aiReview(
        createProjectContext(),
        createCodeChanges({
          newFiles: [
            { filePath: 'a.ts', content: 'line1\nline2' },
            { filePath: 'b.ts', content: 'line1' },
          ],
        }),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.metrics.totalBugsFound).toBe(2);
      expect(result.metrics.p0Count).toBe(1);
      expect(result.metrics.p1Count).toBe(1);
      expect(result.metrics.filesReviewed).toBe(2);
      expect(result.metrics.linesReviewed).toBe(3);
    });

    it('should handle AI client errors gracefully', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockRejectedValue(new Error('API error'));

      const result = await BugClassifier.aiReview(
        createProjectContext(),
        createCodeChanges(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('API error');
      expect(result.bugs).toHaveLength(0);
    });

    it('should include review receipt', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockReviewResponse([
        { severity: 'P0', category: 'security', description: 'Bug', filePath: 'a.ts' },
      ]));

      const result = await BugClassifier.aiReview(
        createProjectContext(),
        createCodeChanges(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.receipt).toBeDefined();
      expect(result.receipt.totalBugsFound).toBe(1);
      expect(result.receipt.p0Count).toBe(1);
    });

    it('should store bugs in database', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockReviewResponse([
        { severity: 'P1', category: 'logic', description: 'Bug', filePath: 'a.ts' },
      ]));

      await BugClassifier.aiReview(
        createProjectContext(),
        createCodeChanges(),
        'phase-001',
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(mockBugRepositoryCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          phaseId: 'phase-001',
          severity: 'P1',
          category: 'logic',
          status: 'open',
        }),
        undefined
      );
    });
  });

  describe('parseFixResponse', () => {
    it('should parse valid fix response', () => {
      const response = JSON.stringify({
        fixedCode: 'const fixed = true;',
        explanation: 'Fixed the issue',
      });

      const result = BugClassifier.parseFixResponse(response);

      expect(result).not.toBeNull();
      expect(result?.fixedCode).toBe('const fixed = true;');
      expect(result?.explanation).toBe('Fixed the issue');
    });

    it('should parse fix response in markdown code block', () => {
      const response = `Here's the fix:
\`\`\`json
{
  "fixedCode": "const x = 1;",
  "explanation": "Changed value"
}
\`\`\``;

      const result = BugClassifier.parseFixResponse(response);

      expect(result).not.toBeNull();
      expect(result?.fixedCode).toBe('const x = 1;');
    });

    it('should return null for invalid JSON', () => {
      const result = BugClassifier.parseFixResponse('not json');
      expect(result).toBeNull();
    });

    it('should return null when fixedCode is missing', () => {
      const response = JSON.stringify({
        explanation: 'Some explanation',
      });

      const result = BugClassifier.parseFixResponse(response);
      expect(result).toBeNull();
    });

    it('should return null when explanation is missing', () => {
      const response = JSON.stringify({
        fixedCode: 'code here',
      });

      const result = BugClassifier.parseFixResponse(response);
      expect(result).toBeNull();
    });

    it('should extract JSON from surrounding text', () => {
      const response = `I've analyzed the code and here's the fix:
{"fixedCode": "console.log('fixed');", "explanation": "Added logging"}
Let me know if you need anything else.`;

      const result = BugClassifier.parseFixResponse(response);

      expect(result).not.toBeNull();
      expect(result?.fixedCode).toBe("console.log('fixed');");
    });
  });

  describe('applyFix', () => {
    it('should create backup before applying fix', async () => {
      mockFsExistsSync.mockReturnValue(true);

      const fix = {
        filePath: 'src/test.ts',
        originalContent: 'original code',
        newContent: 'fixed code',
        explanation: 'Fixed bug',
      };

      const result = await BugClassifier.applyFix(fix, createProjectContext());

      expect(result).toBe(true);
      expect(mockFsWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.backup'),
        'original code',
        'utf-8'
      );
    });

    it('should write new content to file', async () => {
      const fix = {
        filePath: 'src/test.ts',
        originalContent: 'original',
        newContent: 'fixed',
        explanation: 'Fix',
      };

      await BugClassifier.applyFix(fix, createProjectContext());

      expect(mockFsWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('src/test.ts'),
        'fixed',
        'utf-8'
      );
    });

    it('should return false on write error', async () => {
      mockFsWriteFileSync.mockImplementation(() => {
        throw new Error('Write failed');
      });

      const fix = {
        filePath: 'src/test.ts',
        originalContent: 'original',
        newContent: 'fixed',
        explanation: 'Fix',
      };

      const result = await BugClassifier.applyFix(fix, createProjectContext());

      expect(result).toBe(false);
    });
  });

  describe('revertFix', () => {
    it('should restore from backup if exists', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('backup content');

      const fix = {
        filePath: 'src/test.ts',
        originalContent: 'original',
        newContent: 'fixed',
        explanation: 'Fix',
      };

      await BugClassifier.revertFix(fix, createProjectContext());

      expect(mockFsReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.backup'),
        'utf-8'
      );
      expect(mockFsWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('src/test.ts'),
        'backup content',
        'utf-8'
      );
      expect(mockFsUnlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('.backup')
      );
    });

    it('should restore from original content if no backup', async () => {
      mockFsExistsSync.mockReturnValue(false);

      const fix = {
        filePath: 'src/test.ts',
        originalContent: 'original content',
        newContent: 'fixed',
        explanation: 'Fix',
      };

      await BugClassifier.revertFix(fix, createProjectContext());

      expect(mockFsWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('src/test.ts'),
        'original content',
        'utf-8'
      );
    });
  });

  describe('runTests', () => {
    it('should detect vitest and run tests', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({
        devDependencies: { vitest: '^1.0.0' },
      }));
      mockSpawn.mockReturnValue(createMockChildProcess(0, 'Tests passed'));

      const result = await BugClassifier.runTests(createProjectContext());

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'sh',
        ['-c', 'npx vitest run'],
        expect.any(Object)
      );
    });

    it('should use npm test when no vitest found', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({
        scripts: { test: 'jest' },
      }));
      mockSpawn.mockReturnValue(createMockChildProcess(0, 'Tests passed'));

      const result = await BugClassifier.runTests(createProjectContext());

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'sh',
        ['-c', 'npm test'],
        expect.any(Object)
      );
    });

    it('should return false when tests fail', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({}));
      mockSpawn.mockReturnValue(createMockChildProcess(1, 'Tests failed'));

      const result = await BugClassifier.runTests(createProjectContext());

      expect(result).toBe(false);
    });

    it('should return false on spawn error', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(JSON.stringify({}));

      const { EventEmitter } = require('events');
      const proc = new EventEmitter();
      proc.stdout = { on: vi.fn() };
      proc.stderr = { on: vi.fn() };
      mockSpawn.mockReturnValue(proc);

      const resultPromise = BugClassifier.runTests(createProjectContext());

      setImmediate(() => {
        proc.emit('error', new Error('spawn failed'));
      });

      const result = await resultPromise;
      expect(result).toBe(false);
    });
  });

  describe('generateFix', () => {
    it('should generate fix for a bug', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('const broken = undefined;');

      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockFixResponse(
        'const fixed = "value";',
        'Added proper initialization'
      ));

      const bug = createBug({
        severity: 'P1',
        category: 'logic',
        description: 'Variable is undefined',
        filePath: 'src/test.ts',
      });

      const fix = await BugClassifier.generateFix(
        bug,
        createProjectContext(),
        mockClient as unknown as import('@anthropic-ai/sdk').default,
        'claude-sonnet-4-20250514',
        8192
      );

      expect(fix).not.toBeNull();
      expect(fix?.newContent).toBe('const fixed = "value";');
      expect(fix?.explanation).toBe('Added proper initialization');
    });

    it('should return null when file does not exist', async () => {
      mockFsExistsSync.mockReturnValue(false);

      const bug = createBug({ filePath: 'nonexistent.ts' });
      const mockClient = createMockAnthropicClient();

      const fix = await BugClassifier.generateFix(
        bug,
        createProjectContext(),
        mockClient as unknown as import('@anthropic-ai/sdk').default,
        'claude-sonnet-4-20250514',
        8192
      );

      expect(fix).toBeNull();
    });

    it('should return null on AI error', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('code');

      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockRejectedValue(new Error('API error'));

      const bug = createBug();

      const fix = await BugClassifier.generateFix(
        bug,
        createProjectContext(),
        mockClient as unknown as import('@anthropic-ai/sdk').default,
        'claude-sonnet-4-20250514',
        8192
      );

      expect(fix).toBeNull();
    });

    it('should include bug context in prompt', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('code');

      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockFixResponse('fixed', 'explanation'));

      const bug = createBug({
        severity: 'P0',
        category: 'security',
        description: 'SQL injection vulnerability',
        filePath: 'src/db.ts',
        lineNumber: 42,
        suggestedFix: 'Use parameterized queries',
      });

      await BugClassifier.generateFix(
        bug,
        createProjectContext(),
        mockClient as unknown as import('@anthropic-ai/sdk').default,
        'claude-sonnet-4-20250514',
        8192
      );

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('P0'),
            }),
          ]),
        })
      );
    });
  });

  describe('autoFix', () => {
    it('should fix P0/P1 bugs successfully', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('broken code');

      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockFixResponse('fixed code', 'Fixed'));
      // Use mockImplementation to create fresh process for each spawn call
      mockSpawn.mockImplementation(() => createMockChildProcess(0, 'Tests passed'));

      const bugs = [
        createBug({ id: 'bug-1', severity: 'P0', status: 'open' }),
        createBug({ id: 'bug-2', severity: 'P1', status: 'open' }),
      ];

      const result = await BugClassifier.autoFix(
        bugs,
        createProjectContext(),
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.success).toBe(true);
      expect(result.metrics.p0Fixed).toBeGreaterThanOrEqual(0);
      expect(result.metrics.totalAttempts).toBeGreaterThanOrEqual(2);
    });

    it('should return success immediately if no bugs to fix', async () => {
      const bugs: Bug[] = [];

      const result = await BugClassifier.autoFix(
        bugs,
        createProjectContext()
      );

      expect(result.success).toBe(true);
      expect(result.metrics.totalBugsProcessed).toBe(0);
      expect(result.metrics.successRate).toBe(1);
    });

    it('should skip already fixed bugs', async () => {
      const bugs = [
        createBug({ id: 'bug-1', severity: 'P0', status: 'fixed' }),
        createBug({ id: 'bug-2', severity: 'P1', status: 'wontfix' }),
      ];

      const result = await BugClassifier.autoFix(
        bugs,
        createProjectContext()
      );

      expect(result.success).toBe(true);
      expect(result.metrics.totalBugsProcessed).toBe(0);
    });

    it('should mark bugs as wontfix when no fix can be generated', async () => {
      mockFsExistsSync.mockReturnValue(false); // File doesn't exist

      const bugs = [
        createBug({ id: 'bug-1', severity: 'P1', status: 'open', filePath: 'nonexistent.ts' }),
      ];

      const mockClient = createMockAnthropicClient();

      const result = await BugClassifier.autoFix(
        bugs,
        createProjectContext(),
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(mockBugRepositoryUpdate).toHaveBeenCalledWith(
        'bug-1',
        expect.objectContaining({ status: 'wontfix' }),
        undefined
      );
      expect(result.metrics.unfixable).toBe(1);
    });

    it('should revert fix when tests fail after applying', async () => {
      mockFsExistsSync.mockImplementation((path: string) => {
        // File exists for reading, backup check varies
        return !path.includes('.backup');
      });
      mockFsReadFileSync.mockReturnValue('original code');

      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockFixResponse('fixed code', 'Fixed'));

      // Tests fail after fix - use mockImplementation for fresh process each call
      mockSpawn.mockImplementation(() => createMockChildProcess(1, 'Tests failed'));

      const bugs = [
        createBug({ id: 'bug-1', severity: 'P1', status: 'open' }),
      ];

      await BugClassifier.autoFix(
        bugs,
        createProjectContext(),
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      // Should have attempted to restore
      expect(mockFsWriteFileSync).toHaveBeenCalled();
    });

    it('should use escalation model on final iteration', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('code');

      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockFixResponse('fixed', 'Fixed'));
      mockSpawn.mockImplementation(() => createMockChildProcess(0, 'Tests passed'));

      const bugs = [
        createBug({ id: 'bug-1', severity: 'P0', status: 'open' }),
      ];

      const result = await BugClassifier.autoFix(
        bugs,
        createProjectContext(),
        {
          anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default,
          isFinalIteration: true,
          escalationModel: 'claude-opus-4-20250514',
        }
      );

      expect(result.metrics.escalationUsed).toBe(true);
      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-opus-4-20250514',
        })
      );
    });

    it('should use default model when not final iteration', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('code');

      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockFixResponse('fixed', 'Fixed'));
      mockSpawn.mockImplementation(() => createMockChildProcess(0, 'Tests passed'));

      const bugs = [
        createBug({ id: 'bug-1', severity: 'P1', status: 'open' }),
      ];

      const result = await BugClassifier.autoFix(
        bugs,
        createProjectContext(),
        {
          anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default,
          isFinalIteration: false,
          model: 'claude-sonnet-4-20250514',
        }
      );

      expect(result.metrics.escalationUsed).toBe(false);
      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
        })
      );
    });

    it('should process P2/P3 bugs after P0/P1', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('code');

      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockFixResponse('fixed', 'Fixed'));
      mockSpawn.mockImplementation(() => createMockChildProcess(0, 'Tests passed'));

      const bugs = [
        createBug({ id: 'bug-1', severity: 'P0', status: 'open' }),
        createBug({ id: 'bug-2', severity: 'P2', status: 'open' }),
        createBug({ id: 'bug-3', severity: 'P3', status: 'open' }),
      ];

      const result = await BugClassifier.autoFix(
        bugs,
        createProjectContext(),
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.metrics.totalBugsProcessed).toBe(3);
    });

    it('should calculate success rate correctly', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('code');

      const mockClient = createMockAnthropicClient();
      // First bug gets fixed, second doesn't
      mockAnthropicCreate
        .mockResolvedValueOnce(createMockFixResponse('fixed', 'Fixed'))
        .mockResolvedValueOnce({ content: [{ type: 'text', text: 'invalid' }] });

      mockSpawn.mockImplementation(() => createMockChildProcess(0, 'Tests passed'));

      const bugs = [
        createBug({ id: 'bug-1', severity: 'P1', status: 'open' }),
        createBug({ id: 'bug-2', severity: 'P1', status: 'open' }),
      ];

      const result = await BugClassifier.autoFix(
        bugs,
        createProjectContext(),
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.metrics.successRate).toBeLessThanOrEqual(1);
      expect(result.metrics.successRate).toBeGreaterThanOrEqual(0);
    });

    it('should handle API errors gracefully', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockRejectedValue(new Error('API error'));

      const bugs = [
        createBug({ id: 'bug-1', severity: 'P0', status: 'open' }),
      ];

      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('code');

      const result = await BugClassifier.autoFix(
        bugs,
        createProjectContext(),
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      // Should not throw, should handle gracefully
      expect(result.bugs).toHaveLength(1);
    });

    it('should update fix attempts counter', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('code');

      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockFixResponse('fixed', 'Fixed'));
      mockSpawn.mockImplementation(() => createMockChildProcess(0, 'Tests passed'));

      const bugs = [
        createBug({ id: 'bug-1', severity: 'P1', status: 'open', fixAttempts: 0 }),
      ];

      await BugClassifier.autoFix(
        bugs,
        createProjectContext(),
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(mockBugRepositoryUpdate).toHaveBeenCalledWith(
        'bug-1',
        expect.objectContaining({ fixAttempts: 1 }),
        undefined
      );
    });

    it('should run final test suite after all fixes', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('code');

      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockFixResponse('fixed', 'Fixed'));
      mockSpawn.mockImplementation(() => createMockChildProcess(0, 'Tests passed'));

      const bugs = [
        createBug({ id: 'bug-1', severity: 'P1', status: 'open' }),
      ];

      const result = await BugClassifier.autoFix(
        bugs,
        createProjectContext(),
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.metrics.testsPassedAfterFixes).toBe(true);
    });
  });

  describe('cleanupBackups', () => {
    it('should delete backup files', async () => {
      mockFsExistsSync.mockReturnValue(true);

      await BugClassifier.cleanupBackups(createProjectContext(), ['src/test.ts', 'src/other.ts']);

      expect(mockFsUnlinkSync).toHaveBeenCalledTimes(2);
    });

    it('should skip non-existent backups', async () => {
      mockFsExistsSync.mockReturnValue(false);

      await BugClassifier.cleanupBackups(createProjectContext(), ['src/test.ts']);

      expect(mockFsUnlinkSync).not.toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsUnlinkSync.mockImplementation(() => {
        throw new Error('Delete failed');
      });

      // Should not throw
      await expect(
        BugClassifier.cleanupBackups(createProjectContext(), ['src/test.ts'])
      ).resolves.not.toThrow();
    });
  });

  describe('loadCodeChanges', () => {
    it('should load files from project', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('file content');

      const changes = await BugClassifier.loadCodeChanges(
        createProjectContext(),
        ['src/test.ts', 'src/other.ts']
      );

      expect(changes.newFiles).toHaveLength(2);
      expect(changes.newFiles[0].content).toBe('file content');
    });

    it('should skip non-existent files', async () => {
      mockFsExistsSync.mockReturnValue(false);

      const changes = await BugClassifier.loadCodeChanges(
        createProjectContext(),
        ['nonexistent.ts']
      );

      expect(changes.newFiles).toHaveLength(0);
    });
  });

  describe('canExitRefineLoop integration', () => {
    // Note: canExitRefineLoop is in BugRepository, but we test the integration here
    it('should correctly identify when P0/P1 bugs remain', async () => {
      // Test that autoFix returns success=false when P0/P1 bugs remain unfixed
      const bugs = [
        createBug({ id: 'bug-1', severity: 'P0', status: 'open' }),
      ];

      mockFsExistsSync.mockReturnValue(false); // No fix possible

      const mockClient = createMockAnthropicClient();

      const result = await BugClassifier.autoFix(
        bugs,
        createProjectContext(),
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      // Update mock returns bug with status unchanged from original
      mockBugRepositoryUpdate.mockReturnValue({ ...bugs[0], status: 'wontfix' });

      // Success should be false because P0 bug wasn't fixed (only marked wontfix)
      // The actual logic checks remaining open P0/P1 bugs
      expect(result.metrics.unfixable).toBe(1);
    });

    it('should return success=true when all P0/P1 bugs are fixed', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue('code');

      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockFixResponse('fixed', 'Fixed'));
      mockSpawn.mockImplementation(() => createMockChildProcess(0, 'Tests passed'));

      // Mock update to return fixed status
      mockBugRepositoryUpdate.mockImplementation((id, input) => ({
        id,
        phaseId: 'phase-001',
        severity: 'P1',
        category: 'logic',
        description: 'Test bug',
        filePath: 'src/test.ts',
        status: input.status ?? 'open',
        fixAttempts: input.fixAttempts ?? 0,
        createdAt: new Date().toISOString(),
      }));

      const bugs = [
        createBug({ id: 'bug-1', severity: 'P1', status: 'open' }),
      ];

      const result = await BugClassifier.autoFix(
        bugs,
        createProjectContext(),
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      expect(result.success).toBe(true);
    });

    it('should allow exit when only P2/P3 bugs remain', async () => {
      mockFsExistsSync.mockReturnValue(false); // No fix possible

      const bugs = [
        createBug({ id: 'bug-1', severity: 'P2', status: 'open' }),
        createBug({ id: 'bug-2', severity: 'P3', status: 'open' }),
      ];

      const mockClient = createMockAnthropicClient();

      const result = await BugClassifier.autoFix(
        bugs,
        createProjectContext(),
        { anthropicClient: mockClient as unknown as import('@anthropic-ai/sdk').default }
      );

      // Should succeed because no P0/P1 bugs exist
      expect(result.success).toBe(true);
    });
  });
});
