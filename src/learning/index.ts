/**
 * Learning System - Applies learnings to improve future task success
 *
 * The LearningSystem coordinates finding applicable learnings for tasks
 * and injecting them into the execution context (progress.txt patterns section)
 * so Ralph can benefit from past learnings.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { LearningRepository, type Learning, type LearningCategory } from './learning.js';
import { CrossProjectPatternExtractor, patternExtractor } from './cross-project.js';
import { OutcomeTracker, outcomeTracker } from './outcome-tracker.js';
import { type Task } from '../queue/task.js';
import { getProject, type Project } from '../registry/index.js';
import type { DatabaseInstance } from '../db/index.js';

/**
 * Context for matching learnings to a task
 */
export interface TaskContext {
  projectId: string;
  taskType: string;
  effort: string;
  title: string;
  description: string | null;
  tags: string[];
}

/**
 * Result of learning application
 */
export interface LearningApplicationResult {
  taskId: string;
  learningsApplied: number;
  learningIds: string[];
  injectedContext: string;
}

/**
 * Record of which learnings were applied to a task
 * Used to track success metrics after execution
 */
interface LearningApplicationRecord {
  taskId: string;
  learningIds: string[];
  appliedAt: string;
}

/**
 * LearningSystem - Coordinates learning application to tasks
 */
export class LearningSystem {
  private patternExtractor: CrossProjectPatternExtractor;
  private outcomeTracker: OutcomeTracker;
  private applicationRecords: Map<string, LearningApplicationRecord>;

  constructor() {
    this.patternExtractor = patternExtractor;
    this.outcomeTracker = outcomeTracker;
    this.applicationRecords = new Map();
  }

  /**
   * Find learnings applicable to a task based on context matching
   *
   * Matching criteria:
   * - Project-specific learnings (same project)
   * - Cross-project learnings (no project specified)
   * - Category relevance (e.g., 'testing' learnings for test tasks)
   * - Tag matching (e.g., 'typescript' tag for TS projects)
   * - Content keyword matching (task title/description vs learning content)
   */
  findApplicableLearnings(task: Task, db?: DatabaseInstance): Learning[] {
    const allLearnings = LearningRepository.findAll(db);

    // Extract context from task
    const context = this.extractTaskContext(task);

    // Score and filter learnings
    const scoredLearnings = allLearnings
      .map(learning => ({
        learning,
        score: this.calculateRelevanceScore(learning, context),
      }))
      .filter(({ score }) => score > 0.3) // Minimum relevance threshold
      .sort((a, b) => b.score - a.score);

    // Return top learnings (max 10 to avoid overwhelming context)
    return scoredLearnings.slice(0, 10).map(({ learning }) => learning);
  }

  /**
   * Inject applicable learnings into task context
   *
   * This adds learnings to the project's progress.txt "Codebase Patterns" section
   * so Ralph can read them when starting execution.
   */
  injectLearnings(
    task: Task,
    learnings: Learning[],
    db?: DatabaseInstance
  ): LearningApplicationResult {
    if (learnings.length === 0) {
      return {
        taskId: task.id,
        learningsApplied: 0,
        learningIds: [],
        injectedContext: '',
      };
    }

    // Get project to find progress.txt path
    const project = getProject(task.projectId, db);
    if (!project) {
      return {
        taskId: task.id,
        learningsApplied: 0,
        learningIds: [],
        injectedContext: '',
      };
    }

    // Format learnings as Codebase Patterns section
    const injectedContext = this.formatLearningsForInjection(learnings);

    // Update progress.txt with learnings
    this.updateProgressFile(project.path, learnings);

    // Record which learnings were applied for success tracking
    const learningIds = learnings.map(l => l.id);
    this.applicationRecords.set(task.id, {
      taskId: task.id,
      learningIds,
      appliedAt: new Date().toISOString(),
    });

    return {
      taskId: task.id,
      learningsApplied: learnings.length,
      learningIds,
      injectedContext,
    };
  }

  /**
   * Record the outcome of a task that had learnings applied
   * Updates learning success metrics based on task outcome
   */
  recordOutcome(taskId: string, wasSuccessful: boolean, db?: DatabaseInstance): void {
    const record = this.applicationRecords.get(taskId);
    if (!record) {
      return; // No learnings were applied to this task
    }

    // Update each applied learning's success metrics
    for (const learningId of record.learningIds) {
      LearningRepository.recordApplication(learningId, wasSuccessful, db);
    }

    // Clean up the record
    this.applicationRecords.delete(taskId);
  }

  /**
   * Get learnings that were applied to a task
   * Used for tracking and debugging
   */
  getAppliedLearnings(taskId: string): string[] {
    const record = this.applicationRecords.get(taskId);
    return record?.learningIds ?? [];
  }

  /**
   * Extract all patterns from a completed execution
   * Delegates to CrossProjectPatternExtractor
   */
  async extractFromExecution(executionId: string, db?: DatabaseInstance) {
    return this.patternExtractor.extractFromExecution(executionId, db);
  }

  /**
   * Analyze outcomes and create learnings from patterns
   * Delegates to OutcomeTracker
   */
  async analyzeAndCreateLearnings(projectId?: string, db?: DatabaseInstance) {
    return this.outcomeTracker.createLearningsFromAnalysis(projectId, db);
  }

  /**
   * Get high-confidence learnings (useful for display/export)
   */
  getHighConfidenceLearnings(threshold: number = 0.7, db?: DatabaseInstance): Learning[] {
    return LearningRepository.findHighConfidence(threshold, db);
  }

  /**
   * Extract context from a task for matching
   */
  private extractTaskContext(task: Task): TaskContext {
    // Extract potential tags from title and description
    const tags = this.extractTags(`${task.title} ${task.description ?? ''}`);

    return {
      projectId: task.projectId,
      taskType: task.type,
      effort: task.estimatedEffort,
      title: task.title,
      description: task.description,
      tags,
    };
  }

  /**
   * Calculate how relevant a learning is to a task context
   * Returns score between 0 and 1
   */
  private calculateRelevanceScore(learning: Learning, context: TaskContext): number {
    let score = 0;
    let maxScore = 0;

    // Project match (high weight for project-specific learnings)
    maxScore += 3;
    if (learning.projectId === context.projectId) {
      score += 3; // Exact project match
    } else if (learning.projectId === null) {
      score += 1.5; // Cross-project learning (somewhat applicable)
    }

    // Category relevance (match learning category to task type)
    maxScore += 2;
    score += this.getCategoryRelevance(learning.category, context.taskType) * 2;

    // Tag matching
    maxScore += 2;
    const tagOverlap = this.calculateTagOverlap(learning.tags, context.tags);
    score += tagOverlap * 2;

    // Content keyword matching
    maxScore += 2;
    const contentRelevance = this.calculateContentRelevance(
      learning.content,
      context.title,
      context.description
    );
    score += contentRelevance * 2;

    // Confidence boost (prefer high-confidence learnings)
    maxScore += 1;
    score += learning.confidence;

    return score / maxScore;
  }

  /**
   * Determine category relevance to task type
   */
  private getCategoryRelevance(category: LearningCategory, taskType: string): number {
    const relevanceMap: Record<LearningCategory, Record<string, number>> = {
      pattern: { bug_fix: 0.8, test: 0.6, refactor: 0.9, feature: 0.7, docs: 0.5 },
      gotcha: { bug_fix: 0.9, test: 0.7, refactor: 0.8, feature: 0.6, docs: 0.4 },
      dependency: { bug_fix: 0.7, test: 0.5, refactor: 0.6, feature: 0.8, docs: 0.3 },
      testing: { bug_fix: 0.6, test: 1.0, refactor: 0.5, feature: 0.6, docs: 0.2 },
      architecture: { bug_fix: 0.5, test: 0.4, refactor: 0.9, feature: 0.8, docs: 0.4 },
      workflow: { bug_fix: 0.6, test: 0.6, refactor: 0.6, feature: 0.6, docs: 0.6 },
      environment: { bug_fix: 0.7, test: 0.5, refactor: 0.4, feature: 0.6, docs: 0.3 },
      general: { bug_fix: 0.5, test: 0.5, refactor: 0.5, feature: 0.5, docs: 0.5 },
    };

    return relevanceMap[category]?.[taskType] ?? 0.5;
  }

  /**
   * Calculate overlap between learning tags and task tags
   */
  private calculateTagOverlap(learningTags: string[], taskTags: string[]): number {
    if (learningTags.length === 0 || taskTags.length === 0) {
      return 0;
    }

    const learningSet = new Set(learningTags.map(t => t.toLowerCase()));
    const taskSet = new Set(taskTags.map(t => t.toLowerCase()));

    let overlap = 0;
    for (const tag of learningSet) {
      if (taskSet.has(tag)) {
        overlap++;
      }
    }

    return overlap / Math.max(learningSet.size, taskSet.size);
  }

  /**
   * Calculate content relevance between learning and task
   */
  private calculateContentRelevance(
    learningContent: string,
    taskTitle: string,
    taskDescription: string | null
  ): number {
    const learningWords = this.extractKeywords(learningContent);
    const taskWords = this.extractKeywords(`${taskTitle} ${taskDescription ?? ''}`);

    if (learningWords.size === 0 || taskWords.size === 0) {
      return 0;
    }

    let overlap = 0;
    for (const word of learningWords) {
      if (taskWords.has(word)) {
        overlap++;
      }
    }

    return overlap / Math.max(learningWords.size, taskWords.size);
  }

  /**
   * Extract keywords from text (excluding common words)
   */
  private extractKeywords(text: string): Set<string> {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of',
      'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
      'during', 'before', 'after', 'above', 'below', 'between', 'under',
      'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
      'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'also',
      'this', 'that', 'these', 'those', 'it', 'its', 'use', 'using', 'used',
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    return new Set(words);
  }

  /**
   * Extract technology tags from text
   */
  private extractTags(text: string): string[] {
    const tags: string[] = [];
    const lowerText = text.toLowerCase();

    const techKeywords = [
      'typescript', 'javascript', 'react', 'node', 'sql', 'sqlite', 'database',
      'api', 'rest', 'graphql', 'json', 'html', 'css', 'jsx', 'tsx',
      'npm', 'yarn', 'git', 'docker', 'eslint', 'prettier', 'jest', 'vitest',
      'ink', 'cli', 'terminal', 'async', 'promise', 'uuid', 'migration',
      'component', 'hook', 'state', 'redux', 'context', 'router', 'fetch',
    ];

    for (const keyword of techKeywords) {
      if (lowerText.includes(keyword)) {
        tags.push(keyword);
      }
    }

    return tags;
  }

  /**
   * Format learnings for injection into progress.txt
   */
  private formatLearningsForInjection(learnings: Learning[]): string {
    const lines = [
      '## Applied Learnings from MetaRalph',
      'The following patterns and learnings have been identified from previous executions:',
      '',
    ];

    // Group by category for better organization
    const byCategory = new Map<LearningCategory, Learning[]>();
    for (const learning of learnings) {
      const list = byCategory.get(learning.category) ?? [];
      list.push(learning);
      byCategory.set(learning.category, list);
    }

    const categoryLabels: Record<LearningCategory, string> = {
      pattern: 'Code Patterns',
      gotcha: 'Gotchas & Pitfalls',
      dependency: 'Dependencies',
      testing: 'Testing',
      architecture: 'Architecture',
      workflow: 'Workflow',
      environment: 'Environment',
      general: 'General',
    };

    for (const [category, categoryLearnings] of byCategory) {
      lines.push(`### ${categoryLabels[category]}`);
      for (const learning of categoryLearnings) {
        const confidenceIndicator = learning.confidence >= 0.8 ? '⭐' : '';
        lines.push(`- ${confidenceIndicator}${learning.content}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Update progress.txt with learnings in the Codebase Patterns section
   */
  private updateProgressFile(projectPath: string, learnings: Learning[]): void {
    const progressPath = path.join(projectPath, 'progress.txt');

    // Create or update progress.txt
    let content = '';
    if (fs.existsSync(progressPath)) {
      content = fs.readFileSync(progressPath, 'utf-8');
    }

    // Check if Codebase Patterns section exists
    const patternsSection = '## Codebase Patterns';
    if (!content.includes(patternsSection)) {
      // Create new Codebase Patterns section at the top (after any header)
      const headerMatch = content.match(/^# .+\n[^\n]*\n---\n/);
      if (headerMatch) {
        const insertPos = headerMatch.index! + headerMatch[0].length;
        const learningsSection = this.formatCodebasePatterns(learnings);
        content = content.slice(0, insertPos) + '\n' + learningsSection + '\n' + content.slice(insertPos);
      } else {
        // No header, add section at beginning
        const learningsSection = this.formatCodebasePatterns(learnings);
        content = learningsSection + '\n---\n\n' + content;
      }
    } else {
      // Update existing Codebase Patterns section
      content = this.updateCodebasePatterns(content, learnings);
    }

    fs.writeFileSync(progressPath, content, 'utf-8');
  }

  /**
   * Format learnings as Codebase Patterns section
   */
  private formatCodebasePatterns(learnings: Learning[]): string {
    const lines = ['## Codebase Patterns'];

    // Add existing patterns first
    for (const learning of learnings) {
      // Skip low-confidence learnings for the patterns section
      if (learning.confidence < 0.5) continue;
      lines.push(`- ${learning.content}`);
    }

    return lines.join('\n');
  }

  /**
   * Update existing Codebase Patterns section with new learnings
   */
  private updateCodebasePatterns(content: string, learnings: Learning[]): string {
    // Find the Codebase Patterns section
    const sectionRegex = /(## Codebase Patterns\n)([\s\S]*?)(\n---|\n## |$)/;
    const match = content.match(sectionRegex);

    if (!match) {
      return content;
    }

    // Extract existing patterns
    const existingPatterns = new Set<string>();
    const existingLines = match[2].split('\n');
    for (const line of existingLines) {
      if (line.trim().startsWith('-')) {
        existingPatterns.add(line.replace(/^-\s*/, '').trim().toLowerCase());
      }
    }

    // Add new unique patterns
    const newPatternLines: string[] = [];
    for (const learning of learnings) {
      if (learning.confidence < 0.5) continue;
      const normalizedContent = learning.content.toLowerCase().trim();
      if (!existingPatterns.has(normalizedContent)) {
        newPatternLines.push(`- ${learning.content}`);
        existingPatterns.add(normalizedContent);
      }
    }

    if (newPatternLines.length === 0) {
      return content;
    }

    // Insert new patterns at end of section
    const newSection = match[1] + match[2].trimEnd() + '\n' + newPatternLines.join('\n');
    return content.replace(sectionRegex, newSection + match[3]);
  }
}

// Export singleton instance
export const learningSystem = new LearningSystem();

// Re-export types and classes from submodules
export { Learning, LearningCategory, LearningRepository, CreateLearningInput, UpdateLearningInput } from './learning.js';
export { CrossProjectPatternExtractor, patternExtractor, ExtractedPattern, ExtractionResult } from './cross-project.js';
export { OutcomeTracker, outcomeTracker, OutcomeAnalysis, OutcomeInsight, AttributeCorrelation } from './outcome-tracker.js';
