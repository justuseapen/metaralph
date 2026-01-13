/**
 * Outcome Tracker
 *
 * Correlates execution outcomes (success/failure) with task attributes
 * to identify patterns that predict success or failure.
 */

import { ExecutionRepository, type Execution, type ExecutionStatus } from '../workers/execution.js';
import { TaskRepository, type Task, type TaskType, type EffortLevel } from '../queue/task.js';
import { LearningRepository, type LearningCategory, type CreateLearningInput } from './learning.js';
import type { DatabaseInstance } from '../db/index.js';

/**
 * Outcome statistics for a particular attribute combination
 */
export interface OutcomeStats {
  total: number;
  successful: number;
  failed: number;
  successRate: number;
}

/**
 * Correlation between task attributes and outcomes
 */
export interface AttributeCorrelation {
  attribute: string;
  value: string;
  stats: OutcomeStats;
  isSignificant: boolean; // True if sample size >= minSampleSize
}

/**
 * Overall outcome analysis result
 */
export interface OutcomeAnalysis {
  totalExecutions: number;
  overallSuccessRate: number;
  correlations: AttributeCorrelation[];
  insights: OutcomeInsight[];
}

/**
 * Insight derived from outcome analysis
 */
export interface OutcomeInsight {
  type: 'high_success' | 'low_success' | 'trend' | 'recommendation';
  description: string;
  confidence: number;
  relatedAttributes: string[];
}

/**
 * Configuration for outcome tracking
 */
export interface OutcomeTrackerConfig {
  minSampleSize: number;           // Minimum executions for significant correlation
  successThreshold: number;        // Success rate considered "high" (0-1)
  failureThreshold: number;        // Success rate considered "low" (0-1)
}

const DEFAULT_CONFIG: OutcomeTrackerConfig = {
  minSampleSize: 3,
  successThreshold: 0.8,
  failureThreshold: 0.3,
};

/**
 * OutcomeTracker - Tracks and analyzes execution outcomes
 */
export class OutcomeTracker {
  private config: OutcomeTrackerConfig;

  constructor(config: Partial<OutcomeTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record an execution outcome and extract learnings
   */
  async recordOutcome(executionId: string, db?: DatabaseInstance): Promise<void> {
    const execution = ExecutionRepository.findById(executionId, db);
    if (!execution || !['completed', 'failed'].includes(execution.status)) {
      return; // Only track completed or failed executions
    }

    const task = TaskRepository.findById(execution.taskId, db);
    if (!task) {
      return;
    }

    const isSuccess = execution.status === 'completed';

    // Update any learnings that were applied to this task
    // (This would be tracked if we had learning application metadata)
    // For now, just record the outcome for future analysis
  }

  /**
   * Analyze outcomes across all executions
   */
  analyzeOutcomes(projectId?: string, db?: DatabaseInstance): OutcomeAnalysis {
    const executions = projectId
      ? ExecutionRepository.findByProject(projectId, db)
      : this.getAllExecutions(db);

    const completedExecutions = executions.filter(
      e => e.status === 'completed' || e.status === 'failed'
    );

    if (completedExecutions.length === 0) {
      return {
        totalExecutions: 0,
        overallSuccessRate: 0,
        correlations: [],
        insights: [],
      };
    }

    // Calculate overall success rate
    const successCount = completedExecutions.filter(e => e.status === 'completed').length;
    const overallSuccessRate = successCount / completedExecutions.length;

    // Build task-execution pairs for correlation analysis
    const pairs = this.buildTaskExecutionPairs(completedExecutions, db);

    // Calculate correlations for each attribute
    const correlations = [
      ...this.analyzeByTaskType(pairs),
      ...this.analyzeByEffortLevel(pairs),
      ...this.analyzeBySource(pairs),
    ];

    // Generate insights from correlations
    const insights = this.generateInsights(correlations, overallSuccessRate);

    return {
      totalExecutions: completedExecutions.length,
      overallSuccessRate,
      correlations,
      insights,
    };
  }

  /**
   * Get task types that have high success rates
   */
  getHighSuccessTaskTypes(projectId?: string, db?: DatabaseInstance): TaskType[] {
    const analysis = this.analyzeOutcomes(projectId, db);
    return analysis.correlations
      .filter(c => c.attribute === 'taskType' &&
                   c.isSignificant &&
                   c.stats.successRate >= this.config.successThreshold)
      .map(c => c.value as TaskType);
  }

  /**
   * Get effort levels that have high success rates
   */
  getHighSuccessEffortLevels(projectId?: string, db?: DatabaseInstance): EffortLevel[] {
    const analysis = this.analyzeOutcomes(projectId, db);
    return analysis.correlations
      .filter(c => c.attribute === 'effortLevel' &&
                   c.isSignificant &&
                   c.stats.successRate >= this.config.successThreshold)
      .map(c => c.value as EffortLevel);
  }

  /**
   * Create learnings from outcome analysis
   */
  async createLearningsFromAnalysis(projectId?: string, db?: DatabaseInstance): Promise<number> {
    const analysis = this.analyzeOutcomes(projectId, db);
    let learningsCreated = 0;

    for (const insight of analysis.insights) {
      if (insight.confidence >= 0.6) {
        const input: CreateLearningInput = {
          projectId: projectId ?? undefined,
          category: this.insightTypeToCategory(insight.type),
          content: insight.description,
          confidence: insight.confidence,
          tags: insight.relatedAttributes,
        };
        LearningRepository.create(input, db);
        learningsCreated++;
      }
    }

    return learningsCreated;
  }

  /**
   * Get all executions (helper since ExecutionRepository doesn't have findAll)
   */
  private getAllExecutions(db?: DatabaseInstance): Execution[] {
    // We need to get executions from all projects
    // For now, use running + completed status queries
    const running = ExecutionRepository.findRunning(db);
    // Note: We'd need to add a findAll method to ExecutionRepository
    // For now, return running (as a placeholder)
    return running;
  }

  /**
   * Build task-execution pairs for analysis
   */
  private buildTaskExecutionPairs(
    executions: Execution[],
    db?: DatabaseInstance
  ): Array<{ task: Task; execution: Execution }> {
    const pairs: Array<{ task: Task; execution: Execution }> = [];

    for (const execution of executions) {
      const task = TaskRepository.findById(execution.taskId, db);
      if (task) {
        pairs.push({ task, execution });
      }
    }

    return pairs;
  }

  /**
   * Analyze outcomes by task type
   */
  private analyzeByTaskType(
    pairs: Array<{ task: Task; execution: Execution }>
  ): AttributeCorrelation[] {
    const byType = new Map<TaskType, { success: number; total: number }>();

    for (const { task, execution } of pairs) {
      const current = byType.get(task.type) ?? { success: 0, total: 0 };
      current.total++;
      if (execution.status === 'completed') {
        current.success++;
      }
      byType.set(task.type, current);
    }

    return Array.from(byType.entries()).map(([type, counts]) => ({
      attribute: 'taskType',
      value: type,
      stats: {
        total: counts.total,
        successful: counts.success,
        failed: counts.total - counts.success,
        successRate: counts.total > 0 ? counts.success / counts.total : 0,
      },
      isSignificant: counts.total >= this.config.minSampleSize,
    }));
  }

  /**
   * Analyze outcomes by effort level
   */
  private analyzeByEffortLevel(
    pairs: Array<{ task: Task; execution: Execution }>
  ): AttributeCorrelation[] {
    const byEffort = new Map<EffortLevel, { success: number; total: number }>();

    for (const { task, execution } of pairs) {
      const current = byEffort.get(task.estimatedEffort) ?? { success: 0, total: 0 };
      current.total++;
      if (execution.status === 'completed') {
        current.success++;
      }
      byEffort.set(task.estimatedEffort, current);
    }

    return Array.from(byEffort.entries()).map(([effort, counts]) => ({
      attribute: 'effortLevel',
      value: effort,
      stats: {
        total: counts.total,
        successful: counts.success,
        failed: counts.total - counts.success,
        successRate: counts.total > 0 ? counts.success / counts.total : 0,
      },
      isSignificant: counts.total >= this.config.minSampleSize,
    }));
  }

  /**
   * Analyze outcomes by task source
   */
  private analyzeBySource(
    pairs: Array<{ task: Task; execution: Execution }>
  ): AttributeCorrelation[] {
    const bySource = new Map<string, { success: number; total: number }>();

    for (const { task, execution } of pairs) {
      const current = bySource.get(task.source) ?? { success: 0, total: 0 };
      current.total++;
      if (execution.status === 'completed') {
        current.success++;
      }
      bySource.set(task.source, current);
    }

    return Array.from(bySource.entries()).map(([source, counts]) => ({
      attribute: 'taskSource',
      value: source,
      stats: {
        total: counts.total,
        successful: counts.success,
        failed: counts.total - counts.success,
        successRate: counts.total > 0 ? counts.success / counts.total : 0,
      },
      isSignificant: counts.total >= this.config.minSampleSize,
    }));
  }

  /**
   * Generate insights from correlation analysis
   */
  private generateInsights(
    correlations: AttributeCorrelation[],
    overallSuccessRate: number
  ): OutcomeInsight[] {
    const insights: OutcomeInsight[] = [];

    for (const correlation of correlations) {
      if (!correlation.isSignificant) continue;

      const { attribute, value, stats } = correlation;

      // High success pattern
      if (stats.successRate >= this.config.successThreshold) {
        insights.push({
          type: 'high_success',
          description: `Tasks with ${attribute}='${value}' have ${(stats.successRate * 100).toFixed(0)}% success rate (${stats.successful}/${stats.total})`,
          confidence: Math.min(0.9, 0.5 + (stats.total / 20) * 0.4), // More samples = higher confidence
          relatedAttributes: [attribute, value],
        });
      }

      // Low success pattern (potential problem area)
      if (stats.successRate <= this.config.failureThreshold) {
        insights.push({
          type: 'low_success',
          description: `Tasks with ${attribute}='${value}' have only ${(stats.successRate * 100).toFixed(0)}% success rate - consider breaking into smaller tasks`,
          confidence: Math.min(0.9, 0.5 + (stats.total / 20) * 0.4),
          relatedAttributes: [attribute, value],
        });
      }

      // Recommendation based on deviation from overall rate
      const deviation = stats.successRate - overallSuccessRate;
      if (Math.abs(deviation) > 0.2 && stats.total >= this.config.minSampleSize * 2) {
        const direction = deviation > 0 ? 'better' : 'worse';
        insights.push({
          type: 'recommendation',
          description: `${attribute}='${value}' tasks perform ${direction} than average (${(deviation * 100).toFixed(0)}% ${direction})`,
          confidence: Math.min(0.85, 0.4 + (stats.total / 30) * 0.45),
          relatedAttributes: [attribute, value],
        });
      }
    }

    // Sort by confidence
    return insights.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Map insight type to learning category
   */
  private insightTypeToCategory(type: OutcomeInsight['type']): LearningCategory {
    switch (type) {
      case 'high_success':
        return 'pattern';
      case 'low_success':
        return 'gotcha';
      case 'recommendation':
        return 'workflow';
      case 'trend':
        return 'general';
      default:
        return 'general';
    }
  }
}

// Export singleton instance
export const outcomeTracker = new OutcomeTracker();
