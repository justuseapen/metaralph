/**
 * MetaRalph Dashboard - Terminal UI using Ink
 *
 * Provides an interactive terminal interface to monitor and control MetaRalph.
 */

import React, { useState, useEffect } from 'react';
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
  { id: 'approvals', label: 'Approvals', shortcut: '2' },
  { id: 'projects', label: 'Projects', shortcut: '3' },
  { id: 'workers', label: 'Workers', shortcut: '4' },
  { id: 'health', label: 'Health', shortcut: '5' },
  { id: 'chat', label: 'Chat', shortcut: '9' },
  { id: 'loops', label: 'Loops', shortcut: '0' },
];

/**
 * Header component showing version and daemon status
 */
function Header(): React.ReactElement {
  const [daemonStatus, setDaemonStatus] = useState(getDaemonStatus());

  // Refresh daemon status periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setDaemonStatus(getDaemonStatus());
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
        <Text>v{packageJson.version}</Text>
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
 * Tab bar component for navigation
 */
function TabBar({ activeTab }: { activeTab: TabId }): React.ReactElement {
  return (
    <Box paddingY={1} gap={2}>
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <Box key={tab.id}>
            <Text
              color={isActive ? 'blue' : undefined}
              bold={isActive}
              inverse={isActive}
            >
              {' '}[{tab.shortcut}]{tab.label} {' '}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Tab content component - renders the appropriate view for each tab
 */
function TabContent({ tab }: { tab: TabId }): React.ReactElement {
  switch (tab) {
    case 'queue':
      return <QueueView />;
    case 'approvals':
      return <ApprovalView />;
    case 'projects':
      return <ProjectsView />;
    case 'workers':
      return <WorkersView />;
    case 'health':
      return <HealthView />;
    case 'chat':
      return <ChatView />;
    case 'loops':
      return <LoopsView />;
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
      { key: '1-5,9,0', description: 'Switch tabs' },
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
 * Footer component showing keyboard shortcuts
 */
function Footer(): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text dimColor>
        <Text bold>q</Text> Quit  |
        <Text bold> ?</Text> Help  |
        <Text bold> 1</Text> Queue  |
        <Text bold> 2</Text> Approvals  |
        <Text bold> 3</Text> Projects  |
        <Text bold> 4</Text> Workers  |
        <Text bold> 5</Text> Health  |
        <Text bold> 9</Text> Chat  |
        <Text bold> 0</Text> Loops
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

  useInput((input) => {
    // Handle help overlay toggle
    if (input === '?') {
      setShowHelp((prev) => !prev);
      return;
    }

    // Don't process other keys when help is open
    if (showHelp) {
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

  return (
    <Box flexDirection="column" height="100%">
      <Header />
      <TabBar activeTab={activeTab} />
      <TabContent tab={activeTab} />
      <Footer />
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
