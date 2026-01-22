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
import {
  SelfImprovementEngine,
  getRegisteredSelfProjects,
  type RiskLevel,
} from '../self-improve/index.js';
import { executeRalph, displaySummary, validatePrd } from './ralph.js';
import {
  PhaseOrchestrator,
  PhaseRepository,
  type TddResult,
  type TddPhaseRecord,
  type PhaseOrchestratorEvents,
  type TddPhase,
  PHASE_TIME_TARGETS,
} from '../tdd/index.js';

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

// ============ TDD Helper Functions ============

/**
 * Get emoji for a TDD phase
 */
function getPhaseEmoji(phase: string): string {
  const emojis: Record<string, string> = {
    red: '🔴',
    research: '🔬',
    green: '🟢',
    integrate: '🔗',
    refine: '✨',
    commit: '📝',
  };
  return emojis[phase] || '⚡';
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Display phase-specific metrics
 */
function displayPhaseMetrics(phase: string, metrics: Record<string, unknown>): void {
  switch (phase) {
    case 'red':
      if (metrics.testFilesGenerated) {
        console.log(`   Tests generated: ${metrics.testFilesGenerated}`);
      }
      break;
    case 'research':
      if (metrics.agentsSucceeded !== undefined) {
        console.log(`   Agents succeeded: ${metrics.agentsSucceeded}/${(metrics.agentsSucceeded as number) + (metrics.agentsFailed as number || 0)}`);
      }
      if (metrics.patternsDiscovered) {
        console.log(`   Patterns discovered: ${metrics.patternsDiscovered}`);
      }
      break;
    case 'green':
      if (metrics.attempts) {
        console.log(`   Attempts: ${metrics.attempts}`);
      }
      if (metrics.testsPassed !== undefined) {
        console.log(`   Tests passed: ${metrics.testsPassed ? 'Yes' : 'No'}`);
      }
      break;
    case 'integrate':
      if (metrics.contractsValidated !== undefined) {
        console.log(`   Contracts validated: ${metrics.contractsValidated}`);
        console.log(`   Contracts failed: ${metrics.contractsFailed || 0}`);
      }
      break;
    case 'refine':
      if (metrics.totalBugsFound !== undefined) {
        console.log(`   Bugs found: ${metrics.totalBugsFound} (P0: ${metrics.p0Count || 0}, P1: ${metrics.p1Count || 0})`);
        console.log(`   Bugs fixed: ${metrics.bugsFixed || 0}`);
        console.log(`   Iteration: ${metrics.refineIteration || 1}`);
      }
      break;
    case 'commit':
      if (metrics.prCreated !== undefined) {
        console.log(`   PR created: ${metrics.prCreated ? 'Yes' : 'No'}`);
        if (metrics.prUrl) {
          console.log(`   PR URL: ${metrics.prUrl}`);
        }
      }
      break;
  }
}

/**
 * Display TDD receipt summary
 */
function displayTddReceipt(result: TddResult): void {
  if (!result.receipt) {
    console.log('  No receipt available.');
    return;
  }

  const { testReceipt, integrationReceipt, reviewReceipt } = result.receipt;

  // Test receipt
  console.log('  Test Results:');
  console.log(`    Total: ${testReceipt.totalTests}`);
  console.log(`    Passed: ${testReceipt.passed}`);
  console.log(`    Failed: ${testReceipt.failed}`);
  if (testReceipt.coveragePercent !== undefined) {
    console.log(`    Coverage: ${testReceipt.coveragePercent}%`);
  }

  // Integration receipt
  console.log('  Contract Validation:');
  console.log(`    Validated: ${integrationReceipt.contractsValidated}`);
  console.log(`    Failed: ${integrationReceipt.contractsFailed}`);
  console.log(`    Layers: ${integrationReceipt.layersChecked.join(', ')}`);

  // Review receipt
  console.log('  AI Review:');
  console.log(`    Bugs found: ${reviewReceipt.totalBugsFound} (P0: ${reviewReceipt.p0Count}, P1: ${reviewReceipt.p1Count})`);
  console.log(`    Bugs fixed: ${reviewReceipt.bugsFixed}`);
  console.log(`    Refine iterations: ${reviewReceipt.refineIterations}`);
  if (reviewReceipt.opusEscalationUsed) {
    console.log(`    Opus escalation: Yes`);
  }
}

/**
 * Display TDD failure report
 */
function displayTddFailureReport(result: TddResult): void {
  // Show which phases completed vs failed
  const completedPhases = result.phases.filter((p: TddPhaseRecord) => p.status === 'completed');
  const failedPhases = result.phases.filter((p: TddPhaseRecord) => p.status === 'failed');

  if (completedPhases.length > 0) {
    console.log('  Completed phases:');
    for (const phase of completedPhases) {
      console.log(`    ✅ ${phase.phase.toUpperCase()}`);
    }
  }

  if (failedPhases.length > 0) {
    console.log('  Failed phases:');
    for (const phase of failedPhases) {
      console.log(`    ❌ ${phase.phase.toUpperCase()}`);
    }
  }

  // Show phase metrics for debugging
  const lastPhase = result.phases[result.phases.length - 1];
  if (lastPhase?.metrics && Object.keys(lastPhase.metrics).length > 0) {
    console.log('  Last phase metrics:');
    for (const [key, value] of Object.entries(lastPhase.metrics)) {
      console.log(`    ${key}: ${JSON.stringify(value)}`);
    }
  }
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

// Self-improvement command
program
  .command('self-improve')
  .description('Run self-improvement analysis and execution on Ralph/MetaRalph')
  .option('--dry-run', 'Only analyze and propose, do not execute changes')
  .option('--auto-only', 'Only execute auto-approved (low-risk) changes')
  .option('--max-executions <n>', 'Maximum number of changes to execute', '1')
  .option('--auto-merge', 'Automatically merge successful changes')
  .option('--project <id>', 'Run on specific self-managed project by ID or name')
  .option('--tdd', 'Use TDD workflow (RED -> RESEARCH -> GREEN -> INTEGRATE -> REFINE -> COMMIT)')
  .option('--max-refine <n>', 'Maximum REFINE iterations for TDD mode', '3')
  .option('--max-green-retries <n>', 'Maximum GREEN phase retries for TDD mode', '2')
  .action(async (options: {
    dryRun?: boolean;
    autoOnly?: boolean;
    maxExecutions?: string;
    autoMerge?: boolean;
    project?: string;
    tdd?: boolean;
    maxRefine?: string;
    maxGreenRetries?: string;
  }) => {
    console.log('MetaRalph Self-Improvement');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    if (options.dryRun) {
      console.log('Mode: DRY RUN (no changes will be made)');
      console.log('');
    }

    // Get self-managed projects
    const selfProjects = getRegisteredSelfProjects();

    if (selfProjects.length === 0) {
      console.log('No self-managed projects registered.');
      console.log('');
      console.log('Self-managed projects are automatically registered when the daemon');
      console.log('starts with selfImprovementEnabled=true in the config.');
      console.log('');
      console.log('Ensure the daemon has been started at least once with self-improvement enabled.');
      return;
    }

    // Filter to specific project if requested
    let projectsToProcess = selfProjects;
    if (options.project) {
      const filtered = selfProjects.filter(
        (p) => p.id === options.project || p.name.toLowerCase() === options.project!.toLowerCase()
      );
      if (filtered.length === 0) {
        console.error(`✗ Self-managed project not found: ${options.project}`);
        console.log('');
        console.log('Registered self-managed projects:');
        for (const p of selfProjects) {
          console.log(`  - ${p.name} (${p.id})`);
        }
        process.exit(1);
      }
      projectsToProcess = filtered;
    }

    console.log(`Found ${projectsToProcess.length} self-managed project(s) to analyze:`);
    for (const project of projectsToProcess) {
      console.log(`  - ${project.name}: ${project.path}`);
    }
    console.log('');

    // TDD mode execution
    if (options.tdd) {
      console.log('Mode: TDD WORKFLOW');
      console.log('Phases: RED -> RESEARCH -> GREEN -> INTEGRATE -> REFINE -> COMMIT');
      console.log('');

      const maxRefine = parseInt(options.maxRefine || '3', 10);
      const maxGreenRetries = parseInt(options.maxGreenRetries || '2', 10);

      if (isNaN(maxRefine) || maxRefine < 1) {
        console.error(`✗ Invalid max-refine: ${options.maxRefine}. Must be a positive number.`);
        process.exit(1);
      }

      if (isNaN(maxGreenRetries) || maxGreenRetries < 1) {
        console.error(`✗ Invalid max-green-retries: ${options.maxGreenRetries}. Must be a positive number.`);
        process.exit(1);
      }

      try {
        for (const project of projectsToProcess) {
          console.log(`Running TDD workflow: ${project.name}`);
          console.log('──────────────────────────────────────────────────────────────');

          // First analyze to get opportunities
          const analysis = await SelfImprovementEngine.analyze(project);

          if (analysis.opportunities.length === 0) {
            console.log('No improvement opportunities found.');
            console.log('');
            continue;
          }

          // Take the first opportunity (highest priority)
          const opportunity = analysis.safeToAutoExecute[0] || analysis.opportunities[0];

          console.log(`Selected opportunity: ${opportunity.title}`);
          console.log(`  Category: ${opportunity.category}`);
          console.log(`  Risk: ${opportunity.riskLevel}`);
          console.log('');

          // Generate PRD JSON for the opportunity
          const prdJson = SelfImprovementEngine.generatePrdJson(project, opportunity);

          // Create orchestrator with config
          const orchestrator = new PhaseOrchestrator({
            maxRefineIterations: maxRefine,
            maxGreenRetries: maxGreenRetries,
          });

          // Set up real-time phase progress display
          let currentPhaseStart = Date.now();

          orchestrator.on('phase:started', (event: PhaseOrchestratorEvents['phase:started']) => {
            currentPhaseStart = Date.now();
            const phaseEmoji = getPhaseEmoji(event.phase);
            console.log(`${phaseEmoji} Phase: ${event.phase.toUpperCase()} - Started`);
          });

          orchestrator.on('phase:completed', (event: PhaseOrchestratorEvents['phase:completed']) => {
            const duration = Date.now() - currentPhaseStart;
            const durationStr = formatDuration(duration);
            console.log(`✅ Phase: ${event.phase.toUpperCase()} - Completed (${durationStr})`);

            // Display phase-specific metrics
            if (event.metrics) {
              displayPhaseMetrics(event.phase, event.metrics);
            }
            console.log('');
          });

          orchestrator.on('phase:failed', (event: PhaseOrchestratorEvents['phase:failed']) => {
            console.log(`❌ Phase: ${event.phase.toUpperCase()} - Failed`);
            console.log(`   Error: ${event.error}`);
            console.log('');
          });

          // Run the autonomous TDD workflow
          const tddResult = await orchestrator.runAutonomous(
            {
              userStory: prdJson.userStories[0],
              prdJson: JSON.stringify(prdJson),
            },
            {
              path: project.path,
              name: project.name,
              branchName: prdJson.branchName,
            }
          );

          // Display final summary
          console.log('');
          console.log('TDD Workflow Complete');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

          if (tddResult.success) {
            console.log('Status: ✅ SUCCESS');

            if (tddResult.receipt?.prUrl) {
              console.log(`PR URL: ${tddResult.receipt.prUrl}`);
            }

            console.log('');
            console.log('Receipt Summary:');
            displayTddReceipt(tddResult);
          } else {
            console.log('Status: ❌ FAILED');
            console.log(`Error: ${tddResult.error || 'Unknown error'}`);

            console.log('');
            console.log('Failure Report:');
            displayTddFailureReport(tddResult);
          }

          const totalDuration = formatDuration(tddResult.totalDurationMs);
          console.log('');
          console.log(`Total Duration: ${totalDuration}`);
          console.log(`Phases Executed: ${tddResult.phases.length}`);
          console.log('');

          // Exit with appropriate code
          if (!tddResult.success) {
            process.exit(1);
          }
        }
      } catch (error) {
        console.error(`✗ TDD workflow failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }

      return;
    }

    try {
      for (const project of projectsToProcess) {
        console.log(`Analyzing: ${project.name}`);
        console.log('──────────────────────────────────────────────────────────────');

        const result = await SelfImprovementEngine.run(project, {
          dryRun: options.dryRun,
          autoOnly: options.autoOnly ?? true,
          maxExecutions: parseInt(options.maxExecutions || '1', 10),
          autoMerge: options.autoMerge,
          runTests: true,
          runTypecheck: true,
        });

        // Display analysis results
        console.log('');
        console.log('Analysis Summary:');
        console.log(`  Opportunities found: ${result.summary.opportunitiesFound}`);

        if (result.analysis.byRisk) {
          const riskLevels: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
          for (const level of riskLevels) {
            const count = result.analysis.byRisk[level]?.length || 0;
            if (count > 0) {
              console.log(`    ${level}: ${count}`);
            }
          }
        }

        console.log(`  Safe to auto-execute: ${result.analysis.safeToAutoExecute.length}`);
        console.log(`  Requires approval: ${result.analysis.requiresApproval.length}`);

        // Display proposals if generated
        if (result.proposals) {
          console.log('');
          console.log('Proposals:');
          console.log(`  Tasks created: ${result.proposals.tasksCreated}`);
          console.log(`  Auto-approved: ${result.proposals.tasksAutoApproved}`);
          console.log(`  Pending approval: ${result.proposals.tasksPendingApproval}`);
        }

        // Display execution results if not dry run
        if (!options.dryRun && result.executions.length > 0) {
          console.log('');
          console.log('Execution Results:');
          console.log(`  Tasks executed: ${result.summary.tasksExecuted}`);
          console.log(`  Succeeded: ${result.summary.tasksSucceeded}`);
          console.log(`  Failed: ${result.summary.tasksFailed}`);
          console.log(`  Rolled back: ${result.summary.tasksRolledBack}`);

          for (const exec of result.executions) {
            const status = exec.success ? '✓' : '✗';
            const taskTitle = exec.task?.title || 'Unknown';
            console.log(`  ${status} ${taskTitle}`);
            if (exec.error) {
              console.log(`    Error: ${exec.error}`);
            }
            if (exec.merged) {
              console.log(`    Merged to main`);
            }
            if (exec.rolledBack) {
              console.log(`    Changes rolled back`);
            }
          }
        }

        // Display top opportunities
        if (result.analysis.opportunities.length > 0) {
          console.log('');
          console.log('Top Opportunities:');
          const topOpps = result.analysis.opportunities.slice(0, 5);
          for (const opp of topOpps) {
            const risk = opp.riskLevel;
            const autoApprove = !opp.requiresApproval && risk === 'low' ? '[auto]' : '[approval]';
            console.log(`  ${autoApprove} ${opp.title}`);
            console.log(`    Category: ${opp.category}, Risk: ${risk}, File: ${opp.file || 'N/A'}`);
          }
          if (result.analysis.opportunities.length > 5) {
            console.log(`  ... and ${result.analysis.opportunities.length - 5} more`);
          }
        }

        console.log('');
      }

      if (options.dryRun) {
        console.log('──────────────────────────────────────────────────────────────');
        console.log('DRY RUN complete. No changes were made.');
        console.log('');
        console.log('To execute auto-approved changes, run without --dry-run:');
        console.log('  metaralph self-improve');
        console.log('');
        console.log('To approve and execute pending tasks:');
        console.log('  metaralph queue                 # View pending tasks');
        console.log('  metaralph approve <task-id>     # Approve a task');
      }
    } catch (error) {
      console.error(`✗ Self-improvement failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

// Ralph command - native Ralph execution without external scripts
program
  .command('ralph [path]')
  .description('Run Ralph loops natively using Claude Code CLI')
  .option('-i, --iterations <n>', 'Maximum iterations before stopping', '10')
  .option('-t, --tool <tool>', 'Tool to use for execution (claude or cursor)', 'claude')
  .option('-p, --parallel', 'Enable parallel story execution (experimental)')
  .option('-w, --max-workers <n>', 'Maximum concurrent workers for parallel mode', '3')
  .option('-c, --conflict-strategy <strategy>', 'Conflict strategy for parallel mode (pessimistic or optimistic)', 'pessimistic')
  .action(async (projectPath: string | undefined, options: {
    iterations?: string;
    tool?: string;
    parallel?: boolean;
    maxWorkers?: string;
    conflictStrategy?: string;
  }) => {
    // Default path to current directory
    const targetPath = projectPath ? path.resolve(projectPath) : process.cwd();

    // Validate path exists
    if (!fs.existsSync(targetPath)) {
      console.error(`✗ Directory not found: ${targetPath}`);
      process.exit(1);
    }

    // Validate prd.json exists before starting
    const prdPath = path.join(targetPath, 'prd.json');
    const prdValidation = validatePrd(prdPath);
    if (!prdValidation.valid) {
      console.error(`✗ ${prdValidation.error}`);
      process.exit(1);
    }

    // Validate tool option
    const tool = options.tool as 'claude' | 'cursor';
    if (tool !== 'claude' && tool !== 'cursor') {
      console.error(`✗ Invalid tool: ${options.tool}. Must be 'claude' or 'cursor'.`);
      process.exit(1);
    }

    // Parse options
    const iterations = parseInt(options.iterations ?? '10', 10);
    const maxWorkers = parseInt(options.maxWorkers ?? '3', 10);

    if (isNaN(iterations) || iterations < 1) {
      console.error(`✗ Invalid iterations: ${options.iterations}. Must be a positive number.`);
      process.exit(1);
    }

    if (isNaN(maxWorkers) || maxWorkers < 1) {
      console.error(`✗ Invalid max-workers: ${options.maxWorkers}. Must be a positive number.`);
      process.exit(1);
    }

    // Validate conflict strategy
    const conflictStrategy = options.conflictStrategy as 'pessimistic' | 'optimistic';
    if (conflictStrategy !== 'pessimistic' && conflictStrategy !== 'optimistic') {
      console.error(`✗ Invalid conflict-strategy: ${options.conflictStrategy}. Must be 'pessimistic' or 'optimistic'.`);
      process.exit(1);
    }

    try {
      const result = await executeRalph(targetPath, {
        iterations,
        tool,
        parallel: options.parallel ?? false,
        maxWorkers,
        conflictStrategy,
      });

      displaySummary(result);

      // Exit with appropriate code
      process.exit(result.success ? 0 : 1);
    } catch (error) {
      console.error(`✗ Ralph execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  });

// TDD Status command - view TDD execution progress
program
  .command('tdd-status <execution>')
  .description('View TDD execution progress and phase history')
  .action((executionId: string) => {
    displayTddStatus(executionId);
  });

/**
 * Display TDD execution status
 */
function displayTddStatus(executionId: string): void {
  // Find the execution
  const execution = ExecutionRepository.findById(executionId);

  if (!execution) {
    console.error(`✗ Execution not found: ${executionId}`);
    process.exit(1);
  }

  // Check if TDD is enabled for this execution
  if (!execution.tddEnabled) {
    console.error(`✗ Execution ${executionId} is not a TDD execution.`);
    console.log('TDD mode was not enabled for this execution.');
    process.exit(1);
  }

  console.log('TDD Execution Status');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Execution ID: ${execution.id}`);
  console.log(`Task ID:      ${execution.taskId}`);
  console.log(`Status:       ${execution.status}`);
  console.log('');

  // Get all phases from database
  const phases = PhaseRepository.findByExecution(executionId);

  if (phases.length === 0) {
    console.log('No phases have been executed yet.');
    console.log('');
    return;
  }

  // Display current phase
  const currentPhase = PhaseRepository.getCurrentPhase(executionId);
  if (currentPhase) {
    const emoji = getPhaseEmoji(currentPhase.phase);
    console.log('Current Phase');
    console.log('──────────────────────────────────────────────────────────────');
    console.log(`${emoji} ${currentPhase.phase.toUpperCase()} - ${currentPhase.status}`);

    if (currentPhase.startedAt) {
      console.log(`Started: ${currentPhase.startedAt}`);
    }
    if (currentPhase.status === 'running' && currentPhase.startedAt) {
      const elapsed = Date.now() - new Date(currentPhase.startedAt).getTime();
      console.log(`Elapsed: ${formatDuration(elapsed)}`);
    }
    console.log('');
  }

  // Display phase history with durations
  console.log('Phase History');
  console.log('──────────────────────────────────────────────────────────────');
  console.log('Phase        | Status      | Duration    | Started');
  console.log('─────────────┼─────────────┼─────────────┼───────────────────────');

  for (const phase of phases) {
    const emoji = getPhaseEmoji(phase.phase);
    const statusDisplay = formatPhaseStatus(phase.status);
    const duration = calculatePhaseDuration(phase);
    const startedAt = phase.startedAt ? formatTimestamp(phase.startedAt) : 'N/A';

    console.log(`${emoji} ${phase.phase.padEnd(9)} | ${statusDisplay.padEnd(11)} | ${duration.padEnd(11)} | ${startedAt}`);

    // Display phase-specific metrics inline if available
    if (phase.metrics && Object.keys(phase.metrics).length > 0) {
      displayPhaseMetrics(phase.phase, phase.metrics);
    }
  }

  console.log('');

  // Calculate elapsed time and estimated remaining
  displayTimeEstimates(phases, execution.status);

  console.log('');
}

/**
 * Format phase status with appropriate indicator
 */
function formatPhaseStatus(status: string): string {
  switch (status) {
    case 'completed':
      return '✅ Completed';
    case 'running':
      return '🔄 Running';
    case 'failed':
      return '❌ Failed';
    case 'skipped':
      return '⏭️ Skipped';
    case 'pending':
    default:
      return '⏳ Pending';
  }
}

/**
 * Calculate duration between phase start and completion
 */
function calculatePhaseDuration(phase: TddPhaseRecord): string {
  if (!phase.startedAt) {
    return 'N/A';
  }

  const startTime = new Date(phase.startedAt).getTime();

  if (phase.completedAt) {
    const endTime = new Date(phase.completedAt).getTime();
    return formatDuration(endTime - startTime);
  }

  if (phase.status === 'running') {
    // Still running - show elapsed
    return formatDuration(Date.now() - startTime) + '*';
  }

  return 'N/A';
}

/**
 * Format timestamp to a shorter display format
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Display time estimates (elapsed and estimated remaining)
 */
function displayTimeEstimates(phases: TddPhaseRecord[], executionStatus: string): void {
  console.log('Time Summary');
  console.log('──────────────────────────────────────────────────────────────');

  // Calculate total elapsed time
  let totalElapsed = 0;
  for (const phase of phases) {
    if (phase.startedAt) {
      const startTime = new Date(phase.startedAt).getTime();
      if (phase.completedAt) {
        totalElapsed += new Date(phase.completedAt).getTime() - startTime;
      } else if (phase.status === 'running') {
        totalElapsed += Date.now() - startTime;
      }
    }
  }

  console.log(`Elapsed:   ${formatDuration(totalElapsed)}`);

  // Estimate remaining time based on phases not yet completed
  if (executionStatus === 'running') {
    const phaseOrder: TddPhase[] = ['red', 'research', 'green', 'integrate', 'refine', 'commit'];
    const completedPhases = new Set(phases.filter(p => p.status === 'completed').map(p => p.phase));
    const runningPhases = phases.filter(p => p.status === 'running');

    let estimatedRemaining = 0;

    // For running phase, estimate remaining time
    for (const running of runningPhases) {
      if (running.startedAt) {
        const elapsed = Date.now() - new Date(running.startedAt).getTime();
        const target = PHASE_TIME_TARGETS[running.phase as keyof typeof PHASE_TIME_TARGETS];
        if (target > elapsed) {
          estimatedRemaining += target - elapsed;
        }
      }
    }

    // Add time for phases not yet started
    for (const phaseName of phaseOrder) {
      if (!completedPhases.has(phaseName) && !runningPhases.some(p => p.phase === phaseName)) {
        estimatedRemaining += PHASE_TIME_TARGETS[phaseName as keyof typeof PHASE_TIME_TARGETS];
      }
    }

    if (estimatedRemaining > 0) {
      console.log(`Estimated: ~${formatDuration(estimatedRemaining)} remaining`);
    }
  } else if (executionStatus === 'completed') {
    console.log(`Status:    Complete`);
  } else if (executionStatus === 'failed') {
    console.log(`Status:    Failed`);
  }
}

// Default action (no subcommand) - launch dashboard
program.action(() => {
  startDashboard();
});

// Parse arguments and run
program.parse();
