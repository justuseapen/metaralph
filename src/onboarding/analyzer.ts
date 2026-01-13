/**
 * Codebase Analyzer - Detects improvement opportunities in projects
 *
 * Analyzes projects when they're added to MetaRalph, identifying:
 * - Outdated dependencies (npm outdated)
 * - Type errors (tsc --noEmit)
 * - Lint issues (if eslint available)
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskType, EffortLevel } from '../queue/task.js';

/**
 * Type of improvement opportunity detected
 */
export type OpportunityType = 'outdated_dep' | 'type_error' | 'lint_issue' | 'todo_comment';

/**
 * An improvement opportunity found during analysis
 */
export interface ImprovementOpportunity {
  type: OpportunityType;
  title: string;
  description: string;
  file?: string;
  line?: number;
  severity: 'low' | 'medium' | 'high';
  suggestedTaskType: TaskType;
  suggestedEffort: EffortLevel;
}

/**
 * Result of running a shell command
 */
interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a shell command and capture output
 */
function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });

    proc.on('error', () => {
      resolve({
        stdout,
        stderr,
        exitCode: 1,
      });
    });
  });
}

/**
 * Check if a command exists in the project
 */
function commandExists(projectPath: string, command: string): boolean {
  const nodeModulesBin = path.join(projectPath, 'node_modules', '.bin', command);
  return fs.existsSync(nodeModulesBin);
}

/**
 * Check if package.json exists
 */
function hasPackageJson(projectPath: string): boolean {
  return fs.existsSync(path.join(projectPath, 'package.json'));
}

/**
 * Check if tsconfig.json exists
 */
function hasTsConfig(projectPath: string): boolean {
  return fs.existsSync(path.join(projectPath, 'tsconfig.json'));
}

/**
 * Check if eslint config exists
 */
function hasEslintConfig(projectPath: string): boolean {
  const eslintConfigs = [
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
  ];

  return eslintConfigs.some((config) => fs.existsSync(path.join(projectPath, config)));
}

/**
 * Parse npm outdated JSON output
 */
interface OutdatedDep {
  current: string;
  wanted: string;
  latest: string;
  dependent: string;
  location: string;
}

/**
 * Detect outdated dependencies
 */
async function detectOutdatedDeps(projectPath: string): Promise<ImprovementOpportunity[]> {
  if (!hasPackageJson(projectPath)) {
    return [];
  }

  const result = await runCommand('npm', ['outdated', '--json'], projectPath);

  if (!result.stdout.trim()) {
    return [];
  }

  const opportunities: ImprovementOpportunity[] = [];

  try {
    const outdated = JSON.parse(result.stdout) as Record<string, OutdatedDep>;

    for (const [name, info] of Object.entries(outdated)) {
      // Determine severity based on version gap
      const currentMajor = parseInt(info.current?.split('.')[0] ?? '0', 10);
      const latestMajor = parseInt(info.latest?.split('.')[0] ?? '0', 10);
      const majorsBehind = latestMajor - currentMajor;

      let severity: 'low' | 'medium' | 'high';
      let effort: EffortLevel;

      if (majorsBehind >= 2) {
        severity = 'high';
        effort = 'medium';
      } else if (majorsBehind >= 1) {
        severity = 'medium';
        effort = 'small';
      } else {
        severity = 'low';
        effort = 'quick_win';
      }

      opportunities.push({
        type: 'outdated_dep',
        title: `Update ${name} from ${info.current} to ${info.latest}`,
        description: `Dependency ${name} is outdated. Current: ${info.current}, Wanted: ${info.wanted}, Latest: ${info.latest}`,
        severity,
        suggestedTaskType: 'refactor',
        suggestedEffort: effort,
      });
    }
  } catch {
    // JSON parse error - ignore
  }

  return opportunities;
}

/**
 * Detect TypeScript type errors
 */
async function detectTypeErrors(projectPath: string): Promise<ImprovementOpportunity[]> {
  if (!hasTsConfig(projectPath)) {
    return [];
  }

  // Use local tsc if available, otherwise try global
  const tscPath = commandExists(projectPath, 'tsc')
    ? path.join(projectPath, 'node_modules', '.bin', 'tsc')
    : 'tsc';

  const result = await runCommand(tscPath, ['--noEmit', '--pretty', 'false'], projectPath);

  if (result.exitCode === 0) {
    return [];
  }

  const opportunities: ImprovementOpportunity[] = [];
  const errorLines = result.stdout.split('\n').filter((line) => line.includes('error TS'));

  // Parse TypeScript error output
  // Format: path/to/file.ts(line,col): error TS####: message
  const errorRegex = /^(.+?)\((\d+),\d+\):\s*error\s+TS\d+:\s*(.+)$/;

  for (const line of errorLines) {
    const match = line.match(errorRegex);
    if (match) {
      const [, file, lineNum, message] = match;
      opportunities.push({
        type: 'type_error',
        title: `Fix type error in ${path.basename(file)}:${lineNum}`,
        description: message,
        file,
        line: parseInt(lineNum, 10),
        severity: 'high',
        suggestedTaskType: 'bug_fix',
        suggestedEffort: 'quick_win',
      });
    }
  }

  // If we couldn't parse individual errors, create a summary
  if (opportunities.length === 0 && errorLines.length > 0) {
    opportunities.push({
      type: 'type_error',
      title: `Fix ${errorLines.length} TypeScript type errors`,
      description: `The project has ${errorLines.length} TypeScript errors that need to be fixed.`,
      severity: 'high',
      suggestedTaskType: 'bug_fix',
      suggestedEffort: errorLines.length > 10 ? 'medium' : 'small',
    });
  }

  return opportunities;
}

/**
 * Detect ESLint issues
 */
async function detectLintIssues(projectPath: string): Promise<ImprovementOpportunity[]> {
  if (!hasEslintConfig(projectPath)) {
    return [];
  }

  // Use local eslint if available
  const eslintPath = commandExists(projectPath, 'eslint')
    ? path.join(projectPath, 'node_modules', '.bin', 'eslint')
    : 'eslint';

  const result = await runCommand(
    eslintPath,
    ['.', '--format', 'json', '--max-warnings', '0'],
    projectPath
  );

  const opportunities: ImprovementOpportunity[] = [];

  try {
    const results = JSON.parse(result.stdout) as Array<{
      filePath: string;
      messages: Array<{
        line: number;
        column: number;
        severity: number;
        message: string;
        ruleId: string;
      }>;
    }>;

    let errorCount = 0;
    let warningCount = 0;

    for (const fileResult of results) {
      for (const msg of fileResult.messages) {
        if (msg.severity === 2) {
          errorCount++;
        } else {
          warningCount++;
        }
      }
    }

    if (errorCount > 0) {
      opportunities.push({
        type: 'lint_issue',
        title: `Fix ${errorCount} ESLint errors`,
        description: `The project has ${errorCount} ESLint errors that should be fixed.`,
        severity: 'medium',
        suggestedTaskType: 'refactor',
        suggestedEffort: errorCount > 20 ? 'medium' : errorCount > 5 ? 'small' : 'quick_win',
      });
    }

    if (warningCount > 0) {
      opportunities.push({
        type: 'lint_issue',
        title: `Address ${warningCount} ESLint warnings`,
        description: `The project has ${warningCount} ESLint warnings that could be addressed.`,
        severity: 'low',
        suggestedTaskType: 'refactor',
        suggestedEffort: warningCount > 30 ? 'medium' : warningCount > 10 ? 'small' : 'quick_win',
      });
    }
  } catch {
    // JSON parse error - likely no eslint or error running it
  }

  return opportunities;
}

/**
 * CodebaseAnalyzer - Main analyzer class
 *
 * Analyzes a project directory and returns improvement opportunities.
 */
export const CodebaseAnalyzer = {
  /**
   * Analyze a project and return improvement opportunities
   *
   * @param projectPath - Path to the project to analyze
   * @returns Array of improvement opportunities
   */
  async analyze(projectPath: string): Promise<ImprovementOpportunity[]> {
    const opportunities: ImprovementOpportunity[] = [];

    // Run all detectors in parallel
    const [outdatedDeps, typeErrors, lintIssues] = await Promise.all([
      detectOutdatedDeps(projectPath),
      detectTypeErrors(projectPath),
      detectLintIssues(projectPath),
    ]);

    opportunities.push(...outdatedDeps);
    opportunities.push(...typeErrors);
    opportunities.push(...lintIssues);

    // Sort by severity (high first)
    const severityOrder = { high: 0, medium: 1, low: 2 };
    opportunities.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return opportunities;
  },
};
