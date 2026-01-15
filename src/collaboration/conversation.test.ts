/**
 * Tests for conversation.ts - Conversation Model and Repository
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ConversationRepository,
  type Conversation,
  type Message,
  type CreateConversationInput,
  type AddMessageInput,
  type ConversationStatus,
  type MessageRole,
} from './conversation.js';

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-1234'),
}));

// Create mock database functions
const mockPrepare = vi.fn();
const mockRun = vi.fn();
const mockGet = vi.fn();
const mockAll = vi.fn();
const mockClose = vi.fn();

// Mock the database module
vi.mock('../db/index.js', () => ({
  initDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    close: mockClose,
  })),
}));

describe('conversation.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mockPrepare to return our mock chain
    mockPrepare.mockReturnValue({
      run: mockRun,
      get: mockGet,
      all: mockAll,
    });
    mockRun.mockReturnValue({ changes: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ConversationRepository.create', () => {
    it('should create a conversation with default status', () => {
      const input: CreateConversationInput = {
        projectId: 'project-123',
        title: 'Test Conversation',
      };

      const result = ConversationRepository.create(input);

      expect(result.id).toBe('mock-uuid-1234');
      expect(result.projectId).toBe('project-123');
      expect(result.title).toBe('Test Conversation');
      expect(result.status).toBe('active');
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO conversations'));
      expect(mockClose).toHaveBeenCalled();
    });

    it('should create a conversation with custom status', () => {
      const input: CreateConversationInput = {
        projectId: 'project-123',
        title: 'Test Conversation',
        status: 'completed',
      };

      const result = ConversationRepository.create(input);

      expect(result.status).toBe('completed');
    });

    it('should not close database when db is provided', () => {
      const mockDb = {
        prepare: mockPrepare,
        close: mockClose,
      };

      const input: CreateConversationInput = {
        projectId: 'project-123',
        title: 'Test Conversation',
      };

      ConversationRepository.create(input, mockDb as any);

      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe('ConversationRepository.findById', () => {
    it('should return conversation when found', () => {
      const mockRow = {
        id: 'conv-123',
        project_id: 'project-456',
        title: 'Found Conversation',
        status: 'active',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      };
      mockGet.mockReturnValue(mockRow);

      const result = ConversationRepository.findById('conv-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('conv-123');
      expect(result?.projectId).toBe('project-456');
      expect(result?.title).toBe('Found Conversation');
      expect(result?.status).toBe('active');
      expect(mockPrepare).toHaveBeenCalledWith('SELECT * FROM conversations WHERE id = ?');
      expect(mockClose).toHaveBeenCalled();
    });

    it('should return undefined when not found', () => {
      mockGet.mockReturnValue(undefined);

      const result = ConversationRepository.findById('non-existent');

      expect(result).toBeUndefined();
    });

    it('should not close database when db is provided', () => {
      const mockDb = {
        prepare: mockPrepare,
        close: mockClose,
      };
      mockGet.mockReturnValue(undefined);

      ConversationRepository.findById('conv-123', mockDb as any);

      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe('ConversationRepository.findByProject', () => {
    it('should return conversations for a project', () => {
      const mockRows = [
        {
          id: 'conv-1',
          project_id: 'project-123',
          title: 'Conv 1',
          status: 'active',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-02T00:00:00.000Z',
        },
        {
          id: 'conv-2',
          project_id: 'project-123',
          title: 'Conv 2',
          status: 'archived',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      ];
      mockAll.mockReturnValue(mockRows);

      const result = ConversationRepository.findByProject('project-123');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('conv-1');
      expect(result[1].id).toBe('conv-2');
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE project_id = ?'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY updated_at DESC'));
    });

    it('should return empty array when no conversations found', () => {
      mockAll.mockReturnValue([]);

      const result = ConversationRepository.findByProject('project-123');

      expect(result).toHaveLength(0);
    });
  });

  describe('ConversationRepository.findActive', () => {
    it('should return active conversations', () => {
      const mockRows = [
        {
          id: 'conv-1',
          project_id: 'project-123',
          title: 'Active Conv 1',
          status: 'active',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-02T00:00:00.000Z',
        },
      ];
      mockAll.mockReturnValue(mockRows);

      const result = ConversationRepository.findActive();

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('active');
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("WHERE status = 'active'"));
    });

    it('should return empty array when no active conversations', () => {
      mockAll.mockReturnValue([]);

      const result = ConversationRepository.findActive();

      expect(result).toHaveLength(0);
    });
  });

  describe('ConversationRepository.addMessage', () => {
    it('should add a message to a conversation', () => {
      const input: AddMessageInput = {
        conversationId: 'conv-123',
        role: 'user',
        content: 'Hello, world!',
      };

      const result = ConversationRepository.addMessage(input);

      expect(result.id).toBe('mock-uuid-1234');
      expect(result.conversationId).toBe('conv-123');
      expect(result.role).toBe('user');
      expect(result.content).toBe('Hello, world!');
      expect(result.createdAt).toBeDefined();
      // Should insert message AND update conversation timestamp
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO messages'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE conversations SET updated_at'));
    });

    it('should add assistant message', () => {
      const input: AddMessageInput = {
        conversationId: 'conv-123',
        role: 'assistant',
        content: 'Hi there!',
      };

      const result = ConversationRepository.addMessage(input);

      expect(result.role).toBe('assistant');
    });

    it('should add system message', () => {
      const input: AddMessageInput = {
        conversationId: 'conv-123',
        role: 'system',
        content: 'System notification',
      };

      const result = ConversationRepository.addMessage(input);

      expect(result.role).toBe('system');
    });
  });

  describe('ConversationRepository.getMessages', () => {
    it('should return messages for a conversation', () => {
      const mockRows = [
        {
          id: 'msg-1',
          conversation_id: 'conv-123',
          role: 'user',
          content: 'Hello',
          created_at: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 'msg-2',
          conversation_id: 'conv-123',
          role: 'assistant',
          content: 'Hi there!',
          created_at: '2024-01-01T00:00:01.000Z',
        },
      ];
      mockAll.mockReturnValue(mockRows);

      const result = ConversationRepository.getMessages('conv-123');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-1');
      expect(result[0].role).toBe('user');
      expect(result[1].id).toBe('msg-2');
      expect(result[1].role).toBe('assistant');
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE conversation_id = ?'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at ASC'));
    });

    it('should return empty array when no messages', () => {
      mockAll.mockReturnValue([]);

      const result = ConversationRepository.getMessages('conv-123');

      expect(result).toHaveLength(0);
    });
  });

  describe('ConversationRepository.getWithMessages', () => {
    it('should return conversation with messages', () => {
      const mockConversationRow = {
        id: 'conv-123',
        project_id: 'project-456',
        title: 'Test Conversation',
        status: 'active',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      };
      const mockMessageRows = [
        {
          id: 'msg-1',
          conversation_id: 'conv-123',
          role: 'user',
          content: 'Hello',
          created_at: '2024-01-01T00:00:00.000Z',
        },
      ];

      // First call is for findById (get), second is for getMessages (all)
      mockGet.mockReturnValue(mockConversationRow);
      mockAll.mockReturnValue(mockMessageRows);

      const result = ConversationRepository.getWithMessages('conv-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('conv-123');
      expect(result?.title).toBe('Test Conversation');
      expect(result?.messages).toHaveLength(1);
      expect(result?.messages[0].content).toBe('Hello');
    });

    it('should return undefined when conversation not found', () => {
      mockGet.mockReturnValue(undefined);

      const result = ConversationRepository.getWithMessages('non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('ConversationRepository.updateStatus', () => {
    it('should update conversation status successfully', () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = ConversationRepository.updateStatus('conv-123', 'archived');

      expect(result).toBe(true);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE conversations SET status = ?'));
    });

    it('should return false when conversation not found', () => {
      mockRun.mockReturnValue({ changes: 0 });

      const result = ConversationRepository.updateStatus('non-existent', 'archived');

      expect(result).toBe(false);
    });

    it('should update to completed status', () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = ConversationRepository.updateStatus('conv-123', 'completed');

      expect(result).toBe(true);
    });
  });

  describe('ConversationRepository.updateTitle', () => {
    it('should update conversation title successfully', () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = ConversationRepository.updateTitle('conv-123', 'New Title');

      expect(result).toBe(true);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE conversations SET title = ?'));
    });

    it('should return false when conversation not found', () => {
      mockRun.mockReturnValue({ changes: 0 });

      const result = ConversationRepository.updateTitle('non-existent', 'New Title');

      expect(result).toBe(false);
    });
  });

  describe('ConversationRepository.delete', () => {
    it('should delete conversation successfully', () => {
      mockRun.mockReturnValue({ changes: 1 });

      const result = ConversationRepository.delete('conv-123');

      expect(result).toBe(true);
      expect(mockPrepare).toHaveBeenCalledWith('DELETE FROM conversations WHERE id = ?');
    });

    it('should return false when conversation not found', () => {
      mockRun.mockReturnValue({ changes: 0 });

      const result = ConversationRepository.delete('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('Type exports', () => {
    it('should have correct MessageRole types', () => {
      const userRole: MessageRole = 'user';
      const assistantRole: MessageRole = 'assistant';
      const systemRole: MessageRole = 'system';

      expect(userRole).toBe('user');
      expect(assistantRole).toBe('assistant');
      expect(systemRole).toBe('system');
    });

    it('should have correct ConversationStatus types', () => {
      const active: ConversationStatus = 'active';
      const archived: ConversationStatus = 'archived';
      const completed: ConversationStatus = 'completed';

      expect(active).toBe('active');
      expect(archived).toBe('archived');
      expect(completed).toBe('completed');
    });
  });

  describe('Database connection handling', () => {
    it('should close database after create when no db provided', () => {
      const input: CreateConversationInput = {
        projectId: 'project-123',
        title: 'Test',
      };

      ConversationRepository.create(input);

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('should close database after findById when no db provided', () => {
      mockGet.mockReturnValue(undefined);

      ConversationRepository.findById('conv-123');

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('should close database after findByProject when no db provided', () => {
      mockAll.mockReturnValue([]);

      ConversationRepository.findByProject('project-123');

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('should close database after findActive when no db provided', () => {
      mockAll.mockReturnValue([]);

      ConversationRepository.findActive();

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('should close database after addMessage when no db provided', () => {
      ConversationRepository.addMessage({
        conversationId: 'conv-123',
        role: 'user',
        content: 'Test',
      });

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('should close database after getMessages when no db provided', () => {
      mockAll.mockReturnValue([]);

      ConversationRepository.getMessages('conv-123');

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('should close database after getWithMessages when no db provided', () => {
      mockGet.mockReturnValue(undefined);

      ConversationRepository.getWithMessages('conv-123');

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('should close database after updateStatus when no db provided', () => {
      mockRun.mockReturnValue({ changes: 0 });

      ConversationRepository.updateStatus('conv-123', 'archived');

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('should close database after updateTitle when no db provided', () => {
      mockRun.mockReturnValue({ changes: 0 });

      ConversationRepository.updateTitle('conv-123', 'New Title');

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('should close database after delete when no db provided', () => {
      mockRun.mockReturnValue({ changes: 0 });

      ConversationRepository.delete('conv-123');

      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });
});
