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

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.resolve(__dirname, '../../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

/** Tab identifiers */
type TabId = 'queue' | 'approvals' | 'projects' | 'workers';

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
      <Box>
        <Text>Daemon: </Text>
        <Text color={statusColor}>{statusText}</Text>
        <Text dimColor>{uptimeText}</Text>
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
 * Placeholder component for tab content (will be implemented in US-016 and US-017)
 */
function TabContent({ tab }: { tab: TabId }): React.ReactElement {
  const contentMap: Record<TabId, string> = {
    queue: 'Task queue view - pending implementation (US-016)',
    approvals: 'Approvals view - pending implementation (US-016)',
    projects: 'Projects view - pending implementation (US-017)',
    workers: 'Workers view - pending implementation (US-017)',
  };

  return (
    <Box flexGrow={1} flexDirection="column" paddingX={1}>
      <Text dimColor>{contentMap[tab]}</Text>
      <Text dimColor>Press 1-4 to switch tabs, q to quit.</Text>
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
        <Text bold> 1</Text> Queue  |
        <Text bold> 2</Text> Approvals  |
        <Text bold> 3</Text> Projects  |
        <Text bold> 4</Text> Workers
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
