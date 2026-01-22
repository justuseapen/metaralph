/**
 * Bug Classifier - REFINE Phase Implementation
 *
 * AI-powered bug detection and classification during the REFINE phase.
 * This is the fifth phase of the 6-phase TDD workflow:
 * RED -> RESEARCH -> GREEN -> INTEGRATE -> REFINE -> COMMIT
 *
 * The REFINE phase:
 * 1. Performs AI code review on changes
 * 2. Classifies bugs by severity (P0-P3)
 * 3. Classifies bugs by category (logic, security, performance, style, compatibility)
 * 4. Stores bugs in the database for tracking
 * 5. Returns structured bug list for the auto-fix loop
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import {
  type Bug,
  type BugSeverity,
  type BugCategory,
  type ReviewReceipt,
} from './types.js';
import { BugRepository, type CreateBugInput } from './repositories/index.js';
import { type DatabaseInstance } from '../db/index.js';

/**
 * Project context for bug classification
 */
export interface BugClassifierProjectContext {
  /** Project root path */
  path: string;
  /** Project name */
  name: string;
  /** Source directory (defaults to 'src') */
  srcDir?: string;
}

/**
 * Code changes to review for bugs
 */
export interface CodeChanges {
  /** List of modified files with their content */
  modifiedFiles: ModifiedFile[];
  /** List of new files with their content */
  newFiles: NewFile[];
  /** Optional: git diff for additional context */
  gitDiff?: string;
}

/**
 * A modified file for review
 */
export interface ModifiedFile {
  /** File path relative to project root */
  filePath: string;
  /** Original content before changes */
  originalContent: string;
  /** New content after changes */
  newContent: string;
}

/**
 * A new file for review
 */
export interface NewFile {
  /** File path relative to project root */
  filePath: string;
  /** Content of the new file */
  content: string;
}

/**
 * Configuration for BugClassifier
 */
export interface BugClassifierConfig {
  /** Anthropic client (optional, created if not provided) */
  anthropicClient?: Anthropic;
  /** Max tokens for AI responses */
  maxTokens?: number;
  /** Model to use for bug classification */
  model?: string;
  /** Timeout for classification in ms */
  timeoutMs?: number;
}

/**
 * Result of the AI code review
 */
export interface BugClassificationResult {
  /** Whether the review completed successfully */
  success: boolean;
  /** Bugs found during review */
  bugs: Bug[];
  /** Error message if review failed */
  error?: string;
  /** Total duration in ms */
  totalDurationMs: number;
  /** Review metrics */
  metrics: BugClassificationMetrics;
  /** Review receipt for PR documentation */
  receipt: ReviewReceipt;
}

/**
 * Configuration for the auto-fix loop
 */
export interface AutoFixConfig {
  /** Anthropic client (optional, created if not provided) */
  anthropicClient?: Anthropic;
  /** Max tokens for AI responses */
  maxTokens?: number;
  /** Default model to use for fix generation */
  model?: string;
  /** Model to use for escalation on final iteration */
  escalationModel?: string;
  /** Whether this is the final iteration (triggers escalation) */
  isFinalIteration?: boolean;
  /** Timeout for fix generation in ms */
  timeoutMs?: number;
}

/**
 * Result of the auto-fix loop
 */
export interface AutoFixResult {
  /** Whether all P0/P1 bugs were fixed */
  success: boolean;
  /** All bugs (with updated status) */
  bugs: Bug[];
  /** Error message if something failed */
  error?: string;
  /** Total duration in ms */
  totalDurationMs: number;
  /** Auto-fix metrics */
  metrics: AutoFixMetrics;
}

/**
 * Metrics about the auto-fix process
 */
export interface AutoFixMetrics {
  /** Total bugs processed */
  totalBugsProcessed: number;
  /** P0 bugs fixed */
  p0Fixed: number;
  /** P1 bugs fixed */
  p1Fixed: number;
  /** P2 bugs fixed */
  p2Fixed: number;
  /** P3 bugs fixed */
  p3Fixed: number;
  /** Bugs that couldn't be fixed */
  unfixable: number;
  /** Total fix attempts made */
  totalAttempts: number;
  /** Success rate (fixed / processed) */
  successRate: number;
  /** Whether escalation to opus model was used */
  escalationUsed: boolean;
  /** Tests passed after fixes */
  testsPassedAfterFixes: boolean;
}

/**
 * A generated fix for a bug
 */
interface GeneratedFix {
  /** The file path to modify */
  filePath: string;
  /** Original content of the file */
  originalContent: string;
  /** New content with fix applied */
  newContent: string;
  /** Explanation of the fix */
  explanation: string;
}

/**
 * Metrics about the bug classification
 */
export interface BugClassificationMetrics {
  /** Total bugs found */
  totalBugsFound: number;
  /** Bugs by severity */
  p0Count: number;
  p1Count: number;
  p2Count: number;
  p3Count: number;
  /** Bugs by category */
  logicBugs: number;
  securityBugs: number;
  performanceBugs: number;
  styleBugs: number;
  compatibilityBugs: number;
  /** Files reviewed */
  filesReviewed: number;
  /** Lines of code reviewed (approximate) */
  linesReviewed: number;
}

/**
 * Raw bug from AI review (before database storage)
 */
interface RawBug {
  severity: BugSeverity;
  category: BugCategory;
  description: string;
  filePath: string;
  lineNumber?: number;
  suggestedFix?: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<Omit<BugClassifierConfig, 'anthropicClient'>> = {
  maxTokens: 8192,
  model: 'claude-sonnet-4-20250514',
  timeoutMs: 10 * 60 * 1000, // 10 minutes
};

/**
 * Default configuration for auto-fix
 */
const DEFAULT_AUTOFIX_CONFIG: Required<Omit<AutoFixConfig, 'anthropicClient'>> = {
  maxTokens: 8192,
  model: 'claude-sonnet-4-20250514',
  escalationModel: 'claude-opus-4-20250514',
  isFinalIteration: false,
  timeoutMs: 5 * 60 * 1000, // 5 minutes per fix
};

/**
 * Bug severity definitions for the AI prompt
 */
const SEVERITY_DEFINITIONS = `
Bug Severity Levels (P0 = most critical, P3 = least critical):

P0 - CRITICAL: Bugs that will cause data loss, security breaches, or complete feature failure
  - Security vulnerabilities (XSS, SQL injection, auth bypass)
  - Data corruption or loss
  - Application crash or hang
  - Production outage potential

P1 - HIGH: Bugs that significantly impact functionality but don't cause data loss
  - Incorrect business logic
  - Race conditions
  - Memory leaks
  - Missing error handling for common cases
  - Breaking changes to existing APIs

P2 - MEDIUM: Bugs that affect functionality but have workarounds
  - Edge case handling issues
  - Performance degradation (but not critical)
  - Inconsistent error messages
  - Minor memory inefficiencies
  - Non-critical validation gaps

P3 - LOW: Minor issues that don't significantly impact functionality
  - Code style inconsistencies
  - Missing type annotations
  - Duplicate code
  - Suboptimal variable naming
  - Missing documentation
`;

/**
 * Bug category definitions for the AI prompt
 */
const CATEGORY_DEFINITIONS = `
Bug Categories:

logic: Incorrect business logic, wrong calculations, improper conditionals, flow control errors
security: Security vulnerabilities, XSS, injection, auth issues, data exposure
performance: Slow algorithms, memory leaks, unnecessary operations, inefficient queries
style: Code style issues, naming conventions, formatting, documentation
compatibility: Browser/platform issues, dependency conflicts, breaking API changes
`;

/**
 * Bug Classifier - AI-powered bug detection and classification
 */
export const BugClassifier = {
  /**
   * Create an Anthropic client
   */
  createClient(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is required for bug classification. ' +
          'Set it in your shell or .env file.'
      );
    }
    return new Anthropic({ apiKey });
  },

  /**
   * Perform AI-powered code review to find and classify bugs
   *
   * @param project - Project context
   * @param codeChanges - Code changes to review
   * @param phaseId - TDD phase ID for database records
   * @param config - Optional configuration
   * @param db - Optional database instance
   * @returns Bug classification result with all bugs found
   */
  async aiReview(
    project: BugClassifierProjectContext,
    codeChanges: CodeChanges,
    phaseId: string,
    config: BugClassifierConfig = {},
    db?: DatabaseInstance
  ): Promise<BugClassificationResult> {
    const startTime = Date.now();
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    // Initialize metrics
    const metrics: BugClassificationMetrics = {
      totalBugsFound: 0,
      p0Count: 0,
      p1Count: 0,
      p2Count: 0,
      p3Count: 0,
      logicBugs: 0,
      securityBugs: 0,
      performanceBugs: 0,
      styleBugs: 0,
      compatibilityBugs: 0,
      filesReviewed: 0,
      linesReviewed: 0,
    };

    try {
      // Get or create Anthropic client
      const client = config.anthropicClient ?? this.createClient();

      // Calculate files and lines reviewed
      metrics.filesReviewed = codeChanges.modifiedFiles.length + codeChanges.newFiles.length;
      metrics.linesReviewed = this.countLinesReviewed(codeChanges);

      // Build the code review prompt
      const prompt = this.buildReviewPrompt(project, codeChanges);

      // Call Claude API for code review
      const response = await client.messages.create({
        model: mergedConfig.model,
        max_tokens: mergedConfig.maxTokens,
        system: this.buildSystemPrompt(),
        messages: [{ role: 'user', content: prompt }],
      });

      // Extract the response text
      const responseText =
        response.content[0].type === 'text' ? response.content[0].text : '';

      // Parse bugs from the review response
      const rawBugs = this.parseBugsFromReview(responseText);

      // Store bugs in database and convert to Bug records
      const bugs: Bug[] = [];
      for (const rawBug of rawBugs) {
        const createInput: CreateBugInput = {
          phaseId,
          severity: rawBug.severity,
          category: rawBug.category,
          description: rawBug.description,
          filePath: rawBug.filePath,
          lineNumber: rawBug.lineNumber,
          status: 'open',
          suggestedFix: rawBug.suggestedFix,
        };
        const bug = BugRepository.create(createInput, db);
        bugs.push(bug);
      }

      // Update metrics from bugs
      this.updateMetrics(metrics, bugs);

      const totalDurationMs = Date.now() - startTime;

      return {
        success: true,
        bugs,
        totalDurationMs,
        metrics,
        receipt: this.buildReceipt(metrics, 1, false),
      };
    } catch (error) {
      const totalDurationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        bugs: [],
        error: errorMessage,
        totalDurationMs,
        metrics,
        receipt: this.buildReceipt(metrics, 1, false),
      };
    }
  },

  /**
   * Build the system prompt for code review
   */
  buildSystemPrompt(): string {
    return `You are an expert code reviewer specializing in finding bugs and security vulnerabilities.
Your task is to review code changes and identify bugs with precise severity and category classification.

${SEVERITY_DEFINITIONS}

${CATEGORY_DEFINITIONS}

IMPORTANT: You must respond in a specific JSON format. Every bug you find must be classified with:
1. severity: P0, P1, P2, or P3
2. category: logic, security, performance, style, or compatibility
3. description: Clear explanation of the bug
4. filePath: The file where the bug was found
5. lineNumber: The approximate line number (if determinable)
6. suggestedFix: A brief suggestion for how to fix the bug

Focus on finding real, actionable bugs. Do not flag style issues as P0/P1.
Be conservative with severity - only mark truly critical issues as P0.`;
  },

  /**
   * Build the user prompt for code review
   */
  buildReviewPrompt(
    project: BugClassifierProjectContext,
    codeChanges: CodeChanges
  ): string {
    let prompt = `## Code Review Request

Project: ${project.name}
Project Path: ${project.path}

Please review the following code changes and identify any bugs, security vulnerabilities, or significant issues.

`;

    // Add modified files
    if (codeChanges.modifiedFiles.length > 0) {
      prompt += `### Modified Files\n\n`;
      for (const file of codeChanges.modifiedFiles) {
        prompt += `#### ${file.filePath}\n\n`;
        prompt += `**Original:**\n\`\`\`typescript\n${this.truncateContent(file.originalContent)}\n\`\`\`\n\n`;
        prompt += `**New:**\n\`\`\`typescript\n${this.truncateContent(file.newContent)}\n\`\`\`\n\n`;
      }
    }

    // Add new files
    if (codeChanges.newFiles.length > 0) {
      prompt += `### New Files\n\n`;
      for (const file of codeChanges.newFiles) {
        prompt += `#### ${file.filePath}\n\n`;
        prompt += `\`\`\`typescript\n${this.truncateContent(file.content)}\n\`\`\`\n\n`;
      }
    }

    // Add git diff if available
    if (codeChanges.gitDiff) {
      prompt += `### Git Diff\n\n\`\`\`diff\n${this.truncateContent(codeChanges.gitDiff)}\n\`\`\`\n\n`;
    }

    prompt += `
## Response Format

Respond with a JSON object containing an array of bugs found:

\`\`\`json
{
  "bugs": [
    {
      "severity": "P0|P1|P2|P3",
      "category": "logic|security|performance|style|compatibility",
      "description": "Clear description of the bug",
      "filePath": "path/to/file.ts",
      "lineNumber": 42,
      "suggestedFix": "Brief suggestion for fixing the bug"
    }
  ],
  "summary": "Brief summary of the review findings"
}
\`\`\`

If no bugs are found, return: { "bugs": [], "summary": "No bugs found" }`;

    return prompt;
  },

  /**
   * Parse bugs from the AI review response
   */
  parseBugsFromReview(reviewOutput: string): RawBug[] {
    const bugs: RawBug[] = [];

    try {
      // Try to extract JSON from the response
      const jsonMatch = reviewOutput.match(/```json\s*([\s\S]*?)\s*```/);
      let jsonStr = jsonMatch ? jsonMatch[1] : reviewOutput;

      // If no code block found, try to find raw JSON
      if (!jsonMatch) {
        const jsonStart = reviewOutput.indexOf('{');
        const jsonEnd = reviewOutput.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          jsonStr = reviewOutput.slice(jsonStart, jsonEnd + 1);
        }
      }

      // Parse the JSON
      const parsed = JSON.parse(jsonStr) as {
        bugs?: Array<{
          severity?: string;
          category?: string;
          description?: string;
          filePath?: string;
          lineNumber?: number;
          suggestedFix?: string;
        }>;
      };

      if (!parsed.bugs || !Array.isArray(parsed.bugs)) {
        return bugs;
      }

      // Validate and convert each bug
      for (const rawBug of parsed.bugs) {
        const severity = this.validateSeverity(rawBug.severity);
        const category = this.validateCategory(rawBug.category);

        if (severity && category && rawBug.description && rawBug.filePath) {
          bugs.push({
            severity,
            category,
            description: rawBug.description,
            filePath: rawBug.filePath,
            lineNumber: rawBug.lineNumber,
            suggestedFix: rawBug.suggestedFix,
          });
        }
      }
    } catch {
      // If JSON parsing fails, try to extract bugs with regex
      // This is a fallback for malformed responses
      const bugMatches = reviewOutput.matchAll(
        /severity[:\s]*([Pp][0-3])[,\s]*category[:\s]*(\w+)[,\s]*description[:\s]*["']([^"']+)["'][,\s]*filePath[:\s]*["']([^"']+)["']/gi
      );

      for (const match of bugMatches) {
        const severity = this.validateSeverity(match[1]);
        const category = this.validateCategory(match[2]);

        if (severity && category) {
          bugs.push({
            severity,
            category,
            description: match[3],
            filePath: match[4],
          });
        }
      }
    }

    return bugs;
  },

  /**
   * Validate and normalize bug severity
   */
  validateSeverity(severity: string | undefined): BugSeverity | null {
    if (!severity) return null;
    const normalized = severity.toUpperCase();
    if (['P0', 'P1', 'P2', 'P3'].includes(normalized)) {
      return normalized as BugSeverity;
    }
    return null;
  },

  /**
   * Validate and normalize bug category
   */
  validateCategory(category: string | undefined): BugCategory | null {
    if (!category) return null;
    const normalized = category.toLowerCase();
    if (['logic', 'security', 'performance', 'style', 'compatibility'].includes(normalized)) {
      return normalized as BugCategory;
    }
    return null;
  },

  /**
   * Update metrics from the found bugs
   */
  updateMetrics(metrics: BugClassificationMetrics, bugs: Bug[]): void {
    metrics.totalBugsFound = bugs.length;

    for (const bug of bugs) {
      // Count by severity
      switch (bug.severity) {
        case 'P0':
          metrics.p0Count++;
          break;
        case 'P1':
          metrics.p1Count++;
          break;
        case 'P2':
          metrics.p2Count++;
          break;
        case 'P3':
          metrics.p3Count++;
          break;
      }

      // Count by category
      switch (bug.category) {
        case 'logic':
          metrics.logicBugs++;
          break;
        case 'security':
          metrics.securityBugs++;
          break;
        case 'performance':
          metrics.performanceBugs++;
          break;
        case 'style':
          metrics.styleBugs++;
          break;
        case 'compatibility':
          metrics.compatibilityBugs++;
          break;
      }
    }
  },

  /**
   * Build review receipt for PR documentation
   */
  buildReceipt(
    metrics: BugClassificationMetrics,
    refineIterations: number,
    opusEscalationUsed: boolean
  ): ReviewReceipt {
    return {
      totalBugsFound: metrics.totalBugsFound,
      p0Count: metrics.p0Count,
      p1Count: metrics.p1Count,
      p2Count: metrics.p2Count,
      p3Count: metrics.p3Count,
      bugsFixed: 0, // Will be updated by auto-fix loop
      refineIterations,
      opusEscalationUsed,
    };
  },

  /**
   * Count lines reviewed from code changes
   */
  countLinesReviewed(codeChanges: CodeChanges): number {
    let lines = 0;

    for (const file of codeChanges.modifiedFiles) {
      lines += file.newContent.split('\n').length;
    }

    for (const file of codeChanges.newFiles) {
      lines += file.content.split('\n').length;
    }

    if (codeChanges.gitDiff) {
      lines += codeChanges.gitDiff.split('\n').length;
    }

    return lines;
  },

  /**
   * Truncate content to avoid exceeding token limits
   */
  truncateContent(content: string, maxChars: number = 10000): string {
    if (content.length <= maxChars) {
      return content;
    }
    return content.slice(0, maxChars) + '\n... (truncated)';
  },

  /**
   * Load code changes from a project (utility for gathering changes to review)
   *
   * @param project - Project context
   * @param changedFiles - List of file paths that have changes
   * @returns Code changes object for review
   */
  async loadCodeChanges(
    project: BugClassifierProjectContext,
    changedFiles: string[]
  ): Promise<CodeChanges> {
    const modifiedFiles: ModifiedFile[] = [];
    const newFiles: NewFile[] = [];

    for (const filePath of changedFiles) {
      const fullPath = path.join(project.path, filePath);

      // Check if file exists
      if (!fs.existsSync(fullPath)) {
        continue;
      }

      const content = fs.readFileSync(fullPath, 'utf-8');

      // For simplicity, we treat all files as new files
      // In a real implementation, we would compare with git HEAD
      newFiles.push({
        filePath,
        content,
      });
    }

    return {
      modifiedFiles,
      newFiles,
    };
  },

  /**
   * Load code changes from git diff
   *
   * @param project - Project context
   * @param baseBranch - Base branch to compare against (defaults to 'main')
   * @returns Code changes object for review
   */
  async loadCodeChangesFromGit(
    project: BugClassifierProjectContext,
    baseBranch: string = 'main'
  ): Promise<CodeChanges> {
    const { execSync } = await import('node:child_process');

    try {
      // Get list of changed files
      const changedFilesOutput = execSync(
        `git diff --name-only ${baseBranch}...HEAD`,
        { cwd: project.path, encoding: 'utf-8' }
      );
      const changedFiles = changedFilesOutput
        .trim()
        .split('\n')
        .filter((f) => f.length > 0);

      // Get the git diff
      const gitDiff = execSync(`git diff ${baseBranch}...HEAD`, {
        cwd: project.path,
        encoding: 'utf-8',
      });

      // Load modified files
      const modifiedFiles: ModifiedFile[] = [];
      const newFiles: NewFile[] = [];

      for (const filePath of changedFiles) {
        const fullPath = path.join(project.path, filePath);

        // Check if file exists in current HEAD
        if (!fs.existsSync(fullPath)) {
          continue;
        }

        const newContent = fs.readFileSync(fullPath, 'utf-8');

        // Try to get original content from base branch
        try {
          const originalContent = execSync(`git show ${baseBranch}:${filePath}`, {
            cwd: project.path,
            encoding: 'utf-8',
          });
          modifiedFiles.push({
            filePath,
            originalContent,
            newContent,
          });
        } catch {
          // File doesn't exist in base branch - it's a new file
          newFiles.push({
            filePath,
            content: newContent,
          });
        }
      }

      return {
        modifiedFiles,
        newFiles,
        gitDiff,
      };
    } catch (error) {
      // Git commands failed - return empty changes
      return {
        modifiedFiles: [],
        newFiles: [],
      };
    }
  },

  /**
   * Automatically fix P0/P1 bugs using AI
   *
   * This method iterates through bugs, generates fixes using Claude API,
   * applies them to files, and runs tests to verify no regressions.
   *
   * @param bugs - List of bugs to fix (P0/P1 are prioritized)
   * @param project - Project context
   * @param config - Optional configuration
   * @param db - Optional database instance
   * @returns Auto-fix result with updated bugs and metrics
   */
  async autoFix(
    bugs: Bug[],
    project: BugClassifierProjectContext,
    config: AutoFixConfig = {},
    db?: DatabaseInstance
  ): Promise<AutoFixResult> {
    const startTime = Date.now();
    const mergedConfig = { ...DEFAULT_AUTOFIX_CONFIG, ...config };

    // Determine which model to use
    const modelToUse = mergedConfig.isFinalIteration
      ? mergedConfig.escalationModel
      : mergedConfig.model;

    // Initialize metrics
    const metrics: AutoFixMetrics = {
      totalBugsProcessed: 0,
      p0Fixed: 0,
      p1Fixed: 0,
      p2Fixed: 0,
      p3Fixed: 0,
      unfixable: 0,
      totalAttempts: 0,
      successRate: 0,
      escalationUsed: mergedConfig.isFinalIteration,
      testsPassedAfterFixes: false,
    };

    // Filter to only P0/P1 bugs that are still open
    const bugsToFix = bugs.filter(
      (bug) => bug.status === 'open' && (bug.severity === 'P0' || bug.severity === 'P1')
    );

    // Also keep track of P2/P3 for potential fixes if time permits
    const lowerPriorityBugs = bugs.filter(
      (bug) => bug.status === 'open' && (bug.severity === 'P2' || bug.severity === 'P3')
    );

    const allBugsToProcess = [...bugsToFix, ...lowerPriorityBugs];
    metrics.totalBugsProcessed = allBugsToProcess.length;

    if (allBugsToProcess.length === 0) {
      return {
        success: true,
        bugs,
        totalDurationMs: Date.now() - startTime,
        metrics: {
          ...metrics,
          successRate: 1,
          testsPassedAfterFixes: true,
        },
      };
    }

    try {
      // Get or create Anthropic client
      const client = config.anthropicClient ?? this.createClient();

      // Process each bug
      const updatedBugs: Bug[] = [...bugs];

      for (const bug of allBugsToProcess) {
        // Update fix attempts counter
        metrics.totalAttempts++;
        const currentAttempts = (bug.fixAttempts ?? 0) + 1;

        try {
          // Generate fix for the bug
          const fix = await this.generateFix(bug, project, client, modelToUse, mergedConfig.maxTokens);

          if (!fix) {
            // No fix could be generated - mark as wontfix
            const updatedBug = BugRepository.update(
              bug.id,
              { status: 'wontfix', fixAttempts: currentAttempts },
              db
            );
            if (updatedBug) {
              const bugIndex = updatedBugs.findIndex((b) => b.id === bug.id);
              if (bugIndex !== -1) {
                updatedBugs[bugIndex] = updatedBug;
              }
            }
            metrics.unfixable++;
            continue;
          }

          // Apply the fix to the file
          const applySuccess = await this.applyFix(fix, project);
          if (!applySuccess) {
            // Failed to apply fix - update attempts but keep open
            const updatedBug = BugRepository.update(
              bug.id,
              { fixAttempts: currentAttempts, suggestedFix: fix.explanation },
              db
            );
            if (updatedBug) {
              const bugIndex = updatedBugs.findIndex((b) => b.id === bug.id);
              if (bugIndex !== -1) {
                updatedBugs[bugIndex] = updatedBug;
              }
            }
            metrics.unfixable++;
            continue;
          }

          // Run tests to verify no regressions
          const testsPass = await this.runTests(project);

          if (testsPass) {
            // Fix successful - update bug status to fixed
            const updatedBug = BugRepository.update(
              bug.id,
              {
                status: 'fixed',
                fixAttempts: currentAttempts,
                fixedAt: new Date().toISOString(),
                suggestedFix: fix.explanation,
              },
              db
            );
            if (updatedBug) {
              const bugIndex = updatedBugs.findIndex((b) => b.id === bug.id);
              if (bugIndex !== -1) {
                updatedBugs[bugIndex] = updatedBug;
              }
            }

            // Update metrics based on severity
            switch (bug.severity) {
              case 'P0':
                metrics.p0Fixed++;
                break;
              case 'P1':
                metrics.p1Fixed++;
                break;
              case 'P2':
                metrics.p2Fixed++;
                break;
              case 'P3':
                metrics.p3Fixed++;
                break;
            }
          } else {
            // Tests failed - revert the fix
            await this.revertFix(fix, project);

            // Update attempts but keep open
            const updatedBug = BugRepository.update(
              bug.id,
              { fixAttempts: currentAttempts, suggestedFix: fix.explanation },
              db
            );
            if (updatedBug) {
              const bugIndex = updatedBugs.findIndex((b) => b.id === bug.id);
              if (bugIndex !== -1) {
                updatedBugs[bugIndex] = updatedBug;
              }
            }
          }
        } catch (fixError) {
          // Error processing this bug - update attempts but continue
          const updatedBug = BugRepository.update(
            bug.id,
            { fixAttempts: currentAttempts },
            db
          );
          if (updatedBug) {
            const bugIndex = updatedBugs.findIndex((b) => b.id === bug.id);
            if (bugIndex !== -1) {
              updatedBugs[bugIndex] = updatedBug;
            }
          }
        }
      }

      // Calculate success rate
      const totalFixed = metrics.p0Fixed + metrics.p1Fixed + metrics.p2Fixed + metrics.p3Fixed;
      metrics.successRate = metrics.totalBugsProcessed > 0
        ? totalFixed / metrics.totalBugsProcessed
        : 1;

      // Final test run to verify overall state
      metrics.testsPassedAfterFixes = await this.runTests(project);

      // Check if all P0/P1 bugs are fixed
      const remainingP0P1 = updatedBugs.filter(
        (bug) => bug.status === 'open' && (bug.severity === 'P0' || bug.severity === 'P1')
      );
      const success = remainingP0P1.length === 0;

      return {
        success,
        bugs: updatedBugs,
        totalDurationMs: Date.now() - startTime,
        metrics,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        bugs,
        error: errorMessage,
        totalDurationMs: Date.now() - startTime,
        metrics,
      };
    }
  },

  /**
   * Generate a fix for a bug using Claude API
   *
   * @param bug - The bug to fix
   * @param project - Project context
   * @param client - Anthropic client
   * @param model - Model to use
   * @param maxTokens - Max tokens for response
   * @returns Generated fix or null if unable to generate
   */
  async generateFix(
    bug: Bug,
    project: BugClassifierProjectContext,
    client: Anthropic,
    model: string,
    maxTokens: number
  ): Promise<GeneratedFix | null> {
    // Read the file content
    const fullPath = path.join(project.path, bug.filePath);
    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const originalContent = fs.readFileSync(fullPath, 'utf-8');

    // Build the fix prompt
    const systemPrompt = `You are an expert code fixer. Your task is to fix bugs in code.
You will be given:
1. A bug description with severity, category, and location
2. The file content containing the bug
3. Any suggested fix from the original review

Your job is to:
1. Understand the bug
2. Provide a fixed version of the file
3. Explain your fix

IMPORTANT: Respond with ONLY a JSON object in this exact format:
{
  "fixedCode": "the entire file content with the bug fixed",
  "explanation": "brief explanation of what was fixed and why"
}

Do not include markdown code blocks around the JSON. Just return the raw JSON object.
The fixedCode should be the COMPLETE file content, not just a snippet.
Make minimal changes - only fix the specific bug, don't refactor or improve other code.`;

    const userPrompt = `## Bug to Fix

**Severity:** ${bug.severity}
**Category:** ${bug.category}
**File:** ${bug.filePath}
**Line:** ${bug.lineNumber ?? 'unknown'}
**Description:** ${bug.description}
${bug.suggestedFix ? `**Suggested Fix:** ${bug.suggestedFix}` : ''}

## File Content

\`\`\`
${this.truncateContent(originalContent, 15000)}
\`\`\`

Please provide the fixed version of this file.`;

    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const responseText =
        response.content[0].type === 'text' ? response.content[0].text : '';

      // Parse the response
      const fix = this.parseFixResponse(responseText);
      if (!fix) {
        return null;
      }

      return {
        filePath: bug.filePath,
        originalContent,
        newContent: fix.fixedCode,
        explanation: fix.explanation,
      };
    } catch (error) {
      return null;
    }
  },

  /**
   * Parse the fix response from Claude
   */
  parseFixResponse(response: string): { fixedCode: string; explanation: string } | null {
    try {
      // Try to parse directly as JSON
      let jsonStr = response.trim();

      // Handle markdown code blocks if present
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      // Find JSON object bounds if needed
      if (!jsonStr.startsWith('{')) {
        const start = jsonStr.indexOf('{');
        const end = jsonStr.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
          jsonStr = jsonStr.slice(start, end + 1);
        }
      }

      const parsed = JSON.parse(jsonStr) as {
        fixedCode?: string;
        explanation?: string;
      };

      if (!parsed.fixedCode || !parsed.explanation) {
        return null;
      }

      return {
        fixedCode: parsed.fixedCode,
        explanation: parsed.explanation,
      };
    } catch {
      return null;
    }
  },

  /**
   * Apply a generated fix to the file system
   *
   * @param fix - The fix to apply
   * @param project - Project context
   * @returns True if fix was applied successfully
   */
  async applyFix(fix: GeneratedFix, project: BugClassifierProjectContext): Promise<boolean> {
    const fullPath = path.join(project.path, fix.filePath);

    try {
      // Create backup before applying
      const backupPath = `${fullPath}.backup`;
      fs.writeFileSync(backupPath, fix.originalContent, 'utf-8');

      // Apply the fix
      fs.writeFileSync(fullPath, fix.newContent, 'utf-8');

      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * Revert a fix by restoring the original content
   *
   * @param fix - The fix to revert
   * @param project - Project context
   */
  async revertFix(fix: GeneratedFix, project: BugClassifierProjectContext): Promise<void> {
    const fullPath = path.join(project.path, fix.filePath);
    const backupPath = `${fullPath}.backup`;

    try {
      // Restore from backup if it exists
      if (fs.existsSync(backupPath)) {
        const backupContent = fs.readFileSync(backupPath, 'utf-8');
        fs.writeFileSync(fullPath, backupContent, 'utf-8');
        fs.unlinkSync(backupPath);
      } else {
        // No backup - restore from original content in fix object
        fs.writeFileSync(fullPath, fix.originalContent, 'utf-8');
      }
    } catch (error) {
      // Best effort - ignore errors during revert
    }
  },

  /**
   * Run tests to verify no regressions
   *
   * @param project - Project context
   * @returns True if tests pass, false otherwise
   */
  async runTests(project: BugClassifierProjectContext): Promise<boolean> {
    return new Promise((resolve) => {
      // Detect test framework by looking at package.json
      const packageJsonPath = path.join(project.path, 'package.json');
      let testCommand = 'npm test';

      if (fs.existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

          // Check for vitest in devDependencies or dependencies
          const hasVitest =
            packageJson.devDependencies?.vitest || packageJson.dependencies?.vitest;

          if (hasVitest) {
            testCommand = 'npx vitest run';
          } else if (packageJson.scripts?.test) {
            testCommand = 'npm test';
          }
        } catch {
          // Use default npm test
        }
      }

      // Run the test command
      const testProcess = spawn('sh', ['-c', testCommand], {
        cwd: project.path,
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';

      testProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      testProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Set timeout to prevent hanging
      const timeout = setTimeout(() => {
        testProcess.kill();
        resolve(false);
      }, 5 * 60 * 1000); // 5 minute timeout

      testProcess.on('close', (code) => {
        clearTimeout(timeout);
        // Tests pass if exit code is 0
        resolve(code === 0);
      });

      testProcess.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  },

  /**
   * Clean up backup files after auto-fix is complete
   *
   * @param project - Project context
   * @param filePaths - List of file paths that were fixed
   */
  async cleanupBackups(
    project: BugClassifierProjectContext,
    filePaths: string[]
  ): Promise<void> {
    for (const filePath of filePaths) {
      const backupPath = path.join(project.path, `${filePath}.backup`);
      if (fs.existsSync(backupPath)) {
        try {
          fs.unlinkSync(backupPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  },
};
