/**
 * Onboarding Engine - Orchestrates project analysis and proposal generation
 *
 * When projects are added to MetaRalph, the onboarding engine:
 * 1. Validates the project is a git repository
 * 2. Analyzes the codebase for improvement opportunities
 * 3. Extracts TODO/FIXME comments
 * 4. Generates task proposals from findings
 * 5. Creates an initial conversation with a summary
 */

import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { CodebaseAnalyzer, type ImprovementOpportunity } from './analyzer.js';
import { TodoExtractor, type TodoComment } from './todo-extractor.js';
import { ProposalGenerator, type ProposalGenerationResult, type ProposalGenerationOptions } from './proposal-generator.js';
import { isGitRepository, getProject, type Project } from '../registry/index.js';
import { initDatabase, type DatabaseInstance } from '../db/index.js';

/**
 * Result of the onboarding process
 */
export interface OnboardingResult {
  success: boolean;
  message: string;
  project?: Project;
  analysis?: {
    opportunities: ImprovementOpportunity[];
    todos: TodoComment[];
    todoSummary: {
      TODO: number;
      FIXME: number;
      XXX: number;
      HACK: number;
      total: number;
    };
  };
  proposals?: ProposalGenerationResult;
  conversationId?: string;
}

/**
 * Options for the onboarding process
 */
export interface OnboardingOptions {
  /** Generate task proposals from findings (default: true) */
  generateProposals?: boolean;
  /** Create an initial conversation with summary (default: true) */
  createConversation?: boolean;
  /** Options for proposal generation */
  proposalOptions?: ProposalGenerationOptions;
  /** Skip analysis (useful for re-onboarding) */
  skipAnalysis?: boolean;
}

/**
 * Update project's last_analyzed timestamp
 */
function updateProjectLastAnalyzed(
  projectId: string,
  db: DatabaseInstance
): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE projects
    SET last_analyzed = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, projectId);
}

/**
 * Create an initial conversation with onboarding summary
 */
function createOnboardingSummaryConversation(
  project: Project,
  opportunities: ImprovementOpportunity[],
  todoSummary: { TODO: number; FIXME: number; XXX: number; HACK: number; total: number },
  proposalResult: ProposalGenerationResult | undefined,
  db: DatabaseInstance
): string {
  const conversationId = uuidv4();
  const now = new Date().toISOString();

  // Create conversation
  db.prepare(`
    INSERT INTO conversations (id, project_id, title, status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `).run(conversationId, project.id, `Onboarding Analysis - ${project.name}`, now, now);

  // Build summary message
  let summary = `# Onboarding Analysis for ${project.name}\n\n`;
  summary += `Analysis completed at: ${now}\n\n`;

  // Analysis findings summary
  summary += `## Analysis Findings\n\n`;

  // Group opportunities by type
  const byType = opportunities.reduce((acc, opp) => {
    acc[opp.type] = (acc[opp.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (Object.keys(byType).length > 0) {
    summary += `### Issues Found:\n`;
    if (byType.outdated_dep) summary += `- Outdated dependencies: ${byType.outdated_dep}\n`;
    if (byType.type_error) summary += `- Type errors: ${byType.type_error}\n`;
    if (byType.lint_issue) summary += `- Lint issues: ${byType.lint_issue}\n`;
    summary += '\n';
  } else {
    summary += 'No issues found from automated analysis.\n\n';
  }

  // TODO summary
  summary += `### TODO Comments:\n`;
  summary += `- TODO: ${todoSummary.TODO}\n`;
  summary += `- FIXME: ${todoSummary.FIXME}\n`;
  summary += `- XXX: ${todoSummary.XXX}\n`;
  summary += `- HACK: ${todoSummary.HACK}\n`;
  summary += `- Total: ${todoSummary.total}\n\n`;

  // Proposal summary
  if (proposalResult) {
    summary += `## Generated Proposals\n\n`;
    summary += `- Total opportunities: ${proposalResult.summary.totalOpportunities}\n`;
    summary += `- Proposals generated: ${proposalResult.summary.proposalsGenerated}\n`;
    summary += `- Tasks auto-queued: ${proposalResult.summary.tasksAutoQueued}\n`;
    summary += `- Tasks pending approval: ${proposalResult.summary.tasksPendingApproval}\n\n`;
  }

  // Add recommendations
  summary += `## Recommendations\n\n`;

  if (todoSummary.FIXME > 0) {
    summary += `- **High Priority**: Address ${todoSummary.FIXME} FIXME comments as they may indicate bugs or critical issues.\n`;
  }

  if (byType.type_error) {
    summary += `- **High Priority**: Fix ${byType.type_error} TypeScript type errors to ensure type safety.\n`;
  }

  if (byType.outdated_dep) {
    summary += `- **Medium Priority**: Update ${byType.outdated_dep} outdated dependencies to improve security and access new features.\n`;
  }

  if (todoSummary.HACK > 0) {
    summary += `- **Medium Priority**: Refactor ${todoSummary.HACK} HACK comments to improve code quality.\n`;
  }

  summary += `\nUse \`metaralph queue\` to view pending tasks or \`metaralph approve <id>\` to approve tasks for execution.`;

  // Create system message
  const messageId = uuidv4();
  db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, created_at)
    VALUES (?, ?, 'system', ?, ?)
  `).run(messageId, conversationId, summary, now);

  return conversationId;
}

/**
 * OnboardingEngine - Main engine for project onboarding
 */
export const OnboardingEngine = {
  /**
   * Onboard a project - analyze and generate improvement proposals
   *
   * @param projectPath - Path to the project directory
   * @param options - Onboarding options
   * @returns Onboarding result
   */
  async onboard(
    projectPath: string,
    options: OnboardingOptions = {}
  ): Promise<OnboardingResult> {
    const {
      generateProposals = true,
      createConversation = true,
      proposalOptions = {},
      skipAnalysis = false,
    } = options;

    const db = initDatabase();

    try {
      // Resolve to absolute path
      const absolutePath = path.resolve(projectPath);

      // Validate git repository
      if (!isGitRepository(absolutePath)) {
        return {
          success: false,
          message: `Path is not a git repository: ${absolutePath}`,
        };
      }

      // Get the project from registry
      const project = db.prepare('SELECT * FROM projects WHERE path = ?').get(absolutePath) as Project | undefined;

      if (!project) {
        return {
          success: false,
          message: `Project not registered. Use 'metaralph projects add ${absolutePath}' first.`,
        };
      }

      let opportunities: ImprovementOpportunity[] = [];
      let todos: TodoComment[] = [];
      let todoSummary = { TODO: 0, FIXME: 0, XXX: 0, HACK: 0, total: 0 };

      // Run analysis unless skipped
      if (!skipAnalysis) {
        // Analyze codebase
        opportunities = await CodebaseAnalyzer.analyze(absolutePath);

        // Extract TODOs and add to opportunities
        todos = TodoExtractor.extract(absolutePath);
        todoSummary = TodoExtractor.getSummary(absolutePath);
        const todoOpportunities = TodoExtractor.extractAsOpportunities(absolutePath);
        opportunities.push(...todoOpportunities);

        // Update last_analyzed timestamp
        updateProjectLastAnalyzed(project.id, db);
      }

      // Generate proposals if requested
      let proposalResult: ProposalGenerationResult | undefined;
      if (generateProposals && opportunities.length > 0) {
        proposalResult = ProposalGenerator.generate(
          project.id,
          opportunities,
          proposalOptions,
          db
        );
      }

      // Create summary conversation if requested
      let conversationId: string | undefined;
      if (createConversation) {
        conversationId = createOnboardingSummaryConversation(
          project,
          opportunities,
          todoSummary,
          proposalResult,
          db
        );
      }

      return {
        success: true,
        message: `Onboarding complete for ${project.name}`,
        project,
        analysis: {
          opportunities,
          todos,
          todoSummary,
        },
        proposals: proposalResult,
        conversationId,
      };
    } finally {
      db.close();
    }
  },

  /**
   * Re-analyze an existing project
   *
   * @param projectId - The project ID to re-analyze
   * @param options - Onboarding options
   * @returns Onboarding result
   */
  async analyze(
    projectId: string,
    options: OnboardingOptions = {}
  ): Promise<OnboardingResult> {
    const db = initDatabase();

    try {
      // Get the project
      const project = getProject(projectId, db);

      if (!project) {
        return {
          success: false,
          message: `Project not found: ${projectId}`,
        };
      }

      // Run onboarding on the project path
      return this.onboard(project.path, options);
    } finally {
      db.close();
    }
  },

  /**
   * Preview analysis without generating tasks
   *
   * @param projectPath - Path to the project directory
   * @returns Onboarding result with preview (no tasks created)
   */
  async preview(projectPath: string): Promise<OnboardingResult> {
    return this.onboard(projectPath, {
      generateProposals: true,
      createConversation: false,
      proposalOptions: {
        createTasks: false,
      },
    });
  },
};

// Re-export types and modules for convenience
export { CodebaseAnalyzer, type ImprovementOpportunity } from './analyzer.js';
export { TodoExtractor, type TodoComment } from './todo-extractor.js';
export { ProposalGenerator, type Proposal, type ProposalGenerationResult, type ProposalGenerationOptions } from './proposal-generator.js';
