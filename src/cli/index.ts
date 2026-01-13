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
import { addProject, removeProject, listProjects, getProject as getProjectById } from '../registry/index.js';
import { OnboardingEngine } from '../onboarding/index.js';
import { createGroup, addToGroup, removeFromGroup, listGroups, deleteGroup } from '../registry/group.js';
import { TaskRepository } from '../queue/task.js';
import { ApprovalQueue } from '../queue/approval.js';
import { getProject } from '../registry/index.js';
import { ExecutionRepository } from '../workers/execution.js';
import { startDashboard } from './dashboard.js';
import { startChatSession, startProposeSession } from './chat.js';

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

// Dashboard command
program
  .command('dashboard')
  .description('Launch the interactive terminal UI dashboard')
  .action(() => {
    startDashboard();
  });

// Project management commands
const projectsCommand = program
  .command('projects')
  .description('Manage projects registered with MetaRalph');

/**
 * Display list of projects in a formatted table
 */
function displayProjectsList(): void {
  const projects = listProjects();

  if (projects.length === 0) {
    console.log('No projects registered.');
    console.log('Use "metaralph projects add <path>" to add a project.');
    return;
  }

  console.log('Registered Projects');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (const project of projects) {
    console.log(`ID:     ${project.id}`);
    console.log(`Name:   ${project.name}`);
    console.log(`Path:   ${project.path}`);
    if (project.group_id) {
      console.log(`Group:  ${project.group_id}`);
    }
    console.log(`Added:  ${project.added_at}`);
    console.log('──────────────────────────────────────────────────────────────');
  }

  console.log(`Total: ${projects.length} project(s)`);
}

projectsCommand
  .command('list')
  .description('List all registered projects')
  .action(() => {
    displayProjectsList();
  });

projectsCommand
  .command('add <path>')
  .description('Add a project to MetaRalph')
  .action((projectPath: string) => {
    const result = addProject(projectPath);

    if (result.success) {
      console.log(`✓ ${result.message}`);
      if (result.project) {
        console.log(`  ID:   ${result.project.id}`);
        console.log(`  Path: ${result.project.path}`);
      }
    } else {
      console.error(`✗ ${result.message}`);
      process.exit(1);
    }
  });

projectsCommand
  .command('remove <id>')
  .description('Remove a project from MetaRalph')
  .action((id: string) => {
    const result = removeProject(id);

    if (result.success) {
      console.log(`✓ ${result.message}`);
    } else {
      console.error(`✗ ${result.message}`);
      process.exit(1);
    }
  });

projectsCommand
  .command('analyze <id>')
  .description('Analyze a project and generate improvement proposals')
  .option('--preview', 'Preview analysis without creating tasks')
  .action(async (id: string, options: { preview?: boolean }) => {
    // First check if the project exists
    const project = getProjectById(id);
    if (!project) {
      console.error(`✗ Project not found: ${id}`);
      process.exit(1);
    }

    console.log(`Analyzing project: ${project.name}...`);
    console.log(`Path: ${project.path}`);
    console.log('');

    try {
      const result = options.preview
        ? await OnboardingEngine.preview(project.path)
        : await OnboardingEngine.analyze(id);

      if (result.success) {
        console.log(`✓ ${result.message}`);
        console.log('');

        if (result.analysis) {
          console.log('Analysis Summary');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

          // Group opportunities by type
          const byType = result.analysis.opportunities.reduce((acc, opp) => {
            acc[opp.type] = (acc[opp.type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);

          if (byType.outdated_dep) console.log(`  Outdated dependencies: ${byType.outdated_dep}`);
          if (byType.type_error) console.log(`  Type errors: ${byType.type_error}`);
          if (byType.lint_issue) console.log(`  Lint issues: ${byType.lint_issue}`);
          if (byType.todo_comment) console.log(`  TODO comments: ${byType.todo_comment}`);

          console.log('');
          console.log('TODO Summary');
          console.log(`  TODO:  ${result.analysis.todoSummary.TODO}`);
          console.log(`  FIXME: ${result.analysis.todoSummary.FIXME}`);
          console.log(`  XXX:   ${result.analysis.todoSummary.XXX}`);
          console.log(`  HACK:  ${result.analysis.todoSummary.HACK}`);
          console.log(`  Total: ${result.analysis.todoSummary.total}`);
        }

        if (result.proposals) {
          console.log('');
          console.log('Proposals Generated');
          console.log(`  Total opportunities: ${result.proposals.summary.totalOpportunities}`);
          console.log(`  Proposals generated: ${result.proposals.summary.proposalsGenerated}`);
          console.log(`  Tasks auto-queued:   ${result.proposals.summary.tasksAutoQueued}`);
          console.log(`  Pending approval:    ${result.proposals.summary.tasksPendingApproval}`);
        }

        if (options.preview) {
          console.log('');
          console.log('(Preview mode - no tasks were created)');
        }
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`✗ Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

// Default action for 'projects' (list when no subcommand)
projectsCommand.action(() => {
  displayProjectsList();
});

// Group management commands
const groupsCommand = program
  .command('groups')
  .description('Manage project groups');

/**
 * Display list of groups with their projects in a formatted table
 */
function displayGroupsList(): void {
  const groups = listGroups();

  if (groups.length === 0) {
    console.log('No groups created.');
    console.log('Use "metaralph groups create <name>" to create a group.');
    return;
  }

  console.log('Project Groups');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (const group of groups) {
    console.log(`Group:       ${group.name}`);
    console.log(`ID:          ${group.id}`);
    if (group.description) {
      console.log(`Description: ${group.description}`);
    }
    console.log(`Created:     ${group.created_at}`);

    if (group.projects.length > 0) {
      console.log(`Projects:    ${group.projects.length}`);
      for (const project of group.projects) {
        console.log(`  - ${project.name} (${project.path})`);
      }
    } else {
      console.log(`Projects:    (none)`);
    }
    console.log('──────────────────────────────────────────────────────────────');
  }

  console.log(`Total: ${groups.length} group(s)`);
}

groupsCommand
  .command('list')
  .description('List all project groups')
  .action(() => {
    displayGroupsList();
  });

groupsCommand
  .command('create <name>')
  .description('Create a new project group')
  .option('-d, --description <description>', 'Description for the group')
  .action((name: string, options: { description?: string }) => {
    const result = createGroup(name, options.description);

    if (result.success) {
      console.log(`✓ ${result.message}`);
      if (result.group) {
        console.log(`  ID: ${result.group.id}`);
      }
    } else {
      console.error(`✗ ${result.message}`);
      process.exit(1);
    }
  });

groupsCommand
  .command('add <group> <path>')
  .description('Add a project to a group')
  .action((group: string, projectPath: string) => {
    const result = addToGroup(group, projectPath);

    if (result.success) {
      console.log(`✓ ${result.message}`);
    } else {
      console.error(`✗ ${result.message}`);
      process.exit(1);
    }
  });

groupsCommand
  .command('remove <path>')
  .description('Remove a project from its group')
  .action((projectPath: string) => {
    const result = removeFromGroup(projectPath);

    if (result.success) {
      console.log(`✓ ${result.message}`);
    } else {
      console.error(`✗ ${result.message}`);
      process.exit(1);
    }
  });

groupsCommand
  .command('delete <group>')
  .description('Delete a group (projects will be unlinked but not deleted)')
  .action((group: string) => {
    const result = deleteGroup(group);

    if (result.success) {
      console.log(`✓ ${result.message}`);
    } else {
      console.error(`✗ ${result.message}`);
      process.exit(1);
    }
  });

// Default action for 'groups' (list when no subcommand)
groupsCommand.action(() => {
  displayGroupsList();
});

// Queue management commands
const queueCommand = program
  .command('queue')
  .description('View and manage the task queue');

/**
 * Display task queue in a formatted table
 */
function displayTaskQueue(): void {
  const tasks = TaskRepository.findPending();

  if (tasks.length === 0) {
    console.log('No tasks in queue.');
    return;
  }

  console.log('Task Queue');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Group tasks by status
  const pendingApproval = tasks.filter(t => t.approvalStatus === 'pending');
  const queued = tasks.filter(t => t.status === 'queued');

  if (pendingApproval.length > 0) {
    console.log('\nPending Approval:');
    console.log('ID                                    | Type      | Effort    | Title');
    console.log('──────────────────────────────────────┼───────────┼───────────┼──────────────');
    for (const task of pendingApproval) {
      const project = getProject(task.projectId);
      const projectName = project?.name ?? 'Unknown';
      console.log(`${task.id.slice(0, 36)} | ${task.type.padEnd(9)} | ${task.estimatedEffort.padEnd(9)} | ${task.title}`);
      console.log(`  Project: ${projectName} | Score: ${task.priorityScore}`);
    }
  }

  if (queued.length > 0) {
    console.log('\nQueued for Execution:');
    console.log('ID                                    | Type      | Effort    | Title');
    console.log('──────────────────────────────────────┼───────────┼───────────┼──────────────');
    for (const task of queued) {
      const project = getProject(task.projectId);
      const projectName = project?.name ?? 'Unknown';
      console.log(`${task.id.slice(0, 36)} | ${task.type.padEnd(9)} | ${task.estimatedEffort.padEnd(9)} | ${task.title}`);
      console.log(`  Project: ${projectName} | Score: ${task.priorityScore}`);
    }
  }

  console.log('──────────────────────────────────────────────────────────────────');
  console.log(`Total: ${tasks.length} task(s) (${pendingApproval.length} pending approval, ${queued.length} queued)`);
}

// Default action for 'queue' (list when no subcommand)
queueCommand.action(() => {
  displayTaskQueue();
});

queueCommand
  .command('list')
  .description('List all tasks in the queue')
  .action(() => {
    displayTaskQueue();
  });

// Approve command
program
  .command('approve <id>')
  .description('Approve a task for execution')
  .action((id: string) => {
    const queue = new ApprovalQueue();
    const result = queue.approve(id);

    if (result.success) {
      console.log(`✓ ${result.message}`);
      if (result.task) {
        console.log(`  Status: ${result.task.status}`);
        console.log(`  Approval: ${result.task.approvalStatus}`);
      }
    } else {
      console.error(`✗ ${result.message}`);
      process.exit(1);
    }
  });

// Reject command
program
  .command('reject <id>')
  .description('Reject a task (removes from queue)')
  .action((id: string) => {
    const queue = new ApprovalQueue();
    const result = queue.reject(id);

    if (result.success) {
      console.log(`✓ ${result.message}`);
    } else {
      console.error(`✗ ${result.message}`);
      process.exit(1);
    }
  });

// Worker management command
program
  .command('workers')
  .description('View and manage worker processes')
  .action(() => {
    displayWorkersStatus();
  });

/**
 * Display active workers and recent executions
 */
function displayWorkersStatus(): void {
  const config = loadConfig();
  const runningExecutions = ExecutionRepository.findRunning();

  console.log('Worker Status');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Max concurrent workers: ${config.maxConcurrentWorkers}`);
  console.log(`Currently running: ${runningExecutions.length}`);
  console.log('');

  if (runningExecutions.length === 0) {
    console.log('No workers currently running.');
    console.log('');
    console.log('Workers are spawned automatically when tasks are queued');
    console.log('and the daemon is running. Use "metaralph start" to start');
    console.log('the daemon, then "metaralph queue" to view pending tasks.');
  } else {
    console.log('Active Workers:');
    console.log('Execution ID                          | Task ID                               | Status   | Started');
    console.log('──────────────────────────────────────┼───────────────────────────────────────┼──────────┼──────────────────');

    for (const execution of runningExecutions) {
      const task = TaskRepository.findById(execution.taskId);
      const project = task ? getProject(task.projectId) : undefined;
      const projectName = project?.name ?? 'Unknown';
      const startedAt = execution.startedAt
        ? new Date(execution.startedAt).toLocaleTimeString()
        : 'N/A';

      console.log(`${execution.id.slice(0, 36)} | ${execution.taskId.slice(0, 36)} | ${execution.status.padEnd(8)} | ${startedAt}`);
      if (task) {
        console.log(`  Task: ${task.title}`);
        console.log(`  Project: ${projectName}`);
        if (execution.iterationsUsed > 0) {
          console.log(`  Iterations: ${execution.iterationsUsed}`);
        }
      }
      console.log('');
    }
  }

  console.log('──────────────────────────────────────────────────────────────────');
}

// Chat command - interactive conversation with MetaRalph about a project
program
  .command('chat <project>')
  .description('Open an interactive chat session with MetaRalph about a project')
  .action(async (projectId: string) => {
    // Find project by ID or name
    let project = getProjectById(projectId);
    if (!project) {
      // Try to find by name
      const projects = listProjects();
      project = projects.find(p => p.name.toLowerCase() === projectId.toLowerCase());
    }

    if (!project) {
      console.error(`✗ Project not found: ${projectId}`);
      console.log('Use "metaralph projects" to list available projects.');
      process.exit(1);
    }

    console.log(`Starting chat session with MetaRalph for project: ${project.name}`);
    console.log(`Path: ${project.path}`);
    console.log('');
    console.log('Type your messages and press Enter. Type "exit" or press Ctrl+C to quit.');
    console.log('Type "finalize" when you\'re happy with a PRD to create a task.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    try {
      await startChatSession(project.id);
    } catch (error) {
      console.error(`✗ Chat failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

// Propose command - ask MetaRalph to propose improvements for a project
program
  .command('propose <project>')
  .description('Ask MetaRalph to propose improvements for a project')
  .option('--auto-queue', 'Automatically queue approved proposals for execution')
  .action(async (projectId: string, options: { autoQueue?: boolean }) => {
    // Find project by ID or name
    let project = getProjectById(projectId);
    if (!project) {
      // Try to find by name
      const projects = listProjects();
      project = projects.find(p => p.name.toLowerCase() === projectId.toLowerCase());
    }

    if (!project) {
      console.error(`✗ Project not found: ${projectId}`);
      console.log('Use "metaralph projects" to list available projects.');
      process.exit(1);
    }

    console.log(`Asking MetaRalph to propose improvements for: ${project.name}`);
    console.log(`Path: ${project.path}`);
    console.log('');

    try {
      await startProposeSession(project.id, options.autoQueue ?? false);
    } catch (error) {
      console.error(`✗ Proposal generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

// Default action (no subcommand) - launch dashboard
program.action(() => {
  startDashboard();
});

// Parse arguments and run
program.parse();
