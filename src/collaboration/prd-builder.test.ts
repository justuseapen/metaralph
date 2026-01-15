/**
 * Tests for prd-builder.ts - PRD Builder for interactive PRD creation through conversation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PrdBuilder,
  type UserStory,
  type Prd,
  type PrdBuildState,
  type PrdBuilderSession,
  type PrdBuildResult,
  type PrdBuildOptions,
} from './prd-builder.js';
import { ConversationRepository, type Message, type Conversation } from './conversation.js';
import { DiscussionEngine, type ProjectContext } from './discussion.js';
import { getProject, type Project } from '../registry/index.js';
import { TaskRepository, type Task } from '../queue/task.js';

// Use vi.hoisted to declare mocks that will be available in vi.mock factories
const { mockPrepare, mockRun, mockGet, mockAll, mockClose } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockRun: vi.fn(),
  mockGet: vi.fn(),
  mockAll: vi.fn(),
  mockClose: vi.fn(),
}));

// Mock uuid with incrementing IDs
let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: vi.fn(() => `mock-uuid-${++uuidCounter}`),
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

// Mock the discussion engine
vi.mock('./discussion.js', () => ({
  DiscussionEngine: {
    getProjectContext: vi.fn(),
  },
}));

// Mock the registry
vi.mock('../registry/index.js', () => ({
  getProject: vi.fn(),
}));

// Mock the task repository
vi.mock('../queue/task.js', () => ({
  TaskRepository: {
    create: vi.fn(),
  },
}));

describe('prd-builder.ts', () => {
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
    title: 'PRD: Test feature...',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const mockMessage: Message = {
    id: 'msg-123',
    conversationId: 'conv-123',
    role: 'assistant',
    content: 'I can help you create a PRD for this feature.',
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  const mockProjectContext: ProjectContext = {
    name: 'test-project',
    path: '/path/to/project',
    readme: '# Test Project README',
    structure: 'project/\n  src/\n  package.json',
    packageJson: { name: 'test-project', version: '1.0.0' },
  };

  const mockTask: Task = {
    id: 'task-123',
    projectId: 'project-123',
    type: 'feature',
    title: 'Test feature',
    source: 'conversation',
    priorityScore: 50,
    estimatedEffort: 'small',
    requiresApproval: false,
    approvalStatus: 'not_required',
    status: 'pending',
    prdJson: null,
    description: 'Test feature description',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  // Mock for Anthropic client
  let mockMessagesCreate: ReturnType<typeof vi.fn>;
  let createClientSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset uuid counter
    uuidCounter = 0;
    // Reset the mockPrepare to return our mock chain
    mockPrepare.mockReturnValue({
      run: mockRun,
      get: mockGet,
      all: mockAll,
    });
    mockRun.mockReturnValue({ changes: 1 });

    // Set up default mock returns
    vi.mocked(ConversationRepository.findById).mockReturnValue(mockConversation);
    vi.mocked(ConversationRepository.addMessage).mockReturnValue(mockMessage);
    vi.mocked(ConversationRepository.getMessages).mockReturnValue([]);
    vi.mocked(ConversationRepository.create).mockReturnValue(mockConversation);
    vi.mocked(getProject).mockReturnValue(mockProject);
    vi.mocked(DiscussionEngine.getProjectContext).mockReturnValue(mockProjectContext);
    vi.mocked(TaskRepository.create).mockResolvedValue(mockTask);

    // Set up Anthropic mock by spying on createClient
    mockMessagesCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'I can help you create a PRD for this feature.' }],
    });

    createClientSpy = vi.spyOn(PrdBuilder, 'createClient').mockReturnValue({
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

  describe('PrdBuilder.createClient', () => {
    beforeEach(() => {
      // Restore createClient for these specific tests
      createClientSpy.mockRestore();
    });

    it('should create an Anthropic client when API key is set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-api-key';

      const client = PrdBuilder.createClient();

      expect(client).toBeDefined();
    });

    it('should throw error when API key is not set', () => {
      delete process.env.ANTHROPIC_API_KEY;

      expect(() => PrdBuilder.createClient()).toThrow(
        'ANTHROPIC_API_KEY environment variable is required'
      );
    });
  });

  describe('PrdBuilder.start', () => {
    it('should return error when project is not found', async () => {
      vi.mocked(getProject).mockReturnValue(undefined);

      const result = await PrdBuilder.start('non-existent', 'Create a new feature');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Project not found');
    });

    it('should start a new PRD building session successfully', async () => {
      const result = await PrdBuilder.start('project-123', 'Create a new login feature');

      expect(result.success).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session?.projectId).toBe('project-123');
      expect(result.session?.state).toBe('refining_description');
      expect(result.response).toBeDefined();
      expect(result.message).toBe('PRD building session started');
    });

    it('should create conversation with truncated title', async () => {
      const longMessage = 'A'.repeat(100);

      await PrdBuilder.start('project-123', longMessage);

      expect(ConversationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-123',
          title: expect.stringContaining('PRD: '),
        }),
        expect.anything()
      );
    });

    it('should add user message to conversation', async () => {
      await PrdBuilder.start('project-123', 'Create a dashboard');

      expect(ConversationRepository.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'user',
          content: 'Create a dashboard',
        }),
        expect.anything()
      );
    });

    it('should add assistant response to conversation', async () => {
      await PrdBuilder.start('project-123', 'Create a dashboard');

      expect(ConversationRepository.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          content: expect.any(String),
        }),
        expect.anything()
      );
    });

    it('should return error when Claude returns no text response', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'tool-1', name: 'test', input: {} }],
      });

      const result = await PrdBuilder.start('project-123', 'Create a feature');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No text response from Claude');
    });

    it('should handle API errors gracefully', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('API rate limit exceeded'));

      const result = await PrdBuilder.start('project-123', 'Create a feature');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to start PRD building');
      expect(result.error).toContain('API rate limit exceeded');
    });

    it('should close database when not provided', async () => {
      await PrdBuilder.start('project-123', 'Create a feature');

      expect(mockClose).toHaveBeenCalled();
    });

    it('should not close database when provided', async () => {
      const mockDb = {
        prepare: mockPrepare,
        close: mockClose,
      };

      await PrdBuilder.start('project-123', 'Create a feature', {}, mockDb as any);

      expect(mockClose).not.toHaveBeenCalled();
    });

    it('should apply custom options', async () => {
      const options: PrdBuildOptions = {
        maxTokens: 4096,
        description: 'Custom description',
      };

      await PrdBuilder.start('project-123', 'Create a feature', options);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 4096,
        })
      );
    });

    it('should include project context in system prompt', async () => {
      await PrdBuilder.start('project-123', 'Create a feature');

      expect(DiscussionEngine.getProjectContext).toHaveBeenCalledWith(mockProject);
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining('test-project'),
        })
      );
    });
  });

  describe('PrdBuilder.continue', () => {
    let sessionId: string;

    beforeEach(async () => {
      // Start a session first
      const startResult = await PrdBuilder.start('project-123', 'Create a login feature');
      sessionId = startResult.session!.id;
    });

    it('should return error when session is not found', async () => {
      const result = await PrdBuilder.continue('non-existent-session', 'Continue building');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Session not found');
    });

    it('should return error when project is not found', async () => {
      vi.mocked(getProject).mockReturnValue(undefined);

      const result = await PrdBuilder.continue(sessionId, 'Continue building');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Project not found');
    });

    it('should continue PRD building session successfully', async () => {
      vi.mocked(getProject).mockReturnValue(mockProject);

      const result = await PrdBuilder.continue(sessionId, 'Add a password reset feature');

      expect(result.success).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.response).toBeDefined();
      expect(result.message).toBe('PRD building continued');
    });

    it('should add user message to conversation', async () => {
      vi.mocked(getProject).mockReturnValue(mockProject);

      await PrdBuilder.continue(sessionId, 'Continue with stories');

      expect(ConversationRepository.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'user',
          content: 'Continue with stories',
        }),
        expect.anything()
      );
    });

    it('should transition to creating_stories state when stories mentioned', async () => {
      vi.mocked(getProject).mockReturnValue(mockProject);

      const result = await PrdBuilder.continue(sessionId, 'Let us create user stories now');

      expect(result.session?.state).toBe('creating_stories');
    });

    it('should transition to reviewing state when review mentioned', async () => {
      vi.mocked(getProject).mockReturnValue(mockProject);

      // First transition to creating_stories
      await PrdBuilder.continue(sessionId, 'Let us create stories');

      const result = await PrdBuilder.continue(sessionId, 'This looks good, let us review');

      expect(result.session?.state).toBe('reviewing');
    });

    it('should finalize PRD when response contains PRD JSON', async () => {
      vi.mocked(getProject).mockReturnValue(mockProject);

      const prdResponse = `Here is your finalized PRD:
<prd>
{
  "project": "test-project",
  "branchName": "ralph/login-feature",
  "description": "Login feature implementation",
  "userStories": [
    {
      "id": "US-001",
      "title": "User login",
      "description": "As a user, I want to log in",
      "acceptanceCriteria": ["Login works", "Typecheck passes"],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}
</prd>`;

      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: prdResponse }],
      });

      const result = await PrdBuilder.continue(sessionId, 'Finalize the PRD');

      expect(result.success).toBe(true);
      expect(result.session?.state).toBe('finalized');
      expect(result.message).toBe('PRD finalized and task created');
      expect(result.task).toBeDefined();
    });

    it('should return error when Claude returns no text response', async () => {
      vi.mocked(getProject).mockReturnValue(mockProject);
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'tool-1', name: 'test', input: {} }],
      });

      const result = await PrdBuilder.continue(sessionId, 'Continue');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No text response from Claude');
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(getProject).mockReturnValue(mockProject);
      mockMessagesCreate.mockRejectedValue(new Error('Network error'));

      const result = await PrdBuilder.continue(sessionId, 'Continue');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to continue PRD building');
    });

    it('should close database when not provided', async () => {
      vi.mocked(getProject).mockReturnValue(mockProject);

      await PrdBuilder.continue(sessionId, 'Continue');

      expect(mockClose).toHaveBeenCalled();
    });

    it('should not close database when provided', async () => {
      vi.mocked(getProject).mockReturnValue(mockProject);
      const mockDb = {
        prepare: mockPrepare,
        close: mockClose,
      };

      mockClose.mockClear();

      await PrdBuilder.continue(sessionId, 'Continue', {}, mockDb as any);

      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe('PrdBuilder.buildPrd', () => {
    it('should return error when project is not found', async () => {
      vi.mocked(getProject).mockReturnValue(undefined);

      const result = await PrdBuilder.buildPrd('non-existent', 'Build a feature');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Project not found');
    });

    it('should build PRD successfully', async () => {
      const prdResponse = `<prd>
{
  "project": "test-project",
  "branchName": "ralph/test-feature",
  "description": "Test feature",
  "userStories": [
    {
      "id": "US-001",
      "title": "Test story",
      "description": "As a user, I want to test",
      "acceptanceCriteria": ["Test passes", "Typecheck passes"],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}
</prd>`;

      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: prdResponse }],
      });

      const result = await PrdBuilder.buildPrd('project-123', 'Build a test feature');

      expect(result.success).toBe(true);
      expect(result.prd).toBeDefined();
      expect(result.prd?.project).toBe('test-project');
      expect(result.prd?.userStories).toHaveLength(1);
    });

    it('should generate branch name when not provided in response', async () => {
      const prdResponse = `<prd>
{
  "project": "test-project",
  "description": "Test feature",
  "userStories": []
}
</prd>`;

      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: prdResponse }],
      });

      const result = await PrdBuilder.buildPrd('project-123', 'Build a test feature');

      expect(result.success).toBe(true);
      expect(result.prd?.branchName).toMatch(/^ralph\//);
    });

    it('should return error when Claude returns no text response', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'tool-1', name: 'test', input: {} }],
      });

      const result = await PrdBuilder.buildPrd('project-123', 'Build a feature');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No text response from Claude');
    });

    it('should return error when PRD cannot be parsed', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'I could not generate a valid PRD.' }],
      });

      const result = await PrdBuilder.buildPrd('project-123', 'Build a feature');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to parse PRD from AI response');
    });

    it('should handle API errors gracefully', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('API error'));

      const result = await PrdBuilder.buildPrd('project-123', 'Build a feature');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to build PRD');
    });

    it('should include project context in system prompt', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: '<prd>{"project":"test","branchName":"ralph/test","description":"test","userStories":[]}</prd>' }],
      });

      await PrdBuilder.buildPrd('project-123', 'Build a feature');

      expect(DiscussionEngine.getProjectContext).toHaveBeenCalledWith(mockProject);
    });

    it('should close database when not provided', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: '<prd>{"project":"test","branchName":"ralph/test","description":"test","userStories":[]}</prd>' }],
      });

      await PrdBuilder.buildPrd('project-123', 'Build a feature');

      expect(mockClose).toHaveBeenCalled();
    });

    it('should not close database when provided', async () => {
      const mockDb = {
        prepare: mockPrepare,
        close: mockClose,
      };

      mockClose.mockClear();

      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: '<prd>{"project":"test","branchName":"ralph/test","description":"test","userStories":[]}</prd>' }],
      });

      await PrdBuilder.buildPrd('project-123', 'Build a feature', {}, mockDb as any);

      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe('PrdBuilder.createTaskFromPrd', () => {
    it('should create a task from PRD', async () => {
      const prd: Prd = {
        project: 'test-project',
        branchName: 'ralph/login-feature',
        description: 'Login feature implementation',
        userStories: [
          {
            id: 'US-001',
            title: 'User login',
            description: 'As a user, I want to log in',
            acceptanceCriteria: ['Login works'],
            priority: 1,
            passes: false,
            notes: '',
          },
        ],
      };

      const task = await PrdBuilder.createTaskFromPrd(prd, 'project-123');

      expect(TaskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-123',
          type: 'feature',
          source: 'conversation',
          description: 'Login feature implementation',
        }),
        undefined
      );
      expect(task).toBeDefined();
    });

    it('should infer bug_fix task type from description', async () => {
      const prd: Prd = {
        project: 'test-project',
        branchName: 'ralph/fix-bug',
        description: 'Fix the login bug that causes errors',
        userStories: [],
      };

      await PrdBuilder.createTaskFromPrd(prd, 'project-123');

      expect(TaskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'bug_fix',
        }),
        undefined
      );
    });

    it('should infer test task type from description', async () => {
      const prd: Prd = {
        project: 'test-project',
        branchName: 'ralph/add-tests',
        description: 'Add test coverage for the auth module',
        userStories: [],
      };

      await PrdBuilder.createTaskFromPrd(prd, 'project-123');

      expect(TaskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'test',
        }),
        undefined
      );
    });

    it('should infer docs task type from description', async () => {
      const prd: Prd = {
        project: 'test-project',
        branchName: 'ralph/add-docs',
        description: 'Add documentation for the API',
        userStories: [],
      };

      await PrdBuilder.createTaskFromPrd(prd, 'project-123');

      expect(TaskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'docs',
        }),
        undefined
      );
    });

    it('should infer refactor task type from description', async () => {
      const prd: Prd = {
        project: 'test-project',
        branchName: 'ralph/refactor',
        description: 'Refactor the database layer to clean up the code',
        userStories: [],
      };

      await PrdBuilder.createTaskFromPrd(prd, 'project-123');

      expect(TaskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'refactor',
        }),
        undefined
      );
    });

    it('should infer quick_win effort for single story', async () => {
      const prd: Prd = {
        project: 'test-project',
        branchName: 'ralph/quick-win',
        description: 'Small improvement',
        userStories: [
          { id: 'US-001', title: 'Story 1', description: '', acceptanceCriteria: [], priority: 1, passes: false, notes: '' },
        ],
      };

      await PrdBuilder.createTaskFromPrd(prd, 'project-123');

      expect(TaskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          estimatedEffort: 'quick_win',
        }),
        undefined
      );
    });

    it('should infer small effort for 2-3 stories', async () => {
      const prd: Prd = {
        project: 'test-project',
        branchName: 'ralph/small',
        description: 'Small feature',
        userStories: [
          { id: 'US-001', title: 'Story 1', description: '', acceptanceCriteria: [], priority: 1, passes: false, notes: '' },
          { id: 'US-002', title: 'Story 2', description: '', acceptanceCriteria: [], priority: 2, passes: false, notes: '' },
        ],
      };

      await PrdBuilder.createTaskFromPrd(prd, 'project-123');

      expect(TaskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          estimatedEffort: 'small',
        }),
        undefined
      );
    });

    it('should infer medium effort for 4-5 stories', async () => {
      const prd: Prd = {
        project: 'test-project',
        branchName: 'ralph/medium',
        description: 'Medium feature',
        userStories: [
          { id: 'US-001', title: 'Story 1', description: '', acceptanceCriteria: [], priority: 1, passes: false, notes: '' },
          { id: 'US-002', title: 'Story 2', description: '', acceptanceCriteria: [], priority: 2, passes: false, notes: '' },
          { id: 'US-003', title: 'Story 3', description: '', acceptanceCriteria: [], priority: 3, passes: false, notes: '' },
          { id: 'US-004', title: 'Story 4', description: '', acceptanceCriteria: [], priority: 4, passes: false, notes: '' },
        ],
      };

      await PrdBuilder.createTaskFromPrd(prd, 'project-123');

      expect(TaskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          estimatedEffort: 'medium',
        }),
        undefined
      );
    });

    it('should infer large effort for 6+ stories', async () => {
      const prd: Prd = {
        project: 'test-project',
        branchName: 'ralph/large',
        description: 'Large feature',
        userStories: [
          { id: 'US-001', title: 'Story 1', description: '', acceptanceCriteria: [], priority: 1, passes: false, notes: '' },
          { id: 'US-002', title: 'Story 2', description: '', acceptanceCriteria: [], priority: 2, passes: false, notes: '' },
          { id: 'US-003', title: 'Story 3', description: '', acceptanceCriteria: [], priority: 3, passes: false, notes: '' },
          { id: 'US-004', title: 'Story 4', description: '', acceptanceCriteria: [], priority: 4, passes: false, notes: '' },
          { id: 'US-005', title: 'Story 5', description: '', acceptanceCriteria: [], priority: 5, passes: false, notes: '' },
          { id: 'US-006', title: 'Story 6', description: '', acceptanceCriteria: [], priority: 6, passes: false, notes: '' },
        ],
      };

      await PrdBuilder.createTaskFromPrd(prd, 'project-123');

      expect(TaskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          estimatedEffort: 'large',
        }),
        undefined
      );
    });
  });

  describe('PrdBuilder.getSession', () => {
    it('should return session when it exists', async () => {
      const startResult = await PrdBuilder.start('project-123', 'Create a feature');
      const sessionId = startResult.session!.id;

      const session = PrdBuilder.getSession(sessionId);

      expect(session).toBeDefined();
      expect(session?.id).toBe(sessionId);
    });

    it('should return undefined when session does not exist', () => {
      const session = PrdBuilder.getSession('non-existent');

      expect(session).toBeUndefined();
    });
  });

  describe('PrdBuilder.getSessionsForProject', () => {
    it('should return sessions for a project', async () => {
      await PrdBuilder.start('project-123', 'Create feature 1');
      await PrdBuilder.start('project-123', 'Create feature 2');

      const sessions = PrdBuilder.getSessionsForProject('project-123');

      expect(sessions).toHaveLength(2);
      expect(sessions[0].projectId).toBe('project-123');
      expect(sessions[1].projectId).toBe('project-123');
    });

    it('should return empty array when no sessions for project', () => {
      const sessions = PrdBuilder.getSessionsForProject('non-existent');

      expect(sessions).toHaveLength(0);
    });
  });

  describe('PrdBuilder.cancelSession', () => {
    it('should cancel an existing session', async () => {
      const startResult = await PrdBuilder.start('project-123', 'Create a feature');
      const sessionId = startResult.session!.id;

      const result = PrdBuilder.cancelSession(sessionId);

      expect(result).toBe(true);
      expect(PrdBuilder.getSession(sessionId)).toBeUndefined();
    });

    it('should return false when session does not exist', () => {
      const result = PrdBuilder.cancelSession('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('PRD parsing', () => {
    it('should parse PRD from response with prd tags', async () => {
      const prdResponse = `Here is the PRD:
<prd>
{
  "project": "test",
  "branchName": "ralph/test",
  "description": "Test",
  "userStories": []
}
</prd>`;

      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: prdResponse }],
      });

      const result = await PrdBuilder.buildPrd('project-123', 'Build a feature');

      expect(result.success).toBe(true);
      expect(result.prd).toBeDefined();
    });

    it('should parse PRD JSON even with extra whitespace', async () => {
      const prdResponse = `<prd>
        {
          "project": "test",
          "branchName": "ralph/test",
          "description": "Test",
          "userStories": []
        }
      </prd>`;

      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: prdResponse }],
      });

      const result = await PrdBuilder.buildPrd('project-123', 'Build a feature');

      expect(result.success).toBe(true);
    });

    it('should extract JSON object from malformed prd tags', async () => {
      const prdResponse = `<prd>
Some extra text before
{"project": "test", "branchName": "ralph/test", "description": "Test", "userStories": []}
Some extra text after
</prd>`;

      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: prdResponse }],
      });

      const result = await PrdBuilder.buildPrd('project-123', 'Build a feature');

      expect(result.success).toBe(true);
    });
  });

  describe('Type exports', () => {
    it('should export UserStory type correctly', () => {
      const story: UserStory = {
        id: 'US-001',
        title: 'Test story',
        description: 'As a user, I want to test',
        acceptanceCriteria: ['Criterion 1', 'Typecheck passes'],
        priority: 1,
        passes: false,
        notes: 'Some notes',
      };

      expect(story.id).toBe('US-001');
      expect(story.acceptanceCriteria).toHaveLength(2);
    });

    it('should export Prd type correctly', () => {
      const prd: Prd = {
        project: 'test-project',
        branchName: 'ralph/test',
        description: 'Test PRD',
        userStories: [],
      };

      expect(prd.project).toBe('test-project');
      expect(prd.userStories).toHaveLength(0);
    });

    it('should export PrdBuildState type correctly', () => {
      const states: PrdBuildState[] = ['initial', 'refining_description', 'creating_stories', 'reviewing', 'finalized'];

      expect(states).toContain('initial');
      expect(states).toContain('finalized');
    });

    it('should export PrdBuilderSession type correctly', () => {
      const session: PrdBuilderSession = {
        id: 'session-123',
        conversationId: 'conv-123',
        projectId: 'project-123',
        state: 'initial',
        currentPrd: { project: 'test' },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      expect(session.state).toBe('initial');
    });

    it('should export PrdBuildResult type correctly', () => {
      const successResult: PrdBuildResult = {
        success: true,
        message: 'Success',
      };

      const errorResult: PrdBuildResult = {
        success: false,
        error: 'Error message',
      };

      expect(successResult.success).toBe(true);
      expect(errorResult.success).toBe(false);
    });

    it('should export PrdBuildOptions type correctly', () => {
      const options: PrdBuildOptions = {
        description: 'Custom description',
        taskType: 'feature',
        effort: 'medium',
        maxTokens: 4096,
      };

      expect(options.maxTokens).toBe(4096);
    });
  });

  describe('Error handling', () => {
    it('should handle unknown errors in start gracefully', async () => {
      mockMessagesCreate.mockRejectedValue('Unknown error type');

      const result = await PrdBuilder.start('project-123', 'Create a feature');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to start PRD building');
    });

    it('should handle unknown errors in continue gracefully', async () => {
      vi.mocked(getProject).mockReturnValue(mockProject);
      const startResult = await PrdBuilder.start('project-123', 'Create a feature');
      mockMessagesCreate.mockRejectedValue('Unknown error type');

      const result = await PrdBuilder.continue(startResult.session!.id, 'Continue');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to continue PRD building');
    });

    it('should handle unknown errors in buildPrd gracefully', async () => {
      mockMessagesCreate.mockRejectedValue('Unknown error type');

      const result = await PrdBuilder.buildPrd('project-123', 'Build a feature');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to build PRD');
    });
  });
});
