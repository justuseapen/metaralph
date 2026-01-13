/**
 * Ralph Analyzer - Analyzes Ralph and MetaRalph codebases for improvements
 *
 * This module analyzes the Ralph and MetaRalph codebases to identify
 * improvement opportunities such as optimizations, missing tests,
 * and documentation gaps.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { ImprovementOpportunity, OpportunityType } from '../onboarding/analyzer.js';
import type { TaskType, EffortLevel } from '../queue/task.js';

/**
 * Self-improvement opportunity specific to Ralph/MetaRalph
 */
export interface SelfImprovementOpportunity extends ImprovementOpportunity {
  /** Category of self-improvement */
  category: 'optimization' | 'test' | 'documentation' | 'refactor' | 'feature';
  /** Risk level for this change */
  riskLevel: 'low' | 'medium' | 'high';
  /** Whether this change requires approval */
  requiresApproval: boolean;
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
 * Check if a test file exists for a source file
 */
function hasTestFile(srcFile: string, projectPath: string): boolean {
  const testDir = path.join(projectPath, '__tests__');
  const basename = path.basename(srcFile, '.ts');

  // Check various test file naming conventions
  const testPatterns = [
    path.join(testDir, `${basename}.test.ts`),
    path.join(testDir, `${basename}.spec.ts`),
    path.join(path.dirname(srcFile), `${basename}.test.ts`),
    path.join(path.dirname(srcFile), `${basename}.spec.ts`),
  ];

  return testPatterns.some((p) => fs.existsSync(p));
}

/**
 * Find TypeScript source files in a directory
 */
function findTsFiles(dir: string, excludeDirs: string[] = ['node_modules', 'dist', 'build', '__tests__']): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (excludeDirs.includes(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...findTsFiles(fullPath, excludeDirs));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Detect missing test files
 */
function detectMissingTests(projectPath: string): SelfImprovementOpportunity[] {
  const srcDir = path.join(projectPath, 'src');
  const opportunities: SelfImprovementOpportunity[] = [];

  if (!fs.existsSync(srcDir)) {
    return opportunities;
  }

  const tsFiles = findTsFiles(srcDir);

  for (const file of tsFiles) {
    // Skip test files, type declarations, and index files
    if (
      file.includes('.test.') ||
      file.includes('.spec.') ||
      file.includes('.d.ts') ||
      path.basename(file) === 'index.ts'
    ) {
      continue;
    }

    if (!hasTestFile(file, projectPath)) {
      const relativePath = path.relative(projectPath, file);
      opportunities.push({
        type: 'todo_comment' as OpportunityType,
        category: 'test',
        title: `Add tests for ${path.basename(file)}`,
        description: `The file ${relativePath} doesn't have corresponding test coverage. Adding tests would improve reliability.`,
        file: relativePath,
        severity: 'medium',
        suggestedTaskType: 'test',
        suggestedEffort: 'small',
        riskLevel: 'low',
        requiresApproval: false,
      });
    }
  }

  return opportunities;
}

/**
 * Detect missing JSDoc documentation
 */
async function detectMissingDocs(projectPath: string): Promise<SelfImprovementOpportunity[]> {
  const srcDir = path.join(projectPath, 'src');
  const opportunities: SelfImprovementOpportunity[] = [];

  if (!fs.existsSync(srcDir)) {
    return opportunities;
  }

  const tsFiles = findTsFiles(srcDir);

  for (const file of tsFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');

      // Check for exported functions without JSDoc
      const exportedFunctionRegex = /export\s+(?:async\s+)?function\s+(\w+)/g;
      let match;

      while ((match = exportedFunctionRegex.exec(content)) !== null) {
        const funcName = match[1];
        const funcStart = match.index;

        // Check if there's a JSDoc comment before the function
        const beforeFunc = content.slice(Math.max(0, funcStart - 200), funcStart);
        if (!beforeFunc.includes('/**')) {
          const relativePath = path.relative(projectPath, file);
          opportunities.push({
            type: 'todo_comment' as OpportunityType,
            category: 'documentation',
            title: `Add JSDoc for ${funcName} in ${path.basename(file)}`,
            description: `The exported function ${funcName} in ${relativePath} is missing JSDoc documentation.`,
            file: relativePath,
            severity: 'low',
            suggestedTaskType: 'docs',
            suggestedEffort: 'quick_win',
            riskLevel: 'low',
            requiresApproval: false,
          });
        }
      }

      // Check for exported classes without JSDoc
      const exportedClassRegex = /export\s+class\s+(\w+)/g;
      while ((match = exportedClassRegex.exec(content)) !== null) {
        const className = match[1];
        const classStart = match.index;

        const beforeClass = content.slice(Math.max(0, classStart - 200), classStart);
        if (!beforeClass.includes('/**')) {
          const relativePath = path.relative(projectPath, file);
          opportunities.push({
            type: 'todo_comment' as OpportunityType,
            category: 'documentation',
            title: `Add JSDoc for class ${className}`,
            description: `The exported class ${className} in ${relativePath} is missing JSDoc documentation.`,
            file: relativePath,
            severity: 'low',
            suggestedTaskType: 'docs',
            suggestedEffort: 'quick_win',
            riskLevel: 'low',
            requiresApproval: false,
          });
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // Limit documentation opportunities to avoid overwhelming
  return opportunities.slice(0, 10);
}

/**
 * Detect potential optimizations
 */
async function detectOptimizations(projectPath: string): Promise<SelfImprovementOpportunity[]> {
  const srcDir = path.join(projectPath, 'src');
  const opportunities: SelfImprovementOpportunity[] = [];

  if (!fs.existsSync(srcDir)) {
    return opportunities;
  }

  const tsFiles = findTsFiles(srcDir);

  for (const file of tsFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const relativePath = path.relative(projectPath, file);

      // Detect potential N+1 query patterns (multiple db calls in loops)
      if (content.includes('.prepare(') && content.includes('for (') || content.includes('.forEach(')) {
        const hasDbInLoop = /for\s*\([^)]*\)\s*\{[^}]*\.prepare\(/.test(content) ||
                           /\.forEach\s*\([^)]*=>[^}]*\.prepare\(/.test(content);
        if (hasDbInLoop) {
          opportunities.push({
            type: 'todo_comment' as OpportunityType,
            category: 'optimization',
            title: `Potential N+1 query in ${path.basename(file)}`,
            description: `Database queries inside loops detected in ${relativePath}. Consider batch queries for better performance.`,
            file: relativePath,
            severity: 'medium',
            suggestedTaskType: 'refactor',
            suggestedEffort: 'small',
            riskLevel: 'medium',
            requiresApproval: true,
          });
        }
      }

      // Detect synchronous file operations that could be async
      const syncOps = ['readFileSync', 'writeFileSync', 'readdirSync', 'statSync', 'existsSync'];
      const asyncOps = syncOps.filter((op) => content.includes(op));
      if (asyncOps.length > 3) {
        opportunities.push({
          type: 'todo_comment' as OpportunityType,
          category: 'optimization',
          title: `Consider async file ops in ${path.basename(file)}`,
          description: `Multiple synchronous file operations (${asyncOps.join(', ')}) in ${relativePath}. Consider async versions for better performance.`,
          file: relativePath,
          severity: 'low',
          suggestedTaskType: 'refactor',
          suggestedEffort: 'medium',
          riskLevel: 'medium',
          requiresApproval: true,
        });
      }

      // Detect large switch statements that could be refactored
      const switchRegex = /switch\s*\([^)]*\)\s*\{/g;
      let switchCount = 0;
      while (switchRegex.exec(content) !== null) {
        switchCount++;
      }
      if (switchCount > 2) {
        opportunities.push({
          type: 'todo_comment' as OpportunityType,
          category: 'refactor',
          title: `Consider refactoring switches in ${path.basename(file)}`,
          description: `Multiple switch statements (${switchCount}) in ${relativePath}. Consider using strategy pattern or lookup tables.`,
          file: relativePath,
          severity: 'low',
          suggestedTaskType: 'refactor',
          suggestedEffort: 'medium',
          riskLevel: 'medium',
          requiresApproval: true,
        });
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return opportunities;
}

/**
 * Check TypeScript strict mode compliance
 */
async function checkStrictMode(projectPath: string): Promise<SelfImprovementOpportunity[]> {
  const tsconfigPath = path.join(projectPath, 'tsconfig.json');
  const opportunities: SelfImprovementOpportunity[] = [];

  if (!fs.existsSync(tsconfigPath)) {
    return opportunities;
  }

  try {
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
    const compilerOptions = tsconfig.compilerOptions || {};

    // Check for strict mode
    if (!compilerOptions.strict) {
      opportunities.push({
        type: 'todo_comment' as OpportunityType,
        category: 'optimization',
        title: 'Enable TypeScript strict mode',
        description: 'TypeScript strict mode is not enabled. Enabling it would improve type safety and catch more bugs at compile time.',
        file: 'tsconfig.json',
        severity: 'medium',
        suggestedTaskType: 'refactor',
        suggestedEffort: 'medium',
        riskLevel: 'medium',
        requiresApproval: true,
      });
    }

    // Check for noUncheckedIndexedAccess
    if (!compilerOptions.noUncheckedIndexedAccess) {
      opportunities.push({
        type: 'todo_comment' as OpportunityType,
        category: 'optimization',
        title: 'Enable noUncheckedIndexedAccess',
        description: 'Consider enabling noUncheckedIndexedAccess in tsconfig.json for safer array/object indexing.',
        file: 'tsconfig.json',
        severity: 'low',
        suggestedTaskType: 'refactor',
        suggestedEffort: 'small',
        riskLevel: 'low',
        requiresApproval: false,
      });
    }
  } catch {
    // JSON parse error
  }

  return opportunities;
}

/**
 * Run linting check
 */
async function runLintCheck(projectPath: string): Promise<SelfImprovementOpportunity[]> {
  const opportunities: SelfImprovementOpportunity[] = [];

  // Check if eslint is available
  const eslintBin = path.join(projectPath, 'node_modules', '.bin', 'eslint');
  if (!fs.existsSync(eslintBin)) {
    return opportunities;
  }

  const result = await runCommand(eslintBin, ['.', '--format', 'json', '-o', '/dev/null', '--quiet'], projectPath);

  // If lint fails, there are issues to fix
  if (result.exitCode !== 0 && result.stdout) {
    try {
      const lintResults = JSON.parse(result.stdout);
      let errorCount = 0;

      for (const fileResult of lintResults) {
        errorCount += fileResult.errorCount || 0;
      }

      if (errorCount > 0) {
        opportunities.push({
          type: 'lint_issue' as OpportunityType,
          category: 'refactor',
          title: `Fix ${errorCount} ESLint errors`,
          description: `The project has ${errorCount} ESLint errors that should be fixed to maintain code quality.`,
          severity: 'medium',
          suggestedTaskType: 'refactor',
          suggestedEffort: errorCount > 20 ? 'medium' : 'small',
          riskLevel: 'low',
          requiresApproval: false,
        });
      }
    } catch {
      // JSON parse error
    }
  }

  return opportunities;
}

/**
 * RalphAnalyzer - Analyzes Ralph and MetaRalph for self-improvement opportunities
 */
export const RalphAnalyzer = {
  /**
   * Analyze a Ralph or MetaRalph project for improvements
   *
   * @param projectPath - Path to the project to analyze
   * @returns Array of self-improvement opportunities
   */
  async analyze(projectPath: string): Promise<SelfImprovementOpportunity[]> {
    const opportunities: SelfImprovementOpportunity[] = [];

    // Run all analysis in parallel
    const [missingTests, missingDocs, optimizations, strictMode, lintIssues] = await Promise.all([
      Promise.resolve(detectMissingTests(projectPath)),
      detectMissingDocs(projectPath),
      detectOptimizations(projectPath),
      checkStrictMode(projectPath),
      runLintCheck(projectPath),
    ]);

    opportunities.push(...missingTests);
    opportunities.push(...missingDocs);
    opportunities.push(...optimizations);
    opportunities.push(...strictMode);
    opportunities.push(...lintIssues);

    // Sort by risk level and severity
    const riskOrder = { low: 0, medium: 1, high: 2 };
    const severityOrder = { high: 0, medium: 1, low: 2 };

    opportunities.sort((a, b) => {
      // Lower risk first
      const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      if (riskDiff !== 0) return riskDiff;

      // Higher severity first within same risk
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    return opportunities;
  },

  /**
   * Get a summary of improvements by category
   *
   * @param opportunities - Array of improvement opportunities
   * @returns Summary object with counts by category
   */
  getSummary(opportunities: SelfImprovementOpportunity[]): Record<string, number> {
    const summary: Record<string, number> = {
      optimization: 0,
      test: 0,
      documentation: 0,
      refactor: 0,
      feature: 0,
    };

    for (const opp of opportunities) {
      summary[opp.category] = (summary[opp.category] || 0) + 1;
    }

    return summary;
  },

  /**
   * Filter opportunities that don't require approval (safe changes)
   *
   * @param opportunities - Array of improvement opportunities
   * @returns Array of safe opportunities that can be auto-executed
   */
  getSafeOpportunities(opportunities: SelfImprovementOpportunity[]): SelfImprovementOpportunity[] {
    return opportunities.filter((opp) => !opp.requiresApproval && opp.riskLevel === 'low');
  },
};
