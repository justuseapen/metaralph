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
 * Footer component showing keyboard shortcuts
 */
function Footer(): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text dimColor>
        <Text bold>q</Text> Quit  |
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

  useInput((input) => {
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
