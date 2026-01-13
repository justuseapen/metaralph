/**
 * Conversation Model - Represents collaborative discussions about projects
 *
 * Conversations track discussions between users and MetaRalph about
 * project improvements, PRD creation, and other collaborative tasks.
 */

import { v4 as uuidv4 } from 'uuid';
import { initDatabase, type DatabaseInstance } from '../db/index.js';

/**
 * Role of the message sender
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Status of a conversation
 */
export type ConversationStatus = 'active' | 'archived' | 'completed';

/**
 * Represents a message within a conversation
 */
export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

/**
 * Represents a conversation thread for a project
 */
export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Database row representation for conversations (snake_case)
 */
interface ConversationRow {
  id: string;
  project_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Database row representation for messages (snake_case)
 */
interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
}

/**
 * Input for creating a new conversation
 */
export interface CreateConversationInput {
  projectId: string;
  title: string;
  status?: ConversationStatus;
}

/**
 * Input for adding a message to a conversation
 */
export interface AddMessageInput {
  conversationId: string;
  role: MessageRole;
  content: string;
}

/**
 * Conversation with its messages included
 */
export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

/**
 * Convert database row to Conversation interface
 */
function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status as ConversationStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Convert database row to Message interface
 */
function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as MessageRole,
    content: row.content,
    createdAt: row.created_at,
  };
}

/**
 * ConversationRepository - CRUD operations for conversations and messages
 */
export const ConversationRepository = {
  /**
   * Create a new conversation
   */
  create(input: CreateConversationInput, db?: DatabaseInstance): Conversation {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const id = uuidv4();
      const now = new Date().toISOString();
      const status = input.status ?? 'active';

      database.prepare(`
        INSERT INTO conversations (id, project_id, title, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, input.projectId, input.title, status, now, now);

      return {
        id,
        projectId: input.projectId,
        title: input.title,
        status,
        createdAt: now,
        updatedAt: now,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find a conversation by ID
   */
  findById(id: string, db?: DatabaseInstance): Conversation | undefined {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const row = database.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined;
      return row ? rowToConversation(row) : undefined;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find all conversations for a project
   */
  findByProject(projectId: string, db?: DatabaseInstance): Conversation[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM conversations
        WHERE project_id = ?
        ORDER BY updated_at DESC
      `).all(projectId) as ConversationRow[];
      return rows.map(rowToConversation);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find active conversations (not archived or completed)
   */
  findActive(db?: DatabaseInstance): Conversation[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM conversations
        WHERE status = 'active'
        ORDER BY updated_at DESC
      `).all() as ConversationRow[];
      return rows.map(rowToConversation);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Add a message to a conversation
   */
  addMessage(input: AddMessageInput, db?: DatabaseInstance): Message {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const id = uuidv4();
      const now = new Date().toISOString();

      // Insert the message
      database.prepare(`
        INSERT INTO messages (id, conversation_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, input.conversationId, input.role, input.content, now);

      // Update conversation's updated_at timestamp
      database.prepare(`
        UPDATE conversations SET updated_at = ? WHERE id = ?
      `).run(now, input.conversationId);

      return {
        id,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        createdAt: now,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Get all messages in a conversation
   */
  getMessages(conversationId: string, db?: DatabaseInstance): Message[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
      `).all(conversationId) as MessageRow[];
      return rows.map(rowToMessage);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Get a conversation with all its messages
   */
  getWithMessages(conversationId: string, db?: DatabaseInstance): ConversationWithMessages | undefined {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const conversation = this.findById(conversationId, database);
      if (!conversation) {
        return undefined;
      }

      const messages = this.getMessages(conversationId, database);

      return {
        ...conversation,
        messages,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Update conversation status
   */
  updateStatus(id: string, status: ConversationStatus, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const now = new Date().toISOString();
      const result = database.prepare(`
        UPDATE conversations SET status = ?, updated_at = ?
        WHERE id = ?
      `).run(status, now, id);
      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Update conversation title
   */
  updateTitle(id: string, title: string, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const now = new Date().toISOString();
      const result = database.prepare(`
        UPDATE conversations SET title = ?, updated_at = ?
        WHERE id = ?
      `).run(title, now, id);
      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Delete a conversation and all its messages
   * (CASCADE delete handles messages automatically)
   */
  delete(id: string, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const result = database.prepare('DELETE FROM conversations WHERE id = ?').run(id);
      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },
};
