/**
 * Guardrails - Safety guardrails for self-improvement operations
 *
 * This module provides safety mechanisms to prevent dangerous modifications
 * to core safety code without explicit approval. It includes risk scoring
 * for proposed changes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Task } from '../queue/task.js';
import type { SelfImprovementOpportunity } from './ralph-analyzer.js';

/**
 * Risk level for a proposed change
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Result of a risk assessment
 */
export interface RiskAssessment {
  /** Numeric risk score (0-100) */
  score: number;
  /** Categorical risk level */
  level: RiskLevel;
  /** Whether this change requires explicit approval */
  requiresApproval: boolean;
  /** Reasons contributing to the risk score */
  reasons: string[];
  /** Files that would be affected */
  affectedFiles: string[];
  /** Whether any core safety files are affected */
  affectsCoreSafety: boolean;
}

/**
 * Approval status for a change
 */
export interface ApprovalStatus {
  approved: boolean;
  approvedBy?: string;
  approvedAt?: string;
  reason?: string;
}

/**
 * Files and patterns that are considered core safety code
 * Modifications to these require explicit approval
 */
const CORE_SAFETY_PATTERNS = [
  // Guardrails module itself
  'guardrails.ts',
  'guardrails.js',
  // Rollback functionality
  'rollback.ts',
  'rollback.js',
  // Safe execution
  'safe-executor.ts',
  'safe-executor.js',
  // Self-improvement coordinator
  'self-improve/index.ts',
  'self-improve/index.js',
  // Approval mechanisms
  'approval.ts',
  'approval.js',
  // Configuration that affects safety
  'config.ts',
  'config.js',
];

/**
 * Keywords that indicate high-risk changes
 */
const HIGH_RISK_KEYWORDS = [
  'delete',
  'remove',
  'drop',
  'truncate',
  'reset',
  'force',
  'override',
  'bypass',
  'disable',
  'skip',
  'ignore',
  'unsafe',
  'no-verify',
  'no-check',
];

/**
 * File patterns that are higher risk to modify
 */
const HIGH_RISK_FILE_PATTERNS = [
  // Database files
  '*.db',
  '*.sqlite',
  // Configuration files
  '*.config.*',
  'tsconfig.json',
  'package.json',
  // Git-related
  '.git*',
  // Environment files
  '.env*',
  // Lock files
  '*.lock',
  'package-lock.json',
];

/**
 * Check if a file path matches any core safety pattern
 */
function isCoreSafetyFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();

  for (const pattern of CORE_SAFETY_PATTERNS) {
    if (normalizedPath.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a file path matches any high-risk pattern
 */
function isHighRiskFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  const fileName = path.basename(normalizedPath);

  for (const pattern of HIGH_RISK_FILE_PATTERNS) {
    // Simple glob matching
    const regex = new RegExp(
      '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
      'i'
    );
    if (regex.test(fileName)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if content contains high-risk keywords
 */
function containsHighRiskKeywords(content: string): string[] {
  const foundKeywords: string[] = [];
  const lowerContent = content.toLowerCase();

  for (const keyword of HIGH_RISK_KEYWORDS) {
    if (lowerContent.includes(keyword)) {
      foundKeywords.push(keyword);
    }
  }

  return foundKeywords;
}

/**
 * Calculate risk score from 0-100
 */
function calculateRiskScore(assessment: {
  affectsCoreSafety: boolean;
  highRiskFiles: number;
  highRiskKeywords: string[];
  totalFilesAffected: number;
  taskType: string;
  effortLevel: string;
}): number {
  let score = 0;

  // Core safety modifications are critical
  if (assessment.affectsCoreSafety) {
    score += 50;
  }

  // High-risk files add to the score
  score += assessment.highRiskFiles * 10;

  // High-risk keywords add to the score
  score += assessment.highRiskKeywords.length * 5;

  // More files affected = more risk
  if (assessment.totalFilesAffected > 10) {
    score += 15;
  } else if (assessment.totalFilesAffected > 5) {
    score += 10;
  } else if (assessment.totalFilesAffected > 2) {
    score += 5;
  }

  // Task type influences risk
  switch (assessment.taskType) {
    case 'refactor':
      score += 15;
      break;
    case 'feature':
      score += 10;
      break;
    case 'bug_fix':
      score += 5;
      break;
    case 'test':
    case 'docs':
      // Lower risk
      break;
    default:
      score += 10;
  }

  // Effort level influences risk (larger = more risk)
  switch (assessment.effortLevel) {
    case 'large':
      score += 20;
      break;
    case 'medium':
      score += 10;
      break;
    case 'small':
      score += 5;
      break;
    case 'quick_win':
      // No additional risk
      break;
  }

  // Cap at 100
  return Math.min(100, score);
}

/**
 * Convert numeric score to risk level
 */
function scoreToLevel(score: number): RiskLevel {
  if (score >= 80) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * Guardrails - Safety guardrails for self-improvement
 */
export const Guardrails = {
  /**
   * Assess the risk of a proposed task
   *
   * @param task - The task to assess
   * @param projectPath - Path to the project
   * @returns Risk assessment with score and recommendations
   */
  assessTaskRisk(task: Task, projectPath: string): RiskAssessment {
    const reasons: string[] = [];
    const affectedFiles: string[] = [];
    let affectsCoreSafety = false;
    let highRiskFileCount = 0;

    // Analyze the PRD JSON to understand what files might be affected
    if (task.prdJson) {
      try {
        const prd = JSON.parse(task.prdJson);

        // Look for file references in user stories
        if (prd.userStories) {
          for (const story of prd.userStories) {
            const storyContent = JSON.stringify(story).toLowerCase();

            // Check for core safety references
            for (const pattern of CORE_SAFETY_PATTERNS) {
              if (storyContent.includes(pattern.toLowerCase().replace(/\.(ts|js)$/, ''))) {
                affectsCoreSafety = true;
                affectedFiles.push(pattern);
                reasons.push(`Modifies core safety file: ${pattern}`);
              }
            }

            // Check for high-risk file patterns
            for (const pattern of HIGH_RISK_FILE_PATTERNS) {
              const searchPattern = pattern.replace(/\*/g, '').replace(/\./g, '');
              if (searchPattern && storyContent.includes(searchPattern)) {
                highRiskFileCount++;
              }
            }
          }
        }
      } catch {
        // PRD JSON parsing failed, assume medium risk
        reasons.push('Could not parse PRD JSON for risk assessment');
      }
    }

    // Check task title and description for high-risk keywords
    const titleKeywords = containsHighRiskKeywords(task.title);
    const sourceKeywords = task.source ? containsHighRiskKeywords(task.source) : [];
    const allKeywords = [...new Set([...titleKeywords, ...sourceKeywords])];

    if (allKeywords.length > 0) {
      reasons.push(`Contains high-risk keywords: ${allKeywords.join(', ')}`);
    }

    // Calculate risk score
    const score = calculateRiskScore({
      affectsCoreSafety,
      highRiskFiles: highRiskFileCount,
      highRiskKeywords: allKeywords,
      totalFilesAffected: affectedFiles.length,
      taskType: task.type,
      effortLevel: task.estimatedEffort,
    });

    const level = scoreToLevel(score);

    // Determine if approval is required
    // High-risk (>70) always requires approval
    const requiresApproval = score > 70 || affectsCoreSafety;

    if (requiresApproval && reasons.length === 0) {
      reasons.push('High overall risk score requires approval');
    }

    return {
      score,
      level,
      requiresApproval,
      reasons,
      affectedFiles,
      affectsCoreSafety,
    };
  },

  /**
   * Assess the risk of a self-improvement opportunity
   *
   * @param opportunity - The opportunity to assess
   * @param projectPath - Path to the project
   * @returns Risk assessment
   */
  assessOpportunityRisk(
    opportunity: SelfImprovementOpportunity,
    projectPath: string
  ): RiskAssessment {
    const reasons: string[] = [];
    const affectedFiles: string[] = [];
    let affectsCoreSafety = false;
    let highRiskFileCount = 0;

    // Check if the opportunity's file is a core safety file
    if (opportunity.file) {
      affectedFiles.push(opportunity.file);

      if (isCoreSafetyFile(opportunity.file)) {
        affectsCoreSafety = true;
        reasons.push(`Modifies core safety file: ${opportunity.file}`);
      }

      if (isHighRiskFile(opportunity.file)) {
        highRiskFileCount++;
        reasons.push(`Affects high-risk file: ${opportunity.file}`);
      }
    }

    // Check description for high-risk keywords
    const descKeywords = containsHighRiskKeywords(opportunity.description);
    const titleKeywords = containsHighRiskKeywords(opportunity.title);
    const allKeywords = [...new Set([...descKeywords, ...titleKeywords])];

    if (allKeywords.length > 0) {
      reasons.push(`Contains high-risk keywords: ${allKeywords.join(', ')}`);
    }

    // Map opportunity properties to task-like properties for scoring
    const taskType = opportunity.suggestedTaskType || 'feature';
    const effortLevel = opportunity.suggestedEffort || 'medium';

    const score = calculateRiskScore({
      affectsCoreSafety,
      highRiskFiles: highRiskFileCount,
      highRiskKeywords: allKeywords,
      totalFilesAffected: affectedFiles.length,
      taskType,
      effortLevel,
    });

    const level = scoreToLevel(score);
    const requiresApproval = score > 70 || affectsCoreSafety || opportunity.requiresApproval;

    return {
      score,
      level,
      requiresApproval,
      reasons,
      affectedFiles,
      affectsCoreSafety,
    };
  },

  /**
   * Check if a file path is protected (core safety code)
   *
   * @param filePath - Path to check
   * @returns True if the file is protected
   */
  isProtectedFile(filePath: string): boolean {
    return isCoreSafetyFile(filePath);
  },

  /**
   * Get list of protected file patterns
   *
   * @returns Array of protected file patterns
   */
  getProtectedPatterns(): string[] {
    return [...CORE_SAFETY_PATTERNS];
  },

  /**
   * Validate that a proposed change is safe to execute
   *
   * @param task - The task to validate
   * @param projectPath - Path to the project
   * @param hasApproval - Whether explicit approval has been given
   * @returns Validation result with details
   */
  validateChange(
    task: Task,
    projectPath: string,
    hasApproval: boolean = false
  ): { allowed: boolean; reason?: string; assessment: RiskAssessment } {
    const assessment = this.assessTaskRisk(task, projectPath);

    // Critical risk is never auto-allowed
    if (assessment.level === 'critical' && !hasApproval) {
      return {
        allowed: false,
        reason: `Critical risk level (${assessment.score}/100) requires explicit approval. ${assessment.reasons.join('; ')}`,
        assessment,
      };
    }

    // Core safety modifications require approval
    if (assessment.affectsCoreSafety && !hasApproval) {
      return {
        allowed: false,
        reason: `Modification of core safety code requires explicit approval: ${assessment.affectedFiles.join(', ')}`,
        assessment,
      };
    }

    // High risk requires approval
    if (assessment.requiresApproval && !hasApproval) {
      return {
        allowed: false,
        reason: `High risk change (${assessment.score}/100) requires approval. ${assessment.reasons.join('; ')}`,
        assessment,
      };
    }

    return {
      allowed: true,
      assessment,
    };
  },

  /**
   * Filter opportunities to only safe ones
   *
   * @param opportunities - Array of opportunities to filter
   * @param projectPath - Path to the project
   * @returns Array of opportunities that are safe to auto-execute
   */
  filterSafeOpportunities(
    opportunities: SelfImprovementOpportunity[],
    projectPath: string
  ): SelfImprovementOpportunity[] {
    return opportunities.filter((opp) => {
      const assessment = this.assessOpportunityRisk(opp, projectPath);
      return !assessment.requiresApproval && assessment.level === 'low';
    });
  },

  /**
   * Categorize opportunities by risk level
   *
   * @param opportunities - Array of opportunities to categorize
   * @param projectPath - Path to the project
   * @returns Object with opportunities grouped by risk level
   */
  categorizeByRisk(
    opportunities: SelfImprovementOpportunity[],
    projectPath: string
  ): Record<RiskLevel, SelfImprovementOpportunity[]> {
    const categorized: Record<RiskLevel, SelfImprovementOpportunity[]> = {
      low: [],
      medium: [],
      high: [],
      critical: [],
    };

    for (const opp of opportunities) {
      const assessment = this.assessOpportunityRisk(opp, projectPath);
      categorized[assessment.level].push(opp);
    }

    return categorized;
  },
};
