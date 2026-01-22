/**
 * Research Coordinator - RESEARCH Phase Implementation
 *
 * Spawns parallel AI agents for codebase analysis during the RESEARCH phase.
 * Five specialized agents run concurrently to analyze:
 * - Code patterns in the project
 * - API contracts and interfaces
 * - Testing strategies
 * - Security concerns
 * - Performance patterns
 *
 * The coordinator synthesizes findings into frozen contracts that guide
 * the GREEN phase implementation.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import {
  type ResearchAgentType,
  type ResearchFindings,
  type ResearchAgent,
  type CodePattern,
  type ContractDefinition,
  type SecurityConcern,
  type FrozenContracts,
} from './types.js';
import { AgentRepository, type CreateAgentInput } from './repositories/index.js';
import { type UserStory, type Prd } from '../collaboration/prd-builder.js';
import { type DatabaseInstance } from '../db/index.js';

/**
 * Context provided to research agents
 */
export interface ResearchContext {
  /** The user story being researched */
  userStory: UserStory;
  /** Full PRD JSON string */
  prdJson: string;
  /** Project root path */
  projectPath: string;
  /** Project name */
  projectName: string;
  /** Relevant file contents for context */
  relevantFiles?: { path: string; content: string }[];
}

/**
 * Result from a single research agent
 */
export interface AgentResult {
  agentType: ResearchAgentType;
  success: boolean;
  findings: ResearchFindings | null;
  error?: string;
  durationMs: number;
}

/**
 * Result of the parallel research phase
 */
export interface ResearchResult {
  success: boolean;
  /** All agent results (including failures) */
  agentResults: AgentResult[];
  /** Synthesized findings from successful agents */
  frozenContracts: FrozenContracts | null;
  /** Error message if overall failure */
  error?: string;
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Metrics about the research */
  metrics: {
    agentsSpawned: number;
    agentsSucceeded: number;
    agentsFailed: number;
    patternsDiscovered: number;
    contractsIdentified: number;
    securityConcernsFound: number;
  };
}

/**
 * Configuration for ResearchCoordinator
 */
export interface ResearchCoordinatorConfig {
  /** Anthropic client (optional, created if not provided) */
  anthropicClient?: Anthropic;
  /** Max tokens for AI responses */
  maxTokens?: number;
  /** Model to use for research agents */
  model?: string;
  /** Timeout per agent in milliseconds */
  agentTimeoutMs?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<Omit<ResearchCoordinatorConfig, 'anthropicClient'>> = {
  maxTokens: 4096,
  model: 'claude-sonnet-4-20250514',
  agentTimeoutMs: 60000, // 1 minute per agent
};

/**
 * All research agent types
 */
const ALL_AGENT_TYPES: ResearchAgentType[] = [
  'patterns',
  'contracts',
  'testing',
  'security',
  'performance',
];

/**
 * Research Coordinator - Spawns parallel AI agents for codebase analysis
 */
export const ResearchCoordinator = {
  /**
   * Create an Anthropic client
   */
  createClient(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is required for research agents. ' +
          'Set it in your shell or .env file.'
      );
    }
    return new Anthropic({ apiKey });
  },

  /**
   * Run all research agents in parallel
   *
   * @param agentTypes - Types of agents to spawn (defaults to all 5)
   * @param context - Context for research agents
   * @param phaseId - The TDD phase ID for database records
   * @param config - Optional configuration
   * @param db - Optional database instance
   * @returns Research result with synthesized findings
   */
  async runParallel(
    agentTypes: ResearchAgentType[] = ALL_AGENT_TYPES,
    context: ResearchContext,
    phaseId: string,
    config: ResearchCoordinatorConfig = {},
    db?: DatabaseInstance
  ): Promise<ResearchResult> {
    const client = config.anthropicClient ?? this.createClient();
    const maxTokens = config.maxTokens ?? DEFAULT_CONFIG.maxTokens;
    const model = config.model ?? DEFAULT_CONFIG.model;
    const agentTimeoutMs = config.agentTimeoutMs ?? DEFAULT_CONFIG.agentTimeoutMs;

    const startTime = Date.now();
    const agentResults: AgentResult[] = [];

    try {
      // Create agent records in database for all agents
      const agentRecords: Map<ResearchAgentType, ResearchAgent> = new Map();
      for (const agentType of agentTypes) {
        const record = AgentRepository.create(
          {
            phaseId,
            agentType,
            status: 'pending',
          },
          db
        );
        agentRecords.set(agentType, record);
      }

      // Create agent functions
      const agentFunctions = agentTypes.map((agentType) => {
        const record = agentRecords.get(agentType)!;
        return this.runAgent(
          agentType,
          context,
          record.id,
          { client, maxTokens, model, agentTimeoutMs },
          db
        );
      });

      // Run all agents in parallel using Promise.all
      // This is where the 5x speedup comes from
      const results = await Promise.all(agentFunctions);
      agentResults.push(...results);

      // Count successes and failures
      const successfulResults = agentResults.filter((r) => r.success);
      const failedResults = agentResults.filter((r) => !r.success);

      // Synthesize findings from successful agents
      let frozenContracts: FrozenContracts | null = null;
      if (successfulResults.length > 0) {
        const findings = successfulResults
          .map((r) => r.findings)
          .filter((f): f is ResearchFindings => f !== null);
        frozenContracts = this.synthesizeFindings(findings, context);
      }

      // Calculate metrics
      const metrics = this.calculateMetrics(agentResults);

      const totalDurationMs = Date.now() - startTime;

      // Return partial success if at least some agents succeeded
      return {
        success: successfulResults.length > 0,
        agentResults,
        frozenContracts,
        error:
          failedResults.length > 0
            ? `${failedResults.length} agent(s) failed: ${failedResults.map((r) => r.agentType).join(', ')}`
            : undefined,
        totalDurationMs,
        metrics,
      };
    } catch (error) {
      const totalDurationMs = Date.now() - startTime;
      return {
        success: false,
        agentResults,
        frozenContracts: null,
        error: error instanceof Error ? error.message : String(error),
        totalDurationMs,
        metrics: this.calculateMetrics(agentResults),
      };
    }
  },

  /**
   * Run a single research agent
   *
   * @param agentType - Type of agent to run
   * @param context - Research context
   * @param agentId - Database ID for this agent
   * @param aiConfig - AI configuration
   * @param db - Optional database instance
   * @returns Agent result
   */
  async runAgent(
    agentType: ResearchAgentType,
    context: ResearchContext,
    agentId: string,
    aiConfig: {
      client: Anthropic;
      maxTokens: number;
      model: string;
      agentTimeoutMs: number;
    },
    db?: DatabaseInstance
  ): Promise<AgentResult> {
    const { client, maxTokens, model, agentTimeoutMs } = aiConfig;
    const startTime = Date.now();

    try {
      // Update status to running
      AgentRepository.update(
        agentId,
        { status: 'running', startedAt: new Date().toISOString() },
        db
      );

      // Get the appropriate agent creator
      const agentCreator = this.getAgentCreator(agentType);
      const { systemPrompt, userPrompt } = agentCreator(context);

      // Run the agent with timeout
      const response = await this.runWithTimeout(
        client.messages.create({
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
        agentTimeoutMs
      );

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text response from agent');
      }

      // Parse findings from response
      const findings = this.parseAgentResponse(agentType, textContent.text);
      const durationMs = Date.now() - startTime;

      // Update database with success
      AgentRepository.update(
        agentId,
        {
          status: 'completed',
          findings,
          completedAt: new Date().toISOString(),
          durationMs,
        },
        db
      );

      return {
        agentType,
        success: true,
        findings,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Determine if timeout
      const status = errorMessage.includes('timeout') ? 'timeout' : 'failed';

      // Update database with failure
      AgentRepository.update(
        agentId,
        {
          status,
          completedAt: new Date().toISOString(),
          durationMs,
        },
        db
      );

      return {
        agentType,
        success: false,
        findings: null,
        error: errorMessage,
        durationMs,
      };
    }
  },

  /**
   * Run a promise with timeout
   */
  async runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Agent timeout')), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]);
  },

  /**
   * Get the agent creator function for a given agent type
   */
  getAgentCreator(
    agentType: ResearchAgentType
  ): (context: ResearchContext) => { systemPrompt: string; userPrompt: string } {
    switch (agentType) {
      case 'patterns':
        return this.createPatternsAgent;
      case 'contracts':
        return this.createContractsAgent;
      case 'testing':
        return this.createTestingAgent;
      case 'security':
        return this.createSecurityAgent;
      case 'performance':
        return this.createPerformanceAgent;
      default:
        throw new Error(`Unknown agent type: ${agentType}`);
    }
  },

  /**
   * Create patterns research agent - researches code patterns in project
   */
  createPatternsAgent(context: ResearchContext): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `You are a code patterns research agent. Your task is to analyze a codebase and identify:
1. Design patterns used (e.g., Repository, Factory, Observer)
2. Architectural patterns (e.g., MVC, layered, hexagonal)
3. Coding conventions and style patterns
4. Common abstractions and utilities
5. Module organization patterns

Respond in JSON format:
{
  "summary": "Brief summary of patterns found",
  "recommendations": ["List of recommendations for new code"],
  "patterns": [
    {
      "name": "Pattern name",
      "description": "Description of how it's used",
      "examples": ["file1.ts", "file2.ts"]
    }
  ]
}`;

    const userPrompt = `Analyze the following project for code patterns:

## Project: ${context.projectName}
## Path: ${context.projectPath}

## User Story Being Implemented:
${context.userStory.title}
${context.userStory.description}

## Acceptance Criteria:
${context.userStory.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

## PRD Context:
${context.prdJson}

${context.relevantFiles ? `## Relevant Files:\n${context.relevantFiles.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}` : ''}

Identify patterns that should be followed when implementing this feature.`;

    return { systemPrompt, userPrompt };
  },

  /**
   * Create contracts research agent - researches API contracts/interfaces
   */
  createContractsAgent(context: ResearchContext): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `You are an API contracts research agent. Your task is to analyze a codebase and identify:
1. UI layer contracts (props, state interfaces)
2. API layer contracts (request/response schemas, endpoints)
3. Database layer contracts (models, schemas, migrations)
4. TypeScript interfaces and types
5. Data flow between layers

Respond in JSON format:
{
  "summary": "Brief summary of contracts found",
  "recommendations": ["List of contract-related recommendations"],
  "contracts": [
    {
      "layer": "ui" | "api" | "db",
      "contractType": "Type name",
      "definition": "TypeScript interface or schema",
      "implementedBy": ["file1.ts", "file2.ts"]
    }
  ]
}`;

    const userPrompt = `Analyze the following project for API contracts and interfaces:

## Project: ${context.projectName}
## Path: ${context.projectPath}

## User Story Being Implemented:
${context.userStory.title}
${context.userStory.description}

## Acceptance Criteria:
${context.userStory.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

## PRD Context:
${context.prdJson}

${context.relevantFiles ? `## Relevant Files:\n${context.relevantFiles.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}` : ''}

Identify contracts and interfaces that the new feature should conform to.`;

    return { systemPrompt, userPrompt };
  },

  /**
   * Create testing research agent - researches testing strategies
   */
  createTestingAgent(context: ResearchContext): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `You are a testing strategies research agent. Your task is to analyze a codebase and identify:
1. Testing frameworks used (Jest, Vitest, Mocha, etc.)
2. Test organization patterns (co-located vs __tests__)
3. Mocking strategies and test utilities
4. Test coverage patterns
5. Integration test approaches

Respond in JSON format:
{
  "summary": "Brief summary of testing approach",
  "recommendations": ["List of testing recommendations for new code"],
  "testingStrategies": ["Strategy 1", "Strategy 2", ...],
  "patterns": [
    {
      "name": "Testing pattern name",
      "description": "How testing is done",
      "examples": ["test1.test.ts", "test2.spec.ts"]
    }
  ]
}`;

    const userPrompt = `Analyze the following project for testing strategies:

## Project: ${context.projectName}
## Path: ${context.projectPath}

## User Story Being Implemented:
${context.userStory.title}
${context.userStory.description}

## Acceptance Criteria:
${context.userStory.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

## PRD Context:
${context.prdJson}

${context.relevantFiles ? `## Relevant Files:\n${context.relevantFiles.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}` : ''}

Identify testing strategies that should be used for this feature.`;

    return { systemPrompt, userPrompt };
  },

  /**
   * Create security research agent - researches security concerns
   */
  createSecurityAgent(context: ResearchContext): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `You are a security research agent. Your task is to analyze a codebase and identify:
1. Authentication/authorization patterns
2. Input validation approaches
3. Data sanitization practices
4. Security headers and CORS config
5. Potential security concerns for new features

Respond in JSON format:
{
  "summary": "Brief summary of security approach",
  "recommendations": ["List of security recommendations"],
  "securityConcerns": [
    {
      "severity": "P0" | "P1" | "P2" | "P3",
      "category": "Category name",
      "description": "Description of concern",
      "recommendation": "How to address it"
    }
  ],
  "patterns": [
    {
      "name": "Security pattern name",
      "description": "How security is handled",
      "examples": ["auth.ts", "validation.ts"]
    }
  ]
}`;

    const userPrompt = `Analyze the following project for security concerns:

## Project: ${context.projectName}
## Path: ${context.projectPath}

## User Story Being Implemented:
${context.userStory.title}
${context.userStory.description}

## Acceptance Criteria:
${context.userStory.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

## PRD Context:
${context.prdJson}

${context.relevantFiles ? `## Relevant Files:\n${context.relevantFiles.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}` : ''}

Identify security considerations for implementing this feature.`;

    return { systemPrompt, userPrompt };
  },

  /**
   * Create performance research agent - researches performance patterns
   */
  createPerformanceAgent(context: ResearchContext): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `You are a performance research agent. Your task is to analyze a codebase and identify:
1. Caching strategies used
2. Database query optimization patterns
3. Lazy loading and code splitting
4. Memory management practices
5. Performance bottleneck concerns

Respond in JSON format:
{
  "summary": "Brief summary of performance approach",
  "recommendations": ["List of performance recommendations"],
  "performanceNotes": ["Note 1", "Note 2", ...],
  "patterns": [
    {
      "name": "Performance pattern name",
      "description": "How performance is optimized",
      "examples": ["cache.ts", "query.ts"]
    }
  ]
}`;

    const userPrompt = `Analyze the following project for performance patterns:

## Project: ${context.projectName}
## Path: ${context.projectPath}

## User Story Being Implemented:
${context.userStory.title}
${context.userStory.description}

## Acceptance Criteria:
${context.userStory.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

## PRD Context:
${context.prdJson}

${context.relevantFiles ? `## Relevant Files:\n${context.relevantFiles.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}` : ''}

Identify performance considerations for implementing this feature.`;

    return { systemPrompt, userPrompt };
  },

  /**
   * Parse agent response into ResearchFindings
   */
  parseAgentResponse(agentType: ResearchAgentType, response: string): ResearchFindings {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // If no JSON, create basic findings from raw text
        return {
          agentType,
          summary: 'Unable to parse structured response',
          recommendations: [],
          rawOutput: response,
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        agentType,
        summary: parsed.summary || 'No summary provided',
        recommendations: parsed.recommendations || [],
        patterns: parsed.patterns as CodePattern[] | undefined,
        contracts: parsed.contracts as ContractDefinition[] | undefined,
        securityConcerns: parsed.securityConcerns as SecurityConcern[] | undefined,
        performanceNotes: parsed.performanceNotes as string[] | undefined,
        testingStrategies: parsed.testingStrategies as string[] | undefined,
        rawOutput: response,
      };
    } catch {
      // On parse error, return raw output
      return {
        agentType,
        summary: 'Parse error - see raw output',
        recommendations: [],
        rawOutput: response,
      };
    }
  },

  /**
   * Synthesize findings from all agents into frozen contracts
   */
  synthesizeFindings(
    findings: ResearchFindings[],
    context: ResearchContext
  ): FrozenContracts {
    // Collect all patterns from all agents
    const allPatterns: CodePattern[] = [];
    for (const finding of findings) {
      if (finding.patterns) {
        allPatterns.push(...finding.patterns);
      }
    }

    // Collect contracts by layer
    const uiContracts: ContractDefinition[] = [];
    const apiContracts: ContractDefinition[] = [];
    const dbContracts: ContractDefinition[] = [];

    for (const finding of findings) {
      if (finding.contracts) {
        for (const contract of finding.contracts) {
          switch (contract.layer) {
            case 'ui':
              uiContracts.push(contract);
              break;
            case 'api':
              apiContracts.push(contract);
              break;
            case 'db':
              dbContracts.push(contract);
              break;
          }
        }
      }
    }

    // Collect all recommendations
    const allRecommendations: string[] = [];
    for (const finding of findings) {
      allRecommendations.push(...finding.recommendations);
    }

    // Collect security concerns and performance notes
    const securityConcerns: SecurityConcern[] = [];
    const performanceNotes: string[] = [];
    const testingStrategies: string[] = [];

    for (const finding of findings) {
      if (finding.securityConcerns) {
        securityConcerns.push(...finding.securityConcerns);
      }
      if (finding.performanceNotes) {
        performanceNotes.push(...finding.performanceNotes);
      }
      if (finding.testingStrategies) {
        testingStrategies.push(...finding.testingStrategies);
      }
    }

    // Build implementation guidance from all findings
    const implementationGuidance = this.buildImplementationGuidance(
      findings,
      allRecommendations,
      securityConcerns,
      performanceNotes,
      testingStrategies,
      context
    );

    return {
      frozenAt: new Date().toISOString(),
      ui: uiContracts,
      api: apiContracts,
      db: dbContracts,
      implementationGuidance,
      patterns: allPatterns,
    };
  },

  /**
   * Build implementation guidance text from findings
   */
  buildImplementationGuidance(
    findings: ResearchFindings[],
    recommendations: string[],
    securityConcerns: SecurityConcern[],
    performanceNotes: string[],
    testingStrategies: string[],
    context: ResearchContext
  ): string {
    const sections: string[] = [];

    // Summary section
    sections.push('# Implementation Guidance');
    sections.push('');
    sections.push(`## User Story: ${context.userStory.title}`);
    sections.push(context.userStory.description);
    sections.push('');

    // Recommendations
    if (recommendations.length > 0) {
      sections.push('## Recommendations');
      for (const rec of recommendations) {
        sections.push(`- ${rec}`);
      }
      sections.push('');
    }

    // Security considerations
    if (securityConcerns.length > 0) {
      sections.push('## Security Considerations');
      for (const concern of securityConcerns) {
        sections.push(`- [${concern.severity}] ${concern.category}: ${concern.description}`);
        sections.push(`  Recommendation: ${concern.recommendation}`);
      }
      sections.push('');
    }

    // Performance notes
    if (performanceNotes.length > 0) {
      sections.push('## Performance Considerations');
      for (const note of performanceNotes) {
        sections.push(`- ${note}`);
      }
      sections.push('');
    }

    // Testing strategies
    if (testingStrategies.length > 0) {
      sections.push('## Testing Strategies');
      for (const strategy of testingStrategies) {
        sections.push(`- ${strategy}`);
      }
      sections.push('');
    }

    // Agent summaries
    sections.push('## Research Agent Summaries');
    for (const finding of findings) {
      sections.push(`### ${finding.agentType.charAt(0).toUpperCase() + finding.agentType.slice(1)} Agent`);
      sections.push(finding.summary);
      sections.push('');
    }

    return sections.join('\n');
  },

  /**
   * Calculate metrics from agent results
   */
  calculateMetrics(agentResults: AgentResult[]): ResearchResult['metrics'] {
    let patternsDiscovered = 0;
    let contractsIdentified = 0;
    let securityConcernsFound = 0;

    for (const result of agentResults) {
      if (result.success && result.findings) {
        patternsDiscovered += result.findings.patterns?.length ?? 0;
        contractsIdentified += result.findings.contracts?.length ?? 0;
        securityConcernsFound += result.findings.securityConcerns?.length ?? 0;
      }
    }

    return {
      agentsSpawned: agentResults.length,
      agentsSucceeded: agentResults.filter((r) => r.success).length,
      agentsFailed: agentResults.filter((r) => !r.success).length,
      patternsDiscovered,
      contractsIdentified,
      securityConcernsFound,
    };
  },

  /**
   * Load relevant files for research context
   *
   * @param projectPath - Project root path
   * @param patterns - Glob patterns to match files
   * @param maxFiles - Maximum number of files to load
   * @returns Array of file contents
   */
  loadRelevantFiles(
    projectPath: string,
    patterns: string[] = ['src/**/*.ts', 'src/**/*.tsx'],
    maxFiles: number = 20
  ): { path: string; content: string }[] {
    const files: { path: string; content: string }[] = [];

    // Simple file discovery (not using glob for simplicity)
    const srcDir = path.join(projectPath, 'src');
    if (!fs.existsSync(srcDir)) {
      return files;
    }

    const discoverFiles = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const results: string[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          results.push(...discoverFiles(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          results.push(fullPath);
        }
      }

      return results;
    };

    const allFiles = discoverFiles(srcDir).slice(0, maxFiles);

    for (const filePath of allFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Limit content size per file
        const truncatedContent = content.slice(0, 5000);
        files.push({
          path: path.relative(projectPath, filePath),
          content: truncatedContent,
        });
      } catch {
        // Skip files that can't be read
      }
    }

    return files;
  },
};
