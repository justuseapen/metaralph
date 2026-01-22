/**
 * Conflict Detector - Detects and handles file conflicts in parallel execution
 *
 * Tracks which files each worker modifies during execution and provides strategies
 * for handling conflicts when multiple workers touch the same files.
 *
 * Two strategies are available:
 * - Pessimistic: Stories touching same files run sequentially
 * - Optimistic: Let workers run, later finisher handles merge
 */

import Anthropic from '@anthropic-ai/sdk';
import { type UserStory } from '../collaboration/prd-builder.js';
import { type RalphPrd } from '../cli/ralph.js';

/**
 * Conflict handling strategy
 */
export type ConflictStrategy = 'pessimistic' | 'optimistic';

/**
 * File change record for a worker
 */
export interface FileChange {
  filePath: string;
  changeType: 'create' | 'modify' | 'delete';
  storyId: string;
  workerId: string;
  timestamp: number;
}

/**
 * File conflict between two workers
 */
export interface FileConflict {
  filePath: string;
  storyIds: string[];
  workerIds: string[];
  conflictType: 'concurrent_modify' | 'create_modify' | 'delete_modify';
  detectedAt: number;
}

/**
 * Predicted file changes for a story
 */
export interface PredictedChanges {
  storyId: string;
  predictedFiles: string[];
  confidence: number; // 0-1
  reasoning: string;
}

/**
 * Scheduling decision based on conflict analysis
 */
export interface SchedulingDecision {
  storyId: string;
  canRunParallel: boolean;
  conflicts: string[]; // Story IDs that would conflict
  reason: string;
}

/**
 * Configuration for ConflictDetector
 */
export interface ConflictDetectorConfig {
  /** Conflict handling strategy (default: pessimistic) */
  strategy: ConflictStrategy;
  /** Project path for file analysis */
  projectPath: string;
  /** PRD data */
  prd: RalphPrd;
  /** Optional Anthropic client (for AI predictions) */
  anthropicClient?: Anthropic;
}

/**
 * ConflictDetector - Detects and handles file conflicts during parallel execution
 */
export class ConflictDetector {
  private config: ConflictDetectorConfig;
  private fileChanges: Map<string, FileChange[]> = new Map(); // filePath -> changes
  private workerFiles: Map<string, Set<string>> = new Map(); // workerId -> file paths
  private storyFiles: Map<string, Set<string>> = new Map(); // storyId -> file paths
  private predictions: Map<string, PredictedChanges> = new Map(); // storyId -> predictions
  private detectedConflicts: FileConflict[] = [];

  constructor(config: ConflictDetectorConfig) {
    this.config = config;
  }

  /**
   * Get the configured conflict strategy
   */
  get strategy(): ConflictStrategy {
    return this.config.strategy;
  }

  /**
   * Track a file change made by a worker
   *
   * @param filePath - Path to the changed file
   * @param changeType - Type of change (create, modify, delete)
   * @param storyId - ID of the story being implemented
   * @param workerId - ID of the worker making the change
   */
  trackFileChange(
    filePath: string,
    changeType: 'create' | 'modify' | 'delete',
    storyId: string,
    workerId: string
  ): void {
    const change: FileChange = {
      filePath,
      changeType,
      storyId,
      workerId,
      timestamp: Date.now(),
    };

    // Add to file-keyed map
    if (!this.fileChanges.has(filePath)) {
      this.fileChanges.set(filePath, []);
    }
    this.fileChanges.get(filePath)!.push(change);

    // Add to worker-keyed map
    if (!this.workerFiles.has(workerId)) {
      this.workerFiles.set(workerId, new Set());
    }
    this.workerFiles.get(workerId)!.add(filePath);

    // Add to story-keyed map
    if (!this.storyFiles.has(storyId)) {
      this.storyFiles.set(storyId, new Set());
    }
    this.storyFiles.get(storyId)!.add(filePath);

    // Check for conflicts
    this.checkForConflicts(filePath, change);
  }

  /**
   * Check if a file change creates a conflict with other workers
   */
  private checkForConflicts(filePath: string, newChange: FileChange): void {
    const changes = this.fileChanges.get(filePath);
    if (!changes || changes.length <= 1) return;

    // Look for conflicts with other workers/stories
    const otherChanges = changes.filter(
      c => c.workerId !== newChange.workerId && c.storyId !== newChange.storyId
    );

    for (const otherChange of otherChanges) {
      const conflictType = this.determineConflictType(otherChange.changeType, newChange.changeType);
      if (conflictType) {
        const conflict: FileConflict = {
          filePath,
          storyIds: [otherChange.storyId, newChange.storyId],
          workerIds: [otherChange.workerId, newChange.workerId],
          conflictType,
          detectedAt: Date.now(),
        };
        this.detectedConflicts.push(conflict);
      }
    }
  }

  /**
   * Determine the type of conflict between two change types
   */
  private determineConflictType(
    type1: 'create' | 'modify' | 'delete',
    type2: 'create' | 'modify' | 'delete'
  ): FileConflict['conflictType'] | null {
    if (type1 === 'modify' && type2 === 'modify') {
      return 'concurrent_modify';
    }
    if ((type1 === 'create' && type2 === 'modify') || (type1 === 'modify' && type2 === 'create')) {
      return 'create_modify';
    }
    if ((type1 === 'delete' && type2 === 'modify') || (type1 === 'modify' && type2 === 'delete')) {
      return 'delete_modify';
    }
    // Both creating the same file is also a conflict
    if (type1 === 'create' && type2 === 'create') {
      return 'create_modify';
    }
    return null;
  }

  /**
   * Detect if two workers have modified the same files
   *
   * @param worker1Id - First worker ID
   * @param worker2Id - Second worker ID
   * @returns Set of conflicting file paths
   */
  detectConflictBetweenWorkers(worker1Id: string, worker2Id: string): Set<string> {
    const files1 = this.workerFiles.get(worker1Id) || new Set();
    const files2 = this.workerFiles.get(worker2Id) || new Set();

    const intersection = new Set<string>();
    for (const file of files1) {
      if (files2.has(file)) {
        intersection.add(file);
      }
    }
    return intersection;
  }

  /**
   * Get all detected conflicts
   */
  getDetectedConflicts(): FileConflict[] {
    return [...this.detectedConflicts];
  }

  /**
   * Get files modified by a specific story
   */
  getFilesForStory(storyId: string): string[] {
    const files = this.storyFiles.get(storyId);
    return files ? Array.from(files) : [];
  }

  /**
   * Get files modified by a specific worker
   */
  getFilesForWorker(workerId: string): string[] {
    const files = this.workerFiles.get(workerId);
    return files ? Array.from(files) : [];
  }

  /**
   * Predict files that a story will likely modify
   *
   * Uses AI to analyze the story requirements and predict which files
   * will be changed during implementation.
   *
   * @param story - The user story to analyze
   * @returns Predicted file changes with confidence score
   */
  async predictFileChanges(story: UserStory): Promise<PredictedChanges> {
    // Check cache first
    if (this.predictions.has(story.id)) {
      return this.predictions.get(story.id)!;
    }

    // If no Anthropic client, use heuristic prediction
    if (!this.config.anthropicClient) {
      return this.heuristicPrediction(story);
    }

    try {
      const prompt = this.buildPredictionPrompt(story);
      const response = await this.config.anthropicClient.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const textContent = response.content.find(block => block.type === 'text');
      const text = textContent?.type === 'text' ? textContent.text : '';

      const prediction = this.parsePredictionResponse(text, story.id);
      this.predictions.set(story.id, prediction);
      return prediction;
    } catch (error) {
      // Fall back to heuristic prediction on error
      console.warn(`AI prediction failed for ${story.id}, using heuristic:`, error);
      return this.heuristicPrediction(story);
    }
  }

  /**
   * Build the prompt for file prediction
   */
  private buildPredictionPrompt(story: UserStory): string {
    return `Analyze this user story and predict which files will likely be modified during implementation.

Project: ${this.config.prd.project}
Branch: ${this.config.prd.branchName}

User Story:
- ID: ${story.id}
- Title: ${story.title}
- Description: ${story.description}
- Acceptance Criteria:
${story.acceptanceCriteria.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}
${story.notes ? `- Notes: ${story.notes}` : ''}

Based on this user story, predict which files or file patterns will be modified.
Consider:
1. Source files that implement the feature
2. Test files that need to be added/modified
3. Configuration files that might change
4. Type definition files
5. Index files that export new modules

Respond in this exact JSON format:
{
  "predictedFiles": ["path/to/file1.ts", "path/to/file2.ts", "**/*.test.ts"],
  "confidence": 0.8,
  "reasoning": "Brief explanation of why these files are predicted"
}

Use glob patterns (like **/*.test.ts) when predicting patterns rather than specific files.`;
  }

  /**
   * Parse the AI prediction response
   */
  private parsePredictionResponse(text: string, storyId: string): PredictedChanges {
    try {
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        storyId,
        predictedFiles: Array.isArray(parsed.predictedFiles) ? parsed.predictedFiles : [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'AI prediction',
      };
    } catch {
      // Return empty prediction on parse error
      return {
        storyId,
        predictedFiles: [],
        confidence: 0,
        reasoning: 'Failed to parse AI response',
      };
    }
  }

  /**
   * Heuristic-based file prediction (fallback when AI is unavailable)
   */
  private heuristicPrediction(story: UserStory): PredictedChanges {
    const predictedFiles: string[] = [];
    const titleLower = story.title.toLowerCase();
    const descLower = story.description.toLowerCase();
    const combined = `${titleLower} ${descLower}`;

    // Predict based on common patterns
    if (combined.includes('test') || combined.includes('spec')) {
      predictedFiles.push('**/*.test.ts', '**/*.spec.ts');
    }

    if (combined.includes('cli') || combined.includes('command')) {
      predictedFiles.push('src/cli/**/*.ts');
    }

    if (combined.includes('parallel') || combined.includes('scheduler')) {
      predictedFiles.push('src/parallel/**/*.ts');
    }

    if (combined.includes('database') || combined.includes('schema') || combined.includes('migration')) {
      predictedFiles.push('src/db/**/*.ts', 'migrations/**/*.sql');
    }

    if (combined.includes('api') || combined.includes('repository')) {
      predictedFiles.push('src/**/*-repository.ts', 'src/**/*Repository.ts');
    }

    if (combined.includes('type') || combined.includes('interface')) {
      predictedFiles.push('src/**/types.ts', 'src/**/index.ts');
    }

    // Default patterns based on story ID prefix
    if (story.id.startsWith('US-')) {
      // Generic user story patterns
      predictedFiles.push('prd.json', 'progress.txt');
    }

    const prediction: PredictedChanges = {
      storyId: story.id,
      predictedFiles,
      confidence: 0.4, // Lower confidence for heuristic
      reasoning: 'Heuristic prediction based on story title and description',
    };

    this.predictions.set(story.id, prediction);
    return prediction;
  }

  /**
   * Get scheduling decisions for stories based on predicted conflicts
   *
   * @param stories - Stories to analyze
   * @param runningStoryIds - Stories currently being executed
   * @returns Scheduling decisions for each story
   */
  async getSchedulingDecisions(
    stories: UserStory[],
    runningStoryIds: Set<string>
  ): Promise<SchedulingDecision[]> {
    // Get predictions for all stories
    const predictions = await Promise.all(
      stories.map(story => this.predictFileChanges(story))
    );

    // Get predictions for running stories too
    const runningPredictions: PredictedChanges[] = [];
    for (const storyId of runningStoryIds) {
      const story = this.config.prd.userStories.find(s => s.id === storyId);
      if (story) {
        runningPredictions.push(await this.predictFileChanges(story));
      }
    }

    const decisions: SchedulingDecision[] = [];

    for (const story of stories) {
      const storyPrediction = predictions.find(p => p.storyId === story.id);
      if (!storyPrediction) {
        decisions.push({
          storyId: story.id,
          canRunParallel: true,
          conflicts: [],
          reason: 'No prediction available',
        });
        continue;
      }

      const conflicts: string[] = [];

      // Check against running stories
      for (const runningPred of runningPredictions) {
        if (this.hasOverlappingFiles(storyPrediction.predictedFiles, runningPred.predictedFiles)) {
          conflicts.push(runningPred.storyId);
        }
      }

      // With pessimistic strategy, any potential conflict means sequential execution
      const canRunParallel = this.config.strategy === 'optimistic' || conflicts.length === 0;

      decisions.push({
        storyId: story.id,
        canRunParallel,
        conflicts,
        reason:
          conflicts.length === 0
            ? 'No predicted file conflicts'
            : `May conflict with: ${conflicts.join(', ')} (strategy: ${this.config.strategy})`,
      });
    }

    return decisions;
  }

  /**
   * Check if two sets of file patterns have potential overlap
   */
  private hasOverlappingFiles(files1: string[], files2: string[]): boolean {
    for (const f1 of files1) {
      for (const f2 of files2) {
        if (this.pathsOverlap(f1, f2)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if two paths or glob patterns potentially overlap
   */
  private pathsOverlap(path1: string, path2: string): boolean {
    // Exact match
    if (path1 === path2) return true;

    // Both are globs - check if they target same directory
    const isGlob1 = path1.includes('*');
    const isGlob2 = path2.includes('*');

    if (isGlob1 && isGlob2) {
      // Extract base directories
      const base1 = path1.split('*')[0];
      const base2 = path2.split('*')[0];

      // If one base starts with the other, they may overlap
      return base1.startsWith(base2) || base2.startsWith(base1);
    }

    // One is a glob, check if the other matches
    if (isGlob1) {
      const base = path1.split('*')[0];
      return path2.startsWith(base);
    }
    if (isGlob2) {
      const base = path2.split('*')[0];
      return path1.startsWith(base);
    }

    // Neither is a glob, check directory overlap
    const dir1 = path1.split('/').slice(0, -1).join('/');
    const dir2 = path2.split('/').slice(0, -1).join('/');

    return dir1 === dir2 || path1.startsWith(dir2) || path2.startsWith(dir1);
  }

  /**
   * Clear all tracked file changes (for testing or reset)
   */
  clear(): void {
    this.fileChanges.clear();
    this.workerFiles.clear();
    this.storyFiles.clear();
    this.predictions.clear();
    this.detectedConflicts = [];
  }

  /**
   * Get statistics about tracked files and conflicts
   */
  getStats(): {
    totalFilesTracked: number;
    totalWorkers: number;
    totalStories: number;
    totalConflicts: number;
    conflictedFiles: string[];
  } {
    const conflictedFiles = new Set<string>();
    for (const conflict of this.detectedConflicts) {
      conflictedFiles.add(conflict.filePath);
    }

    return {
      totalFilesTracked: this.fileChanges.size,
      totalWorkers: this.workerFiles.size,
      totalStories: this.storyFiles.size,
      totalConflicts: this.detectedConflicts.length,
      conflictedFiles: Array.from(conflictedFiles),
    };
  }
}
