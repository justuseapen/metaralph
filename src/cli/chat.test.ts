/**
 * Tests for chat.ts - Interactive chat and propose sessions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startChatSession, startProposeSession } from './chat.js';

// Mock dependencies
vi.mock('../registry/index.js', () => ({
  getProject: vi.fn(),
}));

vi.mock('../collaboration/discussion.js', () => ({
  DiscussionEngine: {
    startConversation: vi.fn(),
    respond: vi.fn(),
    getProjectContext: vi.fn(),
  },
}));

vi.mock('../collaboration/prd-builder.js', () => ({
  PrdBuilder: {
    start: vi.fn(),
    continue: vi.fn(),
  },
}));

vi.mock('../onboarding/index.js', () => ({
  OnboardingEngine: {
    preview: vi.fn(),
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}));

// Import mocked modules
import { getProject } from '../registry/index.js';
import { DiscussionEngine } from '../collaboration/discussion.js';
import { OnboardingEngine } from '../onboarding/index.js';

// OpportunityType from the analyzer
type OpportunityType = 'outdated_dep' | 'type_error' | 'lint_issue' | 'todo_comment';

// Helper to create mock opportunity with all required fields
const createMockOpportunity = (type: OpportunityType, title: string) => ({
  type,
  title,
  description: `Description for ${title}`,
  severity: 'medium' as const,
  suggestedTaskType: 'refactor' as const,
  suggestedEffort: 'small' as const,
});

// Helper to create mock todoSummary with all required fields
const createMockTodoSummary = (todo = 0, fixme = 0, xxx = 0, hack = 0) => ({
  TODO: todo,
  FIXME: fixme,
  XXX: xxx,
  HACK: hack,
  total: todo + fixme + xxx + hack,
});

describe('chat.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('startChatSession', () => {
    it('should throw error when project is not found', async () => {
      vi.mocked(getProject).mockReturnValue(undefined);

      await expect(startChatSession('non-existent-project')).rejects.toThrow(
        'Project not found: non-existent-project'
      );
    });

    it('should verify getProject is called with correct projectId', async () => {
      vi.mocked(getProject).mockReturnValue(undefined);

      try {
        await startChatSession('test-project-id');
      } catch {
        // Expected to throw
      }

      expect(getProject).toHaveBeenCalledWith('test-project-id');
    });
  });

  describe('startProposeSession', () => {
    const mockProject = {
      id: 'test-project-id',
      name: 'TestProject',
      path: '/path/to/project',
      group_id: null,
      deploy_config: null,
      added_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };

    it('should throw error when project is not found', async () => {
      vi.mocked(getProject).mockReturnValue(undefined);

      await expect(startProposeSession('non-existent-project', false)).rejects.toThrow(
        'Project not found: non-existent-project'
      );
    });

    it('should verify getProject is called with correct projectId', async () => {
      vi.mocked(getProject).mockReturnValue(undefined);

      try {
        await startProposeSession('test-project-id', false);
      } catch {
        // Expected to throw
      }

      expect(getProject).toHaveBeenCalledWith('test-project-id');
    });

    it('should call OnboardingEngine.preview when project exists', async () => {
      vi.mocked(getProject).mockReturnValue(mockProject);
      vi.mocked(OnboardingEngine.preview).mockResolvedValue({
        success: false,
        message: 'Analysis failed',
      });

      // Mock console.log and console.error to capture output
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await startProposeSession('test-project-id', false);

      expect(OnboardingEngine.preview).toHaveBeenCalledWith('/path/to/project');

      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should handle successful analysis with opportunities', async () => {
      vi.mocked(getProject).mockReturnValue(mockProject);
      vi.mocked(OnboardingEngine.preview).mockResolvedValue({
        success: true,
        message: 'Analysis complete',
        analysis: {
          opportunities: [
            createMockOpportunity('outdated_dep', 'Update package X'),
            createMockOpportunity('type_error', 'Fix type in Y'),
            createMockOpportunity('lint_issue', 'Lint error in Z'),
          ],
          todos: [],
          todoSummary: createMockTodoSummary(5, 2, 1, 0),
        },
      });
      vi.mocked(DiscussionEngine.getProjectContext).mockReturnValue({
        name: 'TestProject',
        path: '/path/to/project',
        readme: 'Test README content',
        structure: 'src/\n  index.ts',
        packageJson: { name: 'test-project' },
      });

      // Mock Anthropic API
      const mockAnthropicResponse = {
        content: [{ type: 'text', text: 'Here are improvement proposals...' }],
      };

      // We need to set ANTHROPIC_API_KEY for this test
      const originalApiKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-api-key';

      const Anthropic = await import('@anthropic-ai/sdk');
      vi.mocked(Anthropic.default).mockImplementation(
        () =>
          ({
            messages: {
              create: vi.fn().mockResolvedValue(mockAnthropicResponse),
            },
          }) as any
      );

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await startProposeSession('test-project-id', false);

      // Verify analysis summary was logged
      expect(consoleLogSpy).toHaveBeenCalled();
      expect(OnboardingEngine.preview).toHaveBeenCalled();

      // Restore
      process.env.ANTHROPIC_API_KEY = originalApiKey;
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should handle analysis failure gracefully', async () => {
      vi.mocked(getProject).mockReturnValue(mockProject);
      vi.mocked(OnboardingEngine.preview).mockResolvedValue({
        success: false,
        message: 'Unable to analyze project',
      });

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await startProposeSession('test-project-id', false);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Analysis failed: Unable to analyze project');

      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should throw when ANTHROPIC_API_KEY is not set', async () => {
      vi.mocked(getProject).mockReturnValue(mockProject);
      vi.mocked(OnboardingEngine.preview).mockResolvedValue({
        success: true,
        message: 'Analysis complete',
        analysis: {
          opportunities: [],
          todos: [],
          todoSummary: createMockTodoSummary(),
        },
      });
      vi.mocked(DiscussionEngine.getProjectContext).mockReturnValue({
        name: 'TestProject',
        path: '/path/to/project',
        readme: null,
        structure: null,
        packageJson: null,
      });

      // Remove ANTHROPIC_API_KEY
      const originalApiKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(startProposeSession('test-project-id', false)).rejects.toThrow(
        'ANTHROPIC_API_KEY environment variable is required'
      );

      // Restore
      process.env.ANTHROPIC_API_KEY = originalApiKey;
      consoleLogSpy.mockRestore();
    });
  });

  describe('PROPOSE_SYSTEM_PROMPT', () => {
    // Test that the system prompt constant is properly defined by verifying behavior
    it('should use appropriate system prompt for proposals', async () => {
      const mockProject = {
        id: 'test-id',
        name: 'test',
        path: '/test',
        group_id: null,
        deploy_config: null,
        added_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      };

      vi.mocked(getProject).mockReturnValue(mockProject);
      vi.mocked(OnboardingEngine.preview).mockResolvedValue({
        success: true,
        message: 'done',
        analysis: {
          opportunities: [],
          todos: [],
          todoSummary: createMockTodoSummary(),
        },
      });
      vi.mocked(DiscussionEngine.getProjectContext).mockReturnValue({
        name: 'test',
        path: '/test',
        readme: null,
        structure: null,
        packageJson: null,
      });

      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Proposals here' }],
      });

      const Anthropic = await import('@anthropic-ai/sdk');
      vi.mocked(Anthropic.default).mockImplementation(
        () =>
          ({
            messages: {
              create: mockCreate,
            },
          }) as any
      );

      const originalApiKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await startProposeSession('test-id', false);

      // Verify the Anthropic API was called with a system prompt
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining('MetaRalph'),
          model: expect.any(String),
          max_tokens: expect.any(Number),
        })
      );

      process.env.ANTHROPIC_API_KEY = originalApiKey;
      consoleSpy.mockRestore();
    });
  });
});
