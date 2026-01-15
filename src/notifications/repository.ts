/**
 * Notification Repository - Database operations for user notifications
 *
 * Provides CRUD operations for notifications.
 */

import { v4 as uuidv4 } from 'uuid';
import { initDatabase, type DatabaseInstance } from '../db/index.js';

/**
 * Notification type - the category of notification
 */
export type NotificationType =
  | 'task_complete'
  | 'task_failed'
  | 'loop_complete'
  | 'approval_needed'
  | 'alert';

/**
 * Notification severity level
 */
export type NotificationSeverity = 'info' | 'warning' | 'critical';

/**
 * Represents a notification
 */
export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string | null;
  severity: NotificationSeverity;
  read: boolean;
  createdAt: string;
}

/**
 * Database row for notifications table (snake_case)
 */
interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string | null;
  severity: string;
  read: number;
  created_at: string;
}

/**
 * Input for creating a new notification
 */
export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  message?: string;
  severity?: NotificationSeverity;
}

/**
 * Convert database row to Notification interface
 */
function rowToNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    message: row.message,
    severity: row.severity as NotificationSeverity,
    read: row.read === 1,
    createdAt: row.created_at,
  };
}

/**
 * NotificationRepository - CRUD operations for notifications
 */
export const NotificationRepository = {
  /**
   * Create a new notification
   */
  create(input: CreateNotificationInput, db?: DatabaseInstance): Notification {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const id = uuidv4();
      const now = new Date().toISOString();

      database.prepare(`
        INSERT INTO notifications (
          id, type, title, message, severity, read, created_at
        )
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run(
        id,
        input.type,
        input.title,
        input.message ?? null,
        input.severity ?? 'info',
        now
      );

      return {
        id,
        type: input.type,
        title: input.title,
        message: input.message ?? null,
        severity: input.severity ?? 'info',
        read: false,
        createdAt: now,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find a notification by ID
   */
  findById(id: string, db?: DatabaseInstance): Notification | undefined {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const row = database.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as NotificationRow | undefined;
      return row ? rowToNotification(row) : undefined;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find all notifications, sorted by created_at DESC
   */
  findAll(db?: DatabaseInstance): Notification[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM notifications
        ORDER BY created_at DESC
      `).all() as NotificationRow[];
      return rows.map(rowToNotification);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find recent notifications, limited count
   */
  findRecent(limit: number = 50, db?: DatabaseInstance): Notification[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM notifications
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit) as NotificationRow[];
      return rows.map(rowToNotification);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find unread notifications
   */
  findUnread(db?: DatabaseInstance): Notification[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM notifications
        WHERE read = 0
        ORDER BY created_at DESC
      `).all() as NotificationRow[];
      return rows.map(rowToNotification);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find notifications by type
   */
  findByType(type: NotificationType, db?: DatabaseInstance): Notification[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM notifications
        WHERE type = ?
        ORDER BY created_at DESC
      `).all(type) as NotificationRow[];
      return rows.map(rowToNotification);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Find notifications by severity
   */
  findBySeverity(severity: NotificationSeverity, db?: DatabaseInstance): Notification[] {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const rows = database.prepare(`
        SELECT * FROM notifications
        WHERE severity = ?
        ORDER BY created_at DESC
      `).all(severity) as NotificationRow[];
      return rows.map(rowToNotification);
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Count unread notifications
   */
  countUnread(db?: DatabaseInstance): number {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const result = database.prepare(`
        SELECT COUNT(*) as count FROM notifications WHERE read = 0
      `).get() as { count: number };
      return result.count;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Count notifications by severity (unread only)
   */
  countBySeverity(severity: NotificationSeverity, db?: DatabaseInstance): number {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const result = database.prepare(`
        SELECT COUNT(*) as count FROM notifications WHERE severity = ? AND read = 0
      `).get(severity) as { count: number };
      return result.count;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Mark a notification as read
   */
  markAsRead(id: string, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const result = database.prepare(`
        UPDATE notifications SET read = 1 WHERE id = ?
      `).run(id);
      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Mark all notifications as read
   */
  markAllAsRead(db?: DatabaseInstance): number {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const result = database.prepare(`
        UPDATE notifications SET read = 1 WHERE read = 0
      `).run();
      return result.changes;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Delete a notification
   */
  delete(id: string, db?: DatabaseInstance): boolean {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const result = database.prepare('DELETE FROM notifications WHERE id = ?').run(id);
      return result.changes > 0;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Delete all read notifications
   */
  deleteRead(db?: DatabaseInstance): number {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const result = database.prepare('DELETE FROM notifications WHERE read = 1').run();
      return result.changes;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Delete old notifications (older than specified days)
   */
  deleteOld(days: number = 30, db?: DatabaseInstance): number {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      const result = database.prepare(`
        DELETE FROM notifications
        WHERE datetime(created_at) < datetime('now', '-' || ? || ' days')
      `).run(days);
      return result.changes;
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },
};
