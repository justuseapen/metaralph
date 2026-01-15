/**
 * MetaRalph Dashboard - Terminal UI using Ink
 *
 * Provides an interactive terminal interface to monitor and control MetaRalph.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDaemonStatus, formatUptime } from '../daemon/index.js';
import { QueueView } from './components/QueueView.js';
import { ApprovalView } from './components/ApprovalView.js';
import { ProjectsView } from './components/ProjectsView.js';
import { WorkersView } from './components/WorkersView.js';
import { DeploymentStatusBar } from './components/DeploymentNotifications.js';
import { ChatView } from './components/ChatView.js';
import { LoopsView } from './components/LoopsView.js';
import { HealthView } from './components/HealthView.js';
import { ErrorBoundary } from './components/LoadingStates.js';
import { initDatabase } from '../db/index.js';
import { NotificationRepository, type Notification } from '../notifications/index.js';
import {
  STATUS_COLORS,
  SEVERITY_COLORS,
  UI_COLORS,
  getSeverityColor as getSeverityColorFromScheme,
} from './components/ColorScheme.js';

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.resolve(__dirname, '../../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

/** Tab identifiers */
type TabId = 'queue' | 'approvals' | 'projects' | 'workers' | 'health' | 'chat' | 'loops';

/** Tab configuration */
interface Tab {
  id: TabId;
  label: string;
  shortcut: string;
}

const TABS: Tab[] = [
  { id: 'queue', label: 'Queue', shortcut: '1' },
  { id: 'loops', label: 'Loops', shortcut: '2' },
  { id: 'workers', label: 'Workers', shortcut: '3' },
  { id: 'chat', label: 'Chat', shortcut: '4' },
  { id: 'projects', label: 'Projects', shortcut: '5' },
  { id: 'health', label: 'Health', shortcut: '6' },
  { id: 'approvals', label: 'Approvals', shortcut: '7' },
];

/**
 * Badge counts for tabs that need attention indicators
 */
interface TabBadgeCounts {
  queue: number;      // Pending tasks
  approvals: number;  // Pending approvals
  workers: number;    // Running workers
  health: number;     // Critical alerts
}

/**
 * Get badge counts for all tabs from the database
 */
function getTabBadgeCounts(): TabBadgeCounts {
  const db = initDatabase();
  try {
    // Count pending tasks for Queue tab
    const pendingTasks = db.prepare(`
      SELECT COUNT(*) as count FROM tasks
      WHERE status = 'pending' OR status = 'queued'
    `).get() as { count: number };

    // Count pending approvals for Approvals tab
    const pendingApprovals = db.prepare(`
      SELECT COUNT(*) as count FROM tasks
      WHERE approval_status = 'pending' AND requires_approval = 1
    `).get() as { count: number };

    // Count running workers for Workers tab
    const runningWorkers = db.prepare(`
      SELECT COUNT(*) as count FROM workers
      WHERE status = 'running' OR status = 'busy'
    `).get() as { count: number };

    // Count critical alerts for Health tab
    let criticalAlerts = 0;
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'
    `).get();
    if (tableExists) {
      const alerts = db.prepare(`
        SELECT COUNT(*) as count FROM notifications
        WHERE severity = 'critical' AND read = 0
      `).get() as { count: number };
      criticalAlerts = alerts.count;
    }

    return {
      queue: pendingTasks.count,
      approvals: pendingApprovals.count,
      workers: runningWorkers.count,
      health: criticalAlerts,
    };
  } finally {
    db.close();
  }
}

/**
 * Notification counts for the notification bell
 */
interface NotificationCounts {
  pendingApprovals: number;
  failedTasks: number;
  criticalAlerts: number;
  total: number;
}

/**
 * Get notification counts from the database
 * Includes: pending approvals, failed tasks, critical alerts
 */
function getNotificationCounts(): NotificationCounts {
  const db = initDatabase();
  try {
    // Count pending approvals
    const pendingApprovals = db.prepare(`
      SELECT COUNT(*) as count FROM tasks
      WHERE approval_status = 'pending' AND requires_approval = 1
    `).get() as { count: number };

    // Count failed tasks
    const failedTasks = db.prepare(`
      SELECT COUNT(*) as count FROM tasks
      WHERE status = 'failed'
    `).get() as { count: number };

    // Count critical alerts (will be 0 until notifications table is created in US-126)
    let criticalAlerts = 0;
    // Check if notifications table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'
    `).get();
    if (tableExists) {
      const alerts = db.prepare(`
        SELECT COUNT(*) as count FROM notifications
        WHERE severity = 'critical' AND read = 0
      `).get() as { count: number };
      criticalAlerts = alerts.count;
    }

    const total = pendingApprovals.count + failedTasks.count + criticalAlerts;

    return {
      pendingApprovals: pendingApprovals.count,
      failedTasks: failedTasks.count,
      criticalAlerts,
      total,
    };
  } finally {
    db.close();
  }
}

/**
 * Notification bell component showing count of items needing attention
 */
function NotificationBell({ counts, onPress }: { counts: NotificationCounts; onPress?: () => void }): React.ReactElement {
  const hasNotifications = counts.total > 0;
  const bellColor = counts.criticalAlerts > 0 ? 'red' : counts.failedTasks > 0 ? 'yellow' : 'cyan';

  // Build tooltip showing breakdown
  const parts: string[] = [];
  if (counts.pendingApprovals > 0) parts.push(`${counts.pendingApprovals} approvals`);
  if (counts.failedTasks > 0) parts.push(`${counts.failedTasks} failed`);
  if (counts.criticalAlerts > 0) parts.push(`${counts.criticalAlerts} alerts`);
  const tooltip = parts.join(', ');

  return (
    <Box>
      <Text color={hasNotifications ? bellColor : 'gray'}>
        {hasNotifications ? '\u{1F514}' : '\u{1F515}'}
      </Text>
      {hasNotifications && (
        <>
          <Text bold color={bellColor}> {counts.total}</Text>
          {tooltip && <Text dimColor> ({tooltip})</Text>}
        </>
      )}
      <Text dimColor> [!]</Text>
    </Box>
  );
}

/**
 * Header component showing version and daemon status
 */
function Header(): React.ReactElement {
  const [daemonStatus, setDaemonStatus] = useState(getDaemonStatus());
  const [notificationCounts, setNotificationCounts] = useState<NotificationCounts>({ pendingApprovals: 0, failedTasks: 0, criticalAlerts: 0, total: 0 });

  // Refresh daemon status and notification counts periodically
  useEffect(() => {
    // Load notification counts immediately
    setNotificationCounts(getNotificationCounts());

    const interval = setInterval(() => {
      setDaemonStatus(getDaemonStatus());
      setNotificationCounts(getNotificationCounts());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const statusText = daemonStatus.running
    ? `Running (PID: ${daemonStatus.pid})`
    : 'Not running';
  const statusColor = daemonStatus.running ? 'green' : 'red';
  const uptimeText = daemonStatus.running && daemonStatus.uptime !== null
    ? ` | Uptime: ${formatUptime(daemonStatus.uptime)}`
    : '';

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="blue">MetaRalph Dashboard</Text>
        <Box>
          <NotificationBell counts={notificationCounts} />
          <Text>  v{packageJson.version}</Text>
        </Box>
      </Box>
      <Box justifyContent="space-between">
        <Box>
          <Text>Daemon: </Text>
          <Text color={statusColor}>{statusText}</Text>
          <Text dimColor>{uptimeText}</Text>
        </Box>
        <DeploymentStatusBar />
      </Box>
    </Box>
  );
}

/**
 * Get badge color for tab based on status - uses centralized ColorScheme
 */
function getBadgeColor(tabId: TabId, count: number): string | undefined {
  if (count === 0) return undefined;
  switch (tabId) {
    case 'queue':
      return STATUS_COLORS.completed;  // cyan - items ready
    case 'approvals':
      return STATUS_COLORS.warning;    // yellow - needs attention
    case 'workers':
      return STATUS_COLORS.running;    // green - active
    case 'health':
      return STATUS_COLORS.failed;     // red - critical
    default:
      return undefined;
  }
}

/**
 * Tab bar component for navigation with badge counts
 */
function TabBar({ activeTab, badgeCounts }: { activeTab: TabId; badgeCounts: TabBadgeCounts }): React.ReactElement {
  return (
    <Box paddingY={1} gap={2}>
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        // Get badge count for this tab (only certain tabs have badges)
        const badgeCount = (tab.id in badgeCounts)
          ? badgeCounts[tab.id as keyof TabBadgeCounts]
          : 0;
        const badgeColor = getBadgeColor(tab.id, badgeCount);

        return (
          <Box key={tab.id}>
            <Text
              color={isActive ? 'blue' : undefined}
              bold={isActive}
              inverse={isActive}
            >
              {' '}[{tab.shortcut}]{tab.label}
              {badgeCount > 0 && (
                <Text color={isActive ? undefined : badgeColor} bold>
                  {' '}({badgeCount})
                </Text>
              )}
              {' '}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Get user-friendly view name for error boundary display
 */
function getViewName(tab: TabId): string {
  switch (tab) {
    case 'queue':
      return 'Task Queue';
    case 'approvals':
      return 'Approvals';
    case 'projects':
      return 'Projects';
    case 'workers':
      return 'Workers';
    case 'health':
      return 'Health';
    case 'chat':
      return 'Chat';
    case 'loops':
      return 'Loops';
    default:
      return 'View';
  }
}

/**
 * Tab content component - renders the appropriate view for each tab
 * Each view is wrapped in an ErrorBoundary for graceful error handling
 */
function TabContent({ tab }: { tab: TabId }): React.ReactElement {
  const viewName = getViewName(tab);

  switch (tab) {
    case 'queue':
      return (
        <ErrorBoundary viewName={viewName}>
          <QueueView />
        </ErrorBoundary>
      );
    case 'approvals':
      return (
        <ErrorBoundary viewName={viewName}>
          <ApprovalView />
        </ErrorBoundary>
      );
    case 'projects':
      return (
        <ErrorBoundary viewName={viewName}>
          <ProjectsView />
        </ErrorBoundary>
      );
    case 'workers':
      return (
        <ErrorBoundary viewName={viewName}>
          <WorkersView />
        </ErrorBoundary>
      );
    case 'health':
      return (
        <ErrorBoundary viewName={viewName}>
          <HealthView />
        </ErrorBoundary>
      );
    case 'chat':
      return (
        <ErrorBoundary viewName={viewName}>
          <ChatView />
        </ErrorBoundary>
      );
    case 'loops':
      return (
        <ErrorBoundary viewName={viewName}>
          <LoopsView />
        </ErrorBoundary>
      );
    default:
      return (
        <Box flexGrow={1} flexDirection="column" paddingX={1}>
          <Text dimColor>Unknown tab</Text>
        </Box>
      );
  }
}

/**
 * Keyboard shortcut configuration by context
 */
interface ShortcutGroup {
  name: string;
  tabId: TabId | 'global';
  shortcuts: { key: string; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    name: 'Global',
    tabId: 'global',
    shortcuts: [
      { key: 'q', description: 'Quit dashboard' },
      { key: '?', description: 'Toggle help overlay' },
      { key: '!', description: 'Open notifications' },
      { key: '1-7', description: 'Switch tabs' },
    ],
  },
  {
    name: 'Queue',
    tabId: 'queue',
    shortcuts: [
      { key: '/', description: 'Search tasks' },
      { key: 'c', description: 'Create task' },
      { key: 'Tab', description: 'Cycle filters' },
      { key: '↑/↓', description: 'Navigate list' },
      { key: 'Enter', description: 'Open detail view' },
      { key: 'Esc', description: 'Go back / Clear' },
      { key: 'g/G', description: 'Jump to start/end' },
    ],
  },
  {
    name: 'Approvals',
    tabId: 'approvals',
    shortcuts: [
      { key: '↑/↓', description: 'Navigate list' },
      { key: 'a', description: 'Approve task' },
      { key: 'r', description: 'Reject task' },
    ],
  },
  {
    name: 'Projects',
    tabId: 'projects',
    shortcuts: [
      { key: '↑/↓', description: 'Navigate list' },
      { key: 'a', description: 'Add project' },
      { key: 'd', description: 'Delete project' },
      { key: 'Esc', description: 'Cancel' },
    ],
  },
  {
    name: 'Workers',
    tabId: 'workers',
    shortcuts: [
      { key: '↑/↓', description: 'Navigate list' },
      { key: 'Enter', description: 'Open detail view' },
      { key: '/', description: 'Search logs' },
      { key: 'n/N', description: 'Next/prev match' },
      { key: 'f', description: 'Filter by level' },
      { key: 'PgUp/PgDn', description: 'Scroll output' },
      { key: 'g/G', description: 'Jump to start/end' },
      { key: 'Esc', description: 'Go back' },
    ],
  },
  {
    name: 'Health',
    tabId: 'health',
    shortcuts: [
      { key: 'r', description: 'Refresh' },
      { key: '↑/↓', description: 'Navigate proposals' },
      { key: 'Enter', description: 'View proposal detail' },
      { key: 'a', description: 'Approve proposal' },
      { key: 'r', description: 'Reject proposal' },
      { key: 'Esc', description: 'Go back' },
    ],
  },
  {
    name: 'Chat',
    tabId: 'chat',
    shortcuts: [
      { key: 'p', description: 'Select project' },
      { key: 'Ctrl/Cmd+Enter', description: 'Submit message' },
      { key: '↑/↓', description: 'Scroll messages' },
      { key: 'PgUp/PgDn', description: 'Page scroll' },
      { key: 'g/G', description: 'Jump to start/end' },
      { key: '[/]', description: 'Switch conversation' },
      { key: 'Esc', description: 'Clear / Cancel' },
    ],
  },
  {
    name: 'Loops',
    tabId: 'loops',
    shortcuts: [
      { key: 'n', description: 'New loop' },
      { key: 'p', description: 'Pause loop' },
      { key: 'r', description: 'Resume loop' },
      { key: 's', description: 'Stop loop' },
      { key: '↑/↓', description: 'Navigate list' },
      { key: 'Enter', description: 'Open detail view' },
      { key: 'PgUp/PgDn', description: 'Scroll output' },
      { key: 'g/G', description: 'Jump to start/end' },
      { key: 'Esc', description: 'Go back' },
    ],
  },
];

/**
 * Shortcut help overlay component showing all keyboard shortcuts
 */
function ShortcutHelpOverlay({ activeTab, onClose }: { activeTab: TabId; onClose: () => void }): React.ReactElement {
  useInput((input, key) => {
    if (input === '?' || key.escape) {
      onClose();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="cyan">Keyboard Shortcuts</Text>
      </Box>

      <Box flexDirection="row" flexWrap="wrap" justifyContent="flex-start">
        {SHORTCUT_GROUPS.map((group) => {
          const isCurrentTab = group.tabId === activeTab;
          const isGlobal = group.tabId === 'global';
          const borderColor = isCurrentTab ? 'cyan' : isGlobal ? 'green' : 'gray';
          const labelColor = isCurrentTab ? 'cyan' : isGlobal ? 'green' : undefined;

          return (
            <Box
              key={group.name}
              flexDirection="column"
              borderStyle="single"
              borderColor={borderColor}
              paddingX={1}
              marginRight={1}
              marginBottom={1}
              minWidth={24}
            >
              <Text bold color={labelColor} inverse={isCurrentTab}>
                {' '}{group.name}{isCurrentTab ? ' (current)' : ''}{' '}
              </Text>
              {group.shortcuts.map((shortcut, idx) => (
                <Box key={idx}>
                  <Box minWidth={14}>
                    <Text bold color="yellow">{shortcut.key}</Text>
                  </Box>
                  <Text dimColor={!isCurrentTab && !isGlobal}>{shortcut.description}</Text>
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>

      <Box justifyContent="center" marginTop={1}>
        <Text dimColor>Press <Text bold>?</Text> or <Text bold>Esc</Text> to close</Text>
      </Box>
    </Box>
  );
}

/**
 * Get severity color - uses centralized ColorScheme
 */
function getSeverityColor(severity: string): string {
  return getSeverityColorFromScheme(severity);
}

/**
 * Format notification time relative to now
 */
function formatNotificationTime(createdAt: string): string {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now.getTime() - created.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return created.toLocaleDateString();
}

/**
 * Notification row component
 */
function NotificationRow({
  notification,
  isSelected,
}: {
  notification: Notification;
  isSelected: boolean;
}): React.ReactElement {
  const severityColor = getSeverityColor(notification.severity);
  const isUnread = !notification.read;

  return (
    <Box>
      <Text inverse={isSelected}>
        <Text color={severityColor} bold={isUnread}>
          {notification.severity === 'critical' ? '!' : notification.severity === 'warning' ? '*' : ' '}
        </Text>
        <Text bold={isUnread}> {notification.title.substring(0, 40).padEnd(40)} </Text>
        <Text dimColor={!isUnread}>{formatNotificationTime(notification.createdAt).padEnd(12)}</Text>
        {isUnread && <Text color="cyan"> [new]</Text>}
      </Text>
    </Box>
  );
}

/**
 * Notification list overlay component
 * Shows recent notifications with selection and mark read/dismiss functionality
 */
function NotificationListOverlay({
  counts,
  onClose,
}: {
  counts: NotificationCounts;
  onClose: () => void;
}): React.ReactElement {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  // Load notifications from database
  const loadNotifications = useCallback(() => {
    try {
      const recent = NotificationRepository.findRecent(50);
      setNotifications(recent);
    } catch {
      // Table might not exist yet
      setNotifications([]);
    }
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Handle marking notification as read
  const handleMarkRead = useCallback(() => {
    if (notifications.length === 0) return;
    const selected = notifications[selectedIndex];
    if (selected && !selected.read) {
      NotificationRepository.markAsRead(selected.id);
      loadNotifications();
    }
  }, [notifications, selectedIndex, loadNotifications]);

  // Handle dismissing (deleting) notification
  const handleDismiss = useCallback(() => {
    if (notifications.length === 0) return;
    const selected = notifications[selectedIndex];
    if (selected) {
      NotificationRepository.delete(selected.id);
      // Adjust selection if needed
      if (selectedIndex >= notifications.length - 1 && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      }
      loadNotifications();
    }
  }, [notifications, selectedIndex, loadNotifications]);

  useInput((input, key) => {
    if (input === '!' || key.escape) {
      onClose();
      return;
    }

    if (notifications.length === 0) return;

    // Arrow key navigation
    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      setSelectedIndex(Math.min(notifications.length - 1, selectedIndex + 1));
    }

    // Enter marks as read
    if (key.return) {
      handleMarkRead();
    }

    // 'd' dismisses notification
    if (input === 'd') {
      handleDismiss();
    }
  });

  // Calculate unread count
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Box>
          <Text bold color="cyan">Notifications</Text>
          <Text dimColor> ({notifications.length} items</Text>
          {unreadCount > 0 && <Text color="yellow">, {unreadCount} unread</Text>}
          <Text dimColor>)</Text>
        </Box>
        <Box>
          {counts.pendingApprovals > 0 && (
            <Text color="cyan" dimColor> {counts.pendingApprovals} approvals </Text>
          )}
          {counts.failedTasks > 0 && (
            <Text color="yellow" dimColor> {counts.failedTasks} failed </Text>
          )}
          {counts.criticalAlerts > 0 && (
            <Text color="red" dimColor> {counts.criticalAlerts} critical </Text>
          )}
        </Box>
      </Box>

      {/* Notification list */}
      <Box flexDirection="column" height={15}>
        {loading ? (
          <Text dimColor>Loading notifications...</Text>
        ) : notifications.length === 0 ? (
          <Box flexDirection="column">
            <Text dimColor>No notifications yet.</Text>
            <Text> </Text>
            <Text dimColor>
              Notifications appear when tasks complete, fail, or need approval.
            </Text>
          </Box>
        ) : (
          notifications.slice(0, 15).map((notification, index) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              isSelected={index === selectedIndex}
            />
          ))
        )}
      </Box>

      {/* Selected notification message preview */}
      {notifications.length > 0 && notifications[selectedIndex]?.message && (
        <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
          <Text dimColor wrap="truncate">
            {notifications[selectedIndex].message}
          </Text>
        </Box>
      )}

      {/* Footer with shortcuts */}
      <Box justifyContent="center" marginTop={1}>
        <Text dimColor>
          <Text bold>↑↓</Text> Navigate  |
          <Text bold> Enter</Text> Mark read  |
          <Text bold> d</Text> Dismiss  |
          <Text bold> !</Text>/<Text bold>Esc</Text> Close
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Context-specific shortcuts for each tab
 */
const TAB_SHORTCUTS: Record<TabId, { key: string; label: string }[]> = {
  queue: [
    { key: 'c', label: 'Create' },
    { key: '/', label: 'Search' },
    { key: 'Tab', label: 'Filter' },
    { key: 'Enter', label: 'Detail' },
  ],
  loops: [
    { key: 'n', label: 'New' },
    { key: 'p', label: 'Pause' },
    { key: 'r', label: 'Resume' },
    { key: 's', label: 'Stop' },
    { key: 'Enter', label: 'Detail' },
  ],
  workers: [
    { key: '/', label: 'Search' },
    { key: 'f', label: 'Filter' },
    { key: 'n/N', label: 'Next/Prev' },
    { key: 'Enter', label: 'Detail' },
  ],
  chat: [
    { key: 'p', label: 'Project' },
    { key: 'Ctrl+↵', label: 'Send' },
    { key: '↑/↓', label: 'Scroll' },
  ],
  projects: [
    { key: 'a', label: 'Add' },
    { key: 'd', label: 'Delete' },
    { key: '↑/↓', label: 'Navigate' },
  ],
  health: [
    { key: 'r', label: 'Refresh' },
    { key: 'a', label: 'Approve' },
    { key: 'r', label: 'Reject' },
    { key: 'Enter', label: 'Detail' },
  ],
  approvals: [
    { key: 'a', label: 'Approve' },
    { key: 'r', label: 'Reject' },
    { key: '↑/↓', label: 'Navigate' },
  ],
};

/**
 * Footer component showing keyboard shortcuts
 * Shows common shortcuts plus context-specific shortcuts for the active tab
 */
function Footer({ activeTab }: { activeTab: TabId }): React.ReactElement {
  const tabShortcuts = TAB_SHORTCUTS[activeTab] || [];

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text dimColor>
        {/* Common shortcuts always shown */}
        <Text bold>q</Text> Quit  |
        <Text bold> ?</Text> Help  |
        <Text bold> !</Text> Alerts
        {/* Context-specific shortcuts for active tab */}
        {tabShortcuts.length > 0 && (
          <>
            <Text>  |  </Text>
            {tabShortcuts.map((shortcut, idx) => (
              <React.Fragment key={shortcut.key}>
                <Text bold color="cyan">{shortcut.key}</Text>
                <Text>:{shortcut.label}</Text>
                {idx < tabShortcuts.length - 1 && <Text> </Text>}
              </React.Fragment>
            ))}
          </>
        )}
        {/* Tab numbers shown at the end */}
        <Text>  |  </Text>
        <Text bold>1-7</Text> Tabs
      </Text>
    </Box>
  );
}

/**
 * Main Dashboard component
 */
function Dashboard(): React.ReactElement {
  const { exit } = useApp();
  const [activeTab, setActiveTab] = useState<TabId>('queue');
  const [showHelp, setShowHelp] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationCounts, setNotificationCounts] = useState<NotificationCounts>({ pendingApprovals: 0, failedTasks: 0, criticalAlerts: 0, total: 0 });
  const [tabBadgeCounts, setTabBadgeCounts] = useState<TabBadgeCounts>({ queue: 0, approvals: 0, workers: 0, health: 0 });

  // Load notification counts, badge counts and refresh periodically
  useEffect(() => {
    setNotificationCounts(getNotificationCounts());
    setTabBadgeCounts(getTabBadgeCounts());

    const interval = setInterval(() => {
      setNotificationCounts(getNotificationCounts());
      setTabBadgeCounts(getTabBadgeCounts());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useInput((input, key) => {
    // Handle help overlay toggle
    if (input === '?') {
      setShowHelp((prev) => !prev);
      return;
    }

    // Handle notifications overlay toggle
    if (input === '!') {
      setShowNotifications((prev) => !prev);
      return;
    }

    // Don't process other keys when help or notifications is open
    if (showHelp || showNotifications) {
      return;
    }

    // Handle quit
    if (input === 'q') {
      exit();
      return;
    }

    // Handle tab switching
    const tab = TABS.find((t) => t.shortcut === input);
    if (tab) {
      setActiveTab(tab.id);
    }
  });

  // Show help overlay when open
  if (showHelp) {
    return (
      <Box flexDirection="column" height="100%">
        <Header />
        <ShortcutHelpOverlay activeTab={activeTab} onClose={() => setShowHelp(false)} />
      </Box>
    );
  }

  // Show notifications overlay when open
  if (showNotifications) {
    return (
      <Box flexDirection="column" height="100%">
        <Header />
        <NotificationListOverlay counts={notificationCounts} onClose={() => setShowNotifications(false)} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      <Header />
      <TabBar activeTab={activeTab} badgeCounts={tabBadgeCounts} />
      <TabContent tab={activeTab} />
      <Footer activeTab={activeTab} />
    </Box>
  );
}

/**
 * Render the dashboard to the terminal
 */
export function startDashboard(): void {
  render(<Dashboard />);
}

export { Dashboard };
