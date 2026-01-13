/**
 * Cross-Project Pattern Extractor
 *
 * Analyzes progress.txt files from completed executions to extract
 * patterns, learnings, and gotchas that can be applied to future tasks.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { LearningRepository, type Learning, type LearningCategory, type CreateLearningInput } from './learning.js';
import { ExecutionRepository, type Execution } from '../workers/execution.js';
import { getProject } from '../registry/index.js';
import type { DatabaseInstance } from '../db/index.js';

/**
 * Extracted pattern from progress.txt
 */
export interface ExtractedPattern {
  category: LearningCategory;
  content: string;
  confidence: number;
  tags: string[];
  source: 'codebase_patterns' | 'learnings_section' | 'content_inference';
}

/**
 * Result of pattern extraction for an execution
 */
export interface ExtractionResult {
  executionId: string;
  projectId: string;
  patternsFound: number;
  learningsCreated: number;
  patterns: ExtractedPattern[];
}

/**
 * CrossProjectPatternExtractor - Extracts patterns from progress.txt files
 */
export class CrossProjectPatternExtractor {
  /**
   * Extract patterns from a completed execution's progress.txt
   */
  async extractFromExecution(executionId: string, db?: DatabaseInstance): Promise<ExtractionResult> {
    const execution = ExecutionRepository.findById(executionId, db);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    // Get project path to find progress.txt
    const project = getProject(execution.taskId.split('-')[0], db);
    if (!project) {
      throw new Error(`Project not found for execution: ${executionId}`);
    }

    const progressPath = path.join(project.path, 'progress.txt');
    if (!fs.existsSync(progressPath)) {
      return {
        executionId,
        projectId: project.id,
        patternsFound: 0,
        learningsCreated: 0,
        patterns: [],
      };
    }

    const progressContent = fs.readFileSync(progressPath, 'utf-8');
    const patterns = this.extractPatternsFromContent(progressContent);

    // Create learnings from extracted patterns
    let learningsCreated = 0;
    for (const pattern of patterns) {
      const existing = this.findSimilarLearning(pattern.content, db);
      if (!existing) {
        const input: CreateLearningInput = {
          executionId,
          projectId: project.id,
          category: pattern.category,
          content: pattern.content,
          confidence: pattern.confidence,
          tags: pattern.tags,
        };
        LearningRepository.create(input, db);
        learningsCreated++;
      } else {
        // Increase confidence of existing similar learning
        LearningRepository.update(existing.id, {
          confidence: Math.min(1.0, existing.confidence + 0.1),
        }, db);
      }
    }

    return {
      executionId,
      projectId: project.id,
      patternsFound: patterns.length,
      learningsCreated,
      patterns,
    };
  }

  /**
   * Extract patterns from progress.txt content
   */
  extractPatternsFromContent(content: string): ExtractedPattern[] {
    const patterns: ExtractedPattern[] = [];

    // Extract from Codebase Patterns section (highest confidence)
    const codebasePatternsMatch = content.match(/## Codebase Patterns\n([\s\S]*?)(?=\n---|\n## |$)/);
    if (codebasePatternsMatch) {
      const patternsSection = codebasePatternsMatch[1];
      const patternLines = patternsSection.split('\n').filter(line => line.trim().startsWith('-'));
      for (const line of patternLines) {
        const patternContent = line.replace(/^-\s*/, '').trim();
        if (patternContent) {
          patterns.push({
            category: this.inferCategory(patternContent),
            content: patternContent,
            confidence: 0.8, // High confidence for explicitly documented patterns
            tags: this.extractTags(patternContent),
            source: 'codebase_patterns',
          });
        }
      }
    }

    // Extract from Learnings sections (medium confidence)
    const learningsRegex = /\*\*Learnings for future iterations:\*\*\n([\s\S]*?)(?=\n---|\n## |$)/g;
    let match;
    while ((match = learningsRegex.exec(content)) !== null) {
      const learningsSection = match[1];
      const learningLines = learningsSection.split('\n').filter(line => line.trim().startsWith('-'));
      for (const line of learningLines) {
        const learningContent = line.replace(/^-\s*/, '').trim();
        if (learningContent && learningContent.length > 10) {
          patterns.push({
            category: this.inferCategory(learningContent),
            content: learningContent,
            confidence: 0.6, // Medium confidence for per-story learnings
            tags: this.extractTags(learningContent),
            source: 'learnings_section',
          });
        }
      }
    }

    // Deduplicate patterns by content similarity
    return this.deduplicatePatterns(patterns);
  }

  /**
   * Infer category from pattern content
   */
  private inferCategory(content: string): LearningCategory {
    const lowerContent = content.toLowerCase();

    // Architecture patterns
    if (lowerContent.includes('architecture') || lowerContent.includes('structure') ||
        lowerContent.includes('pattern') || lowerContent.includes('module')) {
      return 'architecture';
    }

    // Testing patterns
    if (lowerContent.includes('test') || lowerContent.includes('spec') ||
        lowerContent.includes('mock') || lowerContent.includes('jest') ||
        lowerContent.includes('typecheck')) {
      return 'testing';
    }

    // Dependency patterns
    if (lowerContent.includes('import') || lowerContent.includes('package') ||
        lowerContent.includes('dependency') || lowerContent.includes('npm') ||
        lowerContent.includes('require')) {
      return 'dependency';
    }

    // Environment patterns
    if (lowerContent.includes('config') || lowerContent.includes('env') ||
        lowerContent.includes('environment') || lowerContent.includes('setting')) {
      return 'environment';
    }

    // Gotchas (warnings/pitfalls)
    if (lowerContent.includes('don\'t') || lowerContent.includes('avoid') ||
        lowerContent.includes('gotcha') || lowerContent.includes('warning') ||
        lowerContent.includes('careful') || lowerContent.includes('never')) {
      return 'gotcha';
    }

    // Workflow patterns
    if (lowerContent.includes('workflow') || lowerContent.includes('process') ||
        lowerContent.includes('step') || lowerContent.includes('order')) {
      return 'workflow';
    }

    // Code patterns (look for specific syntax hints)
    if (lowerContent.includes('use ') || lowerContent.includes('always ') ||
        lowerContent.includes('syntax') || lowerContent.includes('format')) {
      return 'pattern';
    }

    return 'general';
  }

  /**
   * Extract relevant tags from pattern content
   */
  private extractTags(content: string): string[] {
    const tags: string[] = [];
    const lowerContent = content.toLowerCase();

    // Technology tags
    const techKeywords = [
      'typescript', 'javascript', 'react', 'node', 'sql', 'sqlite', 'database',
      'api', 'rest', 'graphql', 'json', 'html', 'css', 'jsx', 'tsx',
      'npm', 'yarn', 'git', 'docker', 'eslint', 'prettier', 'jest', 'vitest',
      'ink', 'cli', 'terminal', 'async', 'promise', 'uuid', 'migration'
    ];

    for (const keyword of techKeywords) {
      if (lowerContent.includes(keyword)) {
        tags.push(keyword);
      }
    }

    // Pattern type tags
    if (lowerContent.includes('repository') || lowerContent.includes('repo')) {
      tags.push('repository');
    }
    if (lowerContent.includes('interface') || lowerContent.includes('type')) {
      tags.push('types');
    }
    if (lowerContent.includes('column') || lowerContent.includes('table')) {
      tags.push('schema');
    }

    return [...new Set(tags)]; // Deduplicate
  }

  /**
   * Find existing learning with similar content
   */
  private findSimilarLearning(content: string, db?: DatabaseInstance): Learning | undefined {
    const allLearnings = LearningRepository.findAll(db);
    const normalizedContent = content.toLowerCase().trim();

    for (const learning of allLearnings) {
      const normalizedExisting = learning.content.toLowerCase().trim();
      // Simple similarity check - if they share significant overlap
      if (this.calculateSimilarity(normalizedContent, normalizedExisting) > 0.7) {
        return learning;
      }
    }
    return undefined;
  }

  /**
   * Calculate similarity between two strings (simple word overlap)
   */
  private calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 3));
    const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 3));

    if (wordsA.size === 0 || wordsB.size === 0) {
      return 0;
    }

    let overlap = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) {
        overlap++;
      }
    }

    return overlap / Math.max(wordsA.size, wordsB.size);
  }

  /**
   * Deduplicate patterns by similarity
   */
  private deduplicatePatterns(patterns: ExtractedPattern[]): ExtractedPattern[] {
    const unique: ExtractedPattern[] = [];

    for (const pattern of patterns) {
      const isDuplicate = unique.some(
        existing => this.calculateSimilarity(pattern.content.toLowerCase(), existing.content.toLowerCase()) > 0.7
      );
      if (!isDuplicate) {
        unique.push(pattern);
      }
    }

    return unique;
  }

  /**
   * Extract patterns from all completed executions for a project
   */
  async extractFromProject(projectId: string, db?: DatabaseInstance): Promise<ExtractionResult[]> {
    const executions = ExecutionRepository.findByProject(projectId, db);
    const completedExecutions = executions.filter(e => e.status === 'completed');

    const results: ExtractionResult[] = [];
    for (const execution of completedExecutions) {
      try {
        const result = await this.extractFromExecution(execution.id, db);
        results.push(result);
      } catch (error) {
        // Skip executions that fail to extract
        console.warn(`Failed to extract from execution ${execution.id}:`, error);
      }
    }

    return results;
  }

  /**
   * Extract patterns from a raw progress.txt file path
   */
  async extractFromProgressFile(progressPath: string, projectId?: string, db?: DatabaseInstance): Promise<ExtractionResult> {
    if (!fs.existsSync(progressPath)) {
      throw new Error(`Progress file not found: ${progressPath}`);
    }

    const content = fs.readFileSync(progressPath, 'utf-8');
    const patterns = this.extractPatternsFromContent(content);

    let learningsCreated = 0;
    for (const pattern of patterns) {
      const existing = this.findSimilarLearning(pattern.content, db);
      if (!existing) {
        const input: CreateLearningInput = {
          projectId: projectId ?? undefined,
          category: pattern.category,
          content: pattern.content,
          confidence: pattern.confidence,
          tags: pattern.tags,
        };
        LearningRepository.create(input, db);
        learningsCreated++;
      }
    }

    return {
      executionId: '',
      projectId: projectId ?? '',
      patternsFound: patterns.length,
      learningsCreated,
      patterns,
    };
  }
}

// Export singleton instance
export const patternExtractor = new CrossProjectPatternExtractor();
