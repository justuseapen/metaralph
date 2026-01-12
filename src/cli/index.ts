#!/usr/bin/env node
/**
 * MetaRalph CLI - Command Line Interface
 *
 * Entry point for the MetaRalph CLI application using commander.
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDaemon, stopDaemon, getDaemonStatus, formatUptime } from '../daemon/index.js';
import { Logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';

// Get package.json path for version info
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.resolve(__dirname, '../../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

const program = new Command();

program
  .name('metaralph')
  .description('Autonomous multi-project orchestration engine built on Ralph')
  .version(packageJson.version, '-v, --version', 'Output the current version');

// Create logger for daemon operations
function createDaemonLogger(): Logger {
  const config = loadConfig();
  return new Logger({
    level: 'info',
    logFilePath: path.join(config.logsPath, 'daemon.log'),
  });
}

// Daemon lifecycle commands
program
  .command('start')
  .description('Start the MetaRalph daemon')
  .action(() => {
    const logger = createDaemonLogger();
    const result = startDaemon(logger);

    if (result.success) {
      console.log(`✓ ${result.message}`);
    } else {
      console.error(`✗ ${result.message}`);
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('Stop the MetaRalph daemon')
  .action(() => {
    const logger = createDaemonLogger();
    const result = stopDaemon(logger);

    if (result.success) {
      console.log(`✓ ${result.message}`);
    } else {
      console.error(`✗ ${result.message}`);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show the status of the MetaRalph daemon')
  .action(() => {
    const status = getDaemonStatus();

    if (status.running) {
      console.log('MetaRalph Daemon Status');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Status:     Running`);
      console.log(`PID:        ${status.pid}`);
      if (status.uptime !== null) {
        console.log(`Uptime:     ${formatUptime(status.uptime)}`);
      }
      if (status.startedAt) {
        console.log(`Started:    ${status.startedAt.toISOString()}`);
      }
    } else {
      console.log('MetaRalph Daemon Status');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Status:     Not running`);
    }
  });

// Project management commands
const projectsCommand = program
  .command('projects')
  .description('Manage projects registered with MetaRalph');

projectsCommand
  .command('list')
  .description('List all registered projects')
  .action(() => {
    console.log('Listing projects... (not yet implemented)');
  });

projectsCommand
  .command('add <path>')
  .description('Add a project to MetaRalph')
  .action((projectPath: string) => {
    console.log(`Adding project at ${projectPath}... (not yet implemented)`);
  });

projectsCommand
  .command('remove <id>')
  .description('Remove a project from MetaRalph')
  .action((id: string) => {
    console.log(`Removing project ${id}... (not yet implemented)`);
  });

// Default action for 'projects' (list when no subcommand)
projectsCommand.action(() => {
  console.log('Listing projects... (not yet implemented)');
});

// Group management commands
const groupsCommand = program
  .command('groups')
  .description('Manage project groups');

groupsCommand
  .command('list')
  .description('List all project groups')
  .action(() => {
    console.log('Listing groups... (not yet implemented)');
  });

groupsCommand
  .command('create <name>')
  .description('Create a new project group')
  .action((name: string) => {
    console.log(`Creating group ${name}... (not yet implemented)`);
  });

groupsCommand
  .command('add <group> <path>')
  .description('Add a project to a group')
  .action((group: string, projectPath: string) => {
    console.log(`Adding ${projectPath} to group ${group}... (not yet implemented)`);
  });

// Default action for 'groups' (list when no subcommand)
groupsCommand.action(() => {
  console.log('Listing groups... (not yet implemented)');
});

// Queue management command
program
  .command('queue')
  .description('View and manage the task queue')
  .action(() => {
    console.log('Task queue... (not yet implemented)');
  });

// Worker management command
program
  .command('workers')
  .description('View and manage worker processes')
  .action(() => {
    console.log('Workers status... (not yet implemented)');
  });

// Parse arguments and run
program.parse();
