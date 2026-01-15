/**
 * Tests for discussion.ts - Discussion Engine for generating contextual responses
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import {
  DiscussionEngine,
  type ProjectContext,
  type DiscussionOptions,
  type DiscussionResult,
} from './discussion.js';
import { ConversationRepository, type Message, type Conversation } from './conversation.js';
import { getProject, type Project } from '../registry/index.js';

// Use vi.hoisted to declare mocks that will be available in vi.mock factories
const { mockPrepare, mockRun, mockGet, mockAll, mockClose } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockRun: vi.fn(),
  mockGet: vi.fn(),
  mockAll: vi.fn(),
  mockClose: vi.fn(),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-1234'),
}));

// Mock fs module
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

// Mock the database module
vi.mock('../db/index.js', () => ({
  initDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    close: mockClose,
  })),
}));

// Mock the conversation repository
vi.mock('./conversation.js', () => ({
  ConversationRepository: {
    findById: vi.fn(),
    create: vi.fn(),
    addMessage: vi.fn(),
    getMessages: vi.fn(),
  },
}));

// Mock the registry
vi.mock('../registry/index.js', () => ({
  getProject: vi.fn(),
}));

describe('discussion.ts', () => {
  const mockProject: Project = {
    id: 'project-123',
    name: 'test-project',
    path: '/path/to/project',
    group_id: null,
    deploy_config: null,
    added_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };

  const mockConversation: Conversation = {
    id: 'conv-123',
    projectId: 'project-123',
    title: 'Test Conversation',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const mockMessage: Message = {
    id: 'msg-123',
    conversationId: 'conv-123',
    role: 'assistant',
    content: 'Hello, I am MetaRalph!',
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  // Mock for Anthropic client
  let mockMessagesCreate: ReturnType<typeof vi.fn>;
  let createClientSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mockPrepare to return our mock chain
    mockPrepare.mockReturnValue({
      run: mockRun,
      get: mockGet,
      all: mockAll,
    });
    mockRun.mockReturnValue({ changes: 1 });

    // Set up default fs mocks
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue('');
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    // Set up default mock returns
    vi.mocked(ConversationRepository.findById).mockReturnValue(mockConversation);
    vi.mocked(ConversationRepository.addMessage).mockReturnValue(mockMessage);
    vi.mocked(ConversationRepository.getMessages).mockReturnValue([]);
    vi.mocked(ConversationRepository.create).mockReturnValue(mockConversation);
    vi.mocked(getProject).mockReturnValue(mockProject);

    // Set up Anthropic mock by spying on createClient
    mockMessagesCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Hello, I am MetaRalph!' }],
    });

    createClientSpy = vi.spyOn(DiscussionEngine, 'createClient').mockReturnValue({
      messages: {
        create: mockMessagesCreate,
      },
    } as any);

    // Set up environment
    process.env.ANTHROPIC_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('DiscussionEngine.createClient', () => {
    beforeEach(() => {
      // Restore createClient for these specific tests
      createClientSpy.mockRestore();
    });

    it('should create an Anthropic client when API key is set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-api-key';

      const client = DiscussionEngine.createClient();

      expect(client).toBeDefined();
    });

    it('should throw error when API key is not set', () => {
      delete process.env.ANTHROPIC_API_KEY;

      expect(() => DiscussionEngine.createClient()).toThrow(
        'ANTHROPIC_API_KEY environment variable is required'
      );
    });
  });

  describe('DiscussionEngine.respond', () => {
    it('should return error when conversation is not found', async () => {
      vi.mocked(ConversationRepository.findById).mockReturnValue(undefined);

      const result = await DiscussionEngine.respond('non-existent', 'Hello');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Conversation not found');
    });

    it('should return error when project is not found', async () => {
      vi.mocked(getProject).mockReturnValue(undefined);

      const result = await DiscussionEngine.respond('conv-123', 'Hello');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Project not found');
    });

    it('should generate a response successfully', async () => {
      const userMessages: Message[] = [
        { id: 'msg-1', conversationId: 'conv-123', role: 'user', content: 'Hello', createdAt: '2024-01-01T00:00:00.000Z' },
      ];
      vi.mocked(ConversationRepository.getMessages).mockReturnValue(userMessages);

      const result = await DiscussionEngine.respond('conv-123', 'Hello');

      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
      expect(ConversationRepository.addMessage).toHaveBeenCalledTimes(2); // User message + assistant response
    });

    it('should return error when Claude returns no text response', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'tool-1', name: 'test', input: {} }],
      });

      const result = await DiscussionEngine.respond('conv-123', 'Hello');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No text response from Claude');
    });

    it('should handle API errors gracefully', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('API rate limit exceeded'));

      const result = await DiscussionEngine.respond('conv-123', 'Hello');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to generate response');
      expect(result.error).toContain('API rate limit exceeded');
    });

    it('should close database when not provided', async () => {
      await DiscussionEngine.respond('conv-123', 'Hello');

      expect(mockClose).toHaveBeenCalled();
    });

    it('should not close database when provided', async () => {
      const mockDb = {
        prepare: mockPrepare,
        close: mockClose,
      };

      await DiscussionEngine.respond('conv-123', 'Hello', {}, mockDb as any);

      expect(mockClose).not.toHaveBeenCalled();
    });

    it('should apply custom options', async () => {
      const options: DiscussionOptions = {
        maxTokens: 1024,
        temperature: 0.5,
        includeReadme: false,
        includeStructure: false,
        includePackageJson: false,
        systemPrompt: 'Custom prompt',
      };

      await DiscussionEngine.respond('conv-123', 'Hello', options);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 1024,
        })
      );
    });
  });

  describe('DiscussionEngine.startConversation', () => {
    it('should return error when project is not found', async () => {
      vi.mocked(getProject).mockReturnValue(undefined);

      const result = await DiscussionEngine.startConversation('non-existent', 'Test', 'Hello');

      expect(result.conversation).toBeUndefined();
      expect(result.result.success).toBe(false);
      expect(result.result.error).toContain('Project not found');
    });

    it('should create conversation and generate response', async () => {
      const result = await DiscussionEngine.startConversation('project-123', 'Test Conversation', 'Hello');

      expect(result.conversation).toBeDefined();
      expect(result.conversation?.id).toBe('conv-123');
      expect(ConversationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-123',
          title: 'Test Conversation',
        }),
        expect.anything()
      );
    });

    it('should close database when not provided', async () => {
      await DiscussionEngine.startConversation('project-123', 'Test', 'Hello');

      expect(mockClose).toHaveBeenCalled();
    });

    it('should not close database when provided', async () => {
      const mockDb = {
        prepare: mockPrepare,
        close: mockClose,
      };

      await DiscussionEngine.startConversation('project-123', 'Test', 'Hello', {}, mockDb as any);

      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe('DiscussionEngine.getProjectContext', () => {
    it('should return project context with defaults', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([]);

      const context = DiscussionEngine.getProjectContext(mockProject);

      expect(context.name).toBe('test-project');
      expect(context.path).toBe('/path/to/project');
    });

    it('should include README when present', () => {
      vi.mocked(fs.existsSync).mockImplementation((filePath) => {
        return (filePath as string).endsWith('README.md');
      });
      vi.mocked(fs.readFileSync).mockReturnValue('# Test README');
      vi.mocked(fs.readdirSync).mockReturnValue([]);

      const context = DiscussionEngine.getProjectContext(mockProject);

      expect(context.readme).toBe('# Test README');
    });

    it('should truncate long READMEs', () => {
      const longReadme = 'a'.repeat(6000);
      vi.mocked(fs.existsSync).mockImplementation((filePath) => {
        return (filePath as string).endsWith('README.md');
      });
      vi.mocked(fs.readFileSync).mockReturnValue(longReadme);
      vi.mocked(fs.readdirSync).mockReturnValue([]);

      const context = DiscussionEngine.getProjectContext(mockProject);

      expect(context.readme?.length).toBeLessThan(6000);
      expect(context.readme).toContain('[... truncated ...]');
    });

    it('should include package.json when present', () => {
      vi.mocked(fs.existsSync).mockImplementation((filePath) => {
        return (filePath as string).endsWith('package.json');
      });
      vi.mocked(fs.readFileSync).mockReturnValue('{"name": "test-pkg", "version": "1.0.0"}');
      vi.mocked(fs.readdirSync).mockReturnValue([]);

      const context = DiscussionEngine.getProjectContext(mockProject);

      expect(context.packageJson).toEqual({ name: 'test-pkg', version: '1.0.0' });
    });

    it('should handle invalid JSON in package.json', () => {
      vi.mocked(fs.existsSync).mockImplementation((filePath) => {
        return (filePath as string).endsWith('package.json');
      });
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');
      vi.mocked(fs.readdirSync).mockReturnValue([]);

      const context = DiscussionEngine.getProjectContext(mockProject);

      expect(context.packageJson).toBeNull();
    });

    it('should exclude context when options are false', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('content');
      vi.mocked(fs.readdirSync).mockReturnValue([]);

      const context = DiscussionEngine.getProjectContext(mockProject, {
        includeReadme: false,
        includeStructure: false,
        includePackageJson: false,
      });

      expect(context.readme).toBeNull();
      expect(context.structure).toBeNull();
      expect(context.packageJson).toBeNull();
    });

    it('should include directory structure when enabled', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockImplementation(((dirPath: fs.PathLike) => {
        if (dirPath === '/path/to/project') {
          return [
            { name: 'src', isDirectory: () => true },
            { name: 'package.json', isDirectory: () => false },
          ];
        }
        return [];
      }) as unknown as typeof fs.readdirSync);

      const context = DiscussionEngine.getProjectContext(mockProject, {
        includeStructure: true,
      });

      expect(context.structure).toBeDefined();
      expect(context.structure).toContain('project/');
    });
  });

  describe('Project context building', () => {
    it('should try different README filename variations', () => {
      vi.mocked(fs.existsSync).mockImplementation((filePath) => {
        // Return true only for 'readme.md' (third option)
        return (filePath as string).endsWith('readme.md');
      });
      vi.mocked(fs.readFileSync).mockReturnValue('# lowercase readme');
      vi.mocked(fs.readdirSync).mockReturnValue([]);

      const context = DiscussionEngine.getProjectContext(mockProject);

      expect(context.readme).toBe('# lowercase readme');
    });

    it('should filter out node_modules and other build directories from structure', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockImplementation(((dirPath: fs.PathLike) => {
        if (dirPath === '/path/to/project') {
          return [
            { name: 'src', isDirectory: () => true },
            { name: 'node_modules', isDirectory: () => true },
            { name: 'dist', isDirectory: () => true },
            { name: '.git', isDirectory: () => true },
            { name: 'index.ts', isDirectory: () => false },
          ];
        }
        return [];
      }) as unknown as typeof fs.readdirSync);

      const context = DiscussionEngine.getProjectContext(mockProject, {
        includeStructure: true,
      });

      expect(context.structure).toContain('src/');
      expect(context.structure).toContain('index.ts');
      expect(context.structure).not.toContain('node_modules');
      expect(context.structure).not.toContain('dist');
      expect(context.structure).not.toContain('.git');
    });
  });

  describe('Message formatting', () => {
    it('should filter out non-user/assistant messages', async () => {
      const messages: Message[] = [
        { id: 'msg-1', conversationId: 'conv-123', role: 'user', content: 'Hello', createdAt: '2024-01-01T00:00:00.000Z' },
        { id: 'msg-2', conversationId: 'conv-123', role: 'system', content: 'System', createdAt: '2024-01-01T00:00:01.000Z' },
        { id: 'msg-3', conversationId: 'conv-123', role: 'assistant', content: 'Hi', createdAt: '2024-01-01T00:00:02.000Z' },
      ];
      vi.mocked(ConversationRepository.getMessages).mockReturnValue(messages);

      await DiscussionEngine.respond('conv-123', 'Follow up');

      // Check that system message was filtered out
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user' }),
            expect.objectContaining({ role: 'assistant' }),
          ]),
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should handle unknown errors gracefully', async () => {
      mockMessagesCreate.mockRejectedValue('Unknown error type');

      const result = await DiscussionEngine.respond('conv-123', 'Hello');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to generate response');
    });

    it('should handle fs.existsSync errors', () => {
      vi.mocked(fs.existsSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });
      vi.mocked(fs.readdirSync).mockReturnValue([]);

      // Should not throw, just return null for readme
      const context = DiscussionEngine.getProjectContext(mockProject);

      expect(context.readme).toBeNull();
    });

    it('should handle fs.readdirSync errors in directory structure', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const context = DiscussionEngine.getProjectContext(mockProject, {
        includeStructure: true,
      });

      // Should return just the project name when there's an error
      expect(context.structure).toContain('project/');
    });
  });

  describe('Type exports', () => {
    it('should export ProjectContext type correctly', () => {
      const context: ProjectContext = {
        name: 'test',
        path: '/test',
        readme: null,
        structure: null,
        packageJson: null,
      };

      expect(context.name).toBe('test');
    });

    it('should export DiscussionOptions type correctly', () => {
      const options: DiscussionOptions = {
        maxTokens: 2048,
        temperature: 0.7,
        includeReadme: true,
        includeStructure: true,
        includePackageJson: true,
        systemPrompt: 'Test prompt',
      };

      expect(options.maxTokens).toBe(2048);
    });

    it('should export DiscussionResult type correctly', () => {
      const result: DiscussionResult = {
        success: true,
        message: mockMessage,
      };

      expect(result.success).toBe(true);

      const errorResult: DiscussionResult = {
        success: false,
        error: 'Test error',
      };

      expect(errorResult.success).toBe(false);
    });
  });
});
