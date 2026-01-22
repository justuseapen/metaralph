/**
 * Tests for research-coordinator.ts - RESEARCH phase parallel AI agent analysis
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UserStory, Prd } from '../collaboration/prd-builder.js';
import type {
  ResearchAgentType,
  ResearchFindings,
  CodePattern,
  ContractDefinition,
  SecurityConcern,
  FrozenContracts,
} from './types.js';

// Create hoisted mock functions to be used in vi.mock factories
const {
  mockAgentRepositoryCreate,
  mockAgentRepositoryUpdate,
  mockAgentRepositoryFindById,
  mockAnthropicCreate,
  mockFsExistsSync,
  mockFsReadFileSync,
  mockFsReaddirSync,
  mockUuidv4,
} = vi.hoisted(() => ({
  mockAgentRepositoryCreate: vi.fn(),
  mockAgentRepositoryUpdate: vi.fn(),
  mockAgentRepositoryFindById: vi.fn(),
  mockAnthropicCreate: vi.fn(),
  mockFsExistsSync: vi.fn(),
  mockFsReadFileSync: vi.fn(),
  mockFsReaddirSync: vi.fn(),
  mockUuidv4: vi.fn(),
}));

// Mock uuid module
vi.mock('uuid', () => ({
  v4: mockUuidv4,
}));

// Mock repositories
vi.mock('./repositories/index.js', () => ({
  AgentRepository: {
    create: mockAgentRepositoryCreate,
    update: mockAgentRepositoryUpdate,
    findById: mockAgentRepositoryFindById,
  },
}));

// Mock fs module
vi.mock('node:fs', () => ({
  default: {
    existsSync: mockFsExistsSync,
    readFileSync: mockFsReadFileSync,
    readdirSync: mockFsReaddirSync,
  },
  existsSync: mockFsExistsSync,
  readFileSync: mockFsReadFileSync,
  readdirSync: mockFsReaddirSync,
}));

// Import after mocks are set up
import {
  ResearchCoordinator,
  type ResearchContext,
  type ResearchCoordinatorConfig,
  type AgentResult,
  type ResearchResult,
} from './research-coordinator.js';

/**
 * Helper to create a UserStory with minimal required fields
 */
function createUserStory(options: Partial<UserStory> = {}): UserStory {
  return {
    id: options.id ?? 'US-001',
    title: options.title ?? 'Test Story',
    description: options.description ?? 'As a user, I want to test things so that tests exist',
    acceptanceCriteria: options.acceptanceCriteria ?? ['Add a function', 'Function returns correct value', 'Typecheck passes'],
    priority: options.priority ?? 1,
    passes: options.passes ?? false,
    notes: options.notes ?? '',
    dependsOn: options.dependsOn,
  };
}

/**
 * Helper to create a ResearchContext with minimal required fields
 */
function createResearchContext(options: Partial<ResearchContext> = {}): ResearchContext {
  return {
    userStory: options.userStory ?? createUserStory(),
    prdJson: options.prdJson ?? JSON.stringify({ project: 'test', userStories: [] }),
    projectPath: options.projectPath ?? '/test/project',
    projectName: options.projectName ?? 'test-project',
    relevantFiles: options.relevantFiles,
  };
}

/**
 * Helper to create a mock Anthropic client
 */
function createMockAnthropicClient() {
  return {
    messages: {
      create: mockAnthropicCreate,
    },
  };
}

/**
 * Create a mock AI response with JSON findings
 */
function createMockAiResponse(findings: object) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(findings, null, 2),
      },
    ],
  };
}

/**
 * Create a mock agent record
 */
function createMockAgentRecord(
  id: string,
  phaseId: string,
  agentType: ResearchAgentType,
  status: string = 'pending'
) {
  return {
    id,
    phaseId,
    agentType,
    status,
    findings: null,
    startedAt: null,
    completedAt: null,
    durationMs: undefined,
  };
}

/**
 * Create mock patterns agent response
 */
function createPatternsResponse(patterns: CodePattern[] = []) {
  return {
    summary: 'Found code patterns',
    recommendations: ['Follow existing patterns'],
    patterns,
  };
}

/**
 * Create mock contracts agent response
 */
function createContractsResponse(contracts: ContractDefinition[] = []) {
  return {
    summary: 'Found contracts',
    recommendations: ['Define clear interfaces'],
    contracts,
  };
}

/**
 * Create mock testing agent response
 */
function createTestingResponse() {
  return {
    summary: 'Found testing strategies',
    recommendations: ['Write unit tests first'],
    testingStrategies: ['Unit testing', 'Integration testing'],
    patterns: [],
  };
}

/**
 * Create mock security agent response
 */
function createSecurityResponse(concerns: SecurityConcern[] = []) {
  return {
    summary: 'Found security patterns',
    recommendations: ['Validate all inputs'],
    securityConcerns: concerns,
    patterns: [],
  };
}

/**
 * Create mock performance agent response
 */
function createPerformanceResponse() {
  return {
    summary: 'Found performance patterns',
    recommendations: ['Use caching'],
    performanceNotes: ['Consider lazy loading'],
    patterns: [],
  };
}

describe('research-coordinator.ts', () => {
  let uuidCounter = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    mockUuidv4.mockImplementation(() => `uuid-${++uuidCounter}`);

    // Default agent repository mocks
    mockAgentRepositoryCreate.mockImplementation((input: { phaseId: string; agentType: ResearchAgentType }) => {
      return createMockAgentRecord(mockUuidv4(), input.phaseId, input.agentType);
    });
    mockAgentRepositoryUpdate.mockImplementation((id: string) => {
      return { id };
    });
    mockAgentRepositoryFindById.mockImplementation((id: string) => {
      return { id };
    });

    // Default fs mocks
    mockFsExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createClient', () => {
    it('should throw error when ANTHROPIC_API_KEY is not set', () => {
      const originalEnv = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      expect(() => ResearchCoordinator.createClient()).toThrow('ANTHROPIC_API_KEY environment variable is required');

      process.env.ANTHROPIC_API_KEY = originalEnv;
    });

    it('should create client when ANTHROPIC_API_KEY is set', () => {
      const originalEnv = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-api-key';

      const client = ResearchCoordinator.createClient();
      expect(client).toBeDefined();

      process.env.ANTHROPIC_API_KEY = originalEnv;
    });
  });

  describe('getAgentCreator', () => {
    it('should return patterns agent creator', () => {
      const creator = ResearchCoordinator.getAgentCreator('patterns');
      expect(creator).toBeDefined();
      expect(typeof creator).toBe('function');
    });

    it('should return contracts agent creator', () => {
      const creator = ResearchCoordinator.getAgentCreator('contracts');
      expect(creator).toBeDefined();
    });

    it('should return testing agent creator', () => {
      const creator = ResearchCoordinator.getAgentCreator('testing');
      expect(creator).toBeDefined();
    });

    it('should return security agent creator', () => {
      const creator = ResearchCoordinator.getAgentCreator('security');
      expect(creator).toBeDefined();
    });

    it('should return performance agent creator', () => {
      const creator = ResearchCoordinator.getAgentCreator('performance');
      expect(creator).toBeDefined();
    });

    it('should throw error for unknown agent type', () => {
      expect(() => ResearchCoordinator.getAgentCreator('unknown' as ResearchAgentType)).toThrow('Unknown agent type');
    });
  });

  describe('createPatternsAgent', () => {
    it('should create prompts for patterns agent', () => {
      const context = createResearchContext();
      const { systemPrompt, userPrompt } = ResearchCoordinator.createPatternsAgent(context);

      expect(systemPrompt).toContain('code patterns research agent');
      expect(systemPrompt).toContain('Design patterns');
      expect(systemPrompt).toContain('JSON format');
      expect(userPrompt).toContain(context.projectName);
      expect(userPrompt).toContain(context.userStory.title);
    });

    it('should include relevant files when provided', () => {
      const context = createResearchContext({
        relevantFiles: [{ path: 'src/index.ts', content: 'export function main() {}' }],
      });
      const { userPrompt } = ResearchCoordinator.createPatternsAgent(context);

      expect(userPrompt).toContain('Relevant Files');
      expect(userPrompt).toContain('src/index.ts');
      expect(userPrompt).toContain('export function main()');
    });
  });

  describe('createContractsAgent', () => {
    it('should create prompts for contracts agent', () => {
      const context = createResearchContext();
      const { systemPrompt, userPrompt } = ResearchCoordinator.createContractsAgent(context);

      expect(systemPrompt).toContain('API contracts research agent');
      expect(systemPrompt).toContain('UI layer contracts');
      expect(systemPrompt).toContain('API layer contracts');
      expect(systemPrompt).toContain('Database layer contracts');
      expect(userPrompt).toContain(context.projectName);
    });
  });

  describe('createTestingAgent', () => {
    it('should create prompts for testing agent', () => {
      const context = createResearchContext();
      const { systemPrompt, userPrompt } = ResearchCoordinator.createTestingAgent(context);

      expect(systemPrompt).toContain('testing strategies research agent');
      expect(systemPrompt).toContain('Testing frameworks');
      expect(systemPrompt).toContain('Mocking strategies');
      expect(userPrompt).toContain(context.projectName);
    });
  });

  describe('createSecurityAgent', () => {
    it('should create prompts for security agent', () => {
      const context = createResearchContext();
      const { systemPrompt, userPrompt } = ResearchCoordinator.createSecurityAgent(context);

      expect(systemPrompt).toContain('security research agent');
      expect(systemPrompt).toContain('Authentication/authorization');
      expect(systemPrompt).toContain('Input validation');
      expect(userPrompt).toContain(context.projectName);
    });
  });

  describe('createPerformanceAgent', () => {
    it('should create prompts for performance agent', () => {
      const context = createResearchContext();
      const { systemPrompt, userPrompt } = ResearchCoordinator.createPerformanceAgent(context);

      expect(systemPrompt).toContain('performance research agent');
      expect(systemPrompt).toContain('Caching strategies');
      expect(systemPrompt).toContain('Database query optimization');
      expect(userPrompt).toContain(context.projectName);
    });
  });

  describe('parseAgentResponse', () => {
    it('should parse valid JSON response', () => {
      const response = JSON.stringify({
        summary: 'Test summary',
        recommendations: ['Rec 1', 'Rec 2'],
        patterns: [{ name: 'Factory', description: 'Factory pattern', examples: ['file.ts'] }],
      });

      const findings = ResearchCoordinator.parseAgentResponse('patterns', response);

      expect(findings.agentType).toBe('patterns');
      expect(findings.summary).toBe('Test summary');
      expect(findings.recommendations).toEqual(['Rec 1', 'Rec 2']);
      expect(findings.patterns).toHaveLength(1);
      expect(findings.patterns![0].name).toBe('Factory');
    });

    it('should parse JSON embedded in markdown', () => {
      const response = `Here's my analysis:

\`\`\`json
{
  "summary": "Test summary",
  "recommendations": ["Rec 1"]
}
\`\`\`

Additional notes here.`;

      const findings = ResearchCoordinator.parseAgentResponse('patterns', response);

      expect(findings.summary).toBe('Test summary');
      expect(findings.recommendations).toEqual(['Rec 1']);
    });

    it('should handle malformed JSON with fallback', () => {
      const response = 'This is not valid JSON at all';

      const findings = ResearchCoordinator.parseAgentResponse('patterns', response);

      expect(findings.agentType).toBe('patterns');
      expect(findings.summary).toBe('Unable to parse structured response');
      expect(findings.recommendations).toEqual([]);
      expect(findings.rawOutput).toBe(response);
    });

    it('should handle JSON parse errors', () => {
      const response = '{ invalid json }';

      const findings = ResearchCoordinator.parseAgentResponse('patterns', response);

      expect(findings.summary).toBe('Parse error - see raw output');
      expect(findings.rawOutput).toBe(response);
    });

    it('should extract contracts from contracts agent response', () => {
      const response = JSON.stringify({
        summary: 'Found contracts',
        recommendations: [],
        contracts: [
          { layer: 'ui', contractType: 'ButtonProps', definition: 'interface ButtonProps {}', implementedBy: ['Button.tsx'] },
        ],
      });

      const findings = ResearchCoordinator.parseAgentResponse('contracts', response);

      expect(findings.contracts).toHaveLength(1);
      expect(findings.contracts![0].layer).toBe('ui');
    });

    it('should extract security concerns from security agent response', () => {
      const response = JSON.stringify({
        summary: 'Security analysis',
        recommendations: ['Validate inputs'],
        securityConcerns: [
          { severity: 'P0', category: 'injection', description: 'SQL injection risk', recommendation: 'Use parameterized queries' },
        ],
      });

      const findings = ResearchCoordinator.parseAgentResponse('security', response);

      expect(findings.securityConcerns).toHaveLength(1);
      expect(findings.securityConcerns![0].severity).toBe('P0');
    });

    it('should extract performance notes from performance agent response', () => {
      const response = JSON.stringify({
        summary: 'Performance analysis',
        recommendations: [],
        performanceNotes: ['Use caching', 'Optimize queries'],
      });

      const findings = ResearchCoordinator.parseAgentResponse('performance', response);

      expect(findings.performanceNotes).toEqual(['Use caching', 'Optimize queries']);
    });

    it('should extract testing strategies from testing agent response', () => {
      const response = JSON.stringify({
        summary: 'Testing analysis',
        recommendations: [],
        testingStrategies: ['Unit testing', 'Integration testing', 'E2E testing'],
      });

      const findings = ResearchCoordinator.parseAgentResponse('testing', response);

      expect(findings.testingStrategies).toEqual(['Unit testing', 'Integration testing', 'E2E testing']);
    });
  });

  describe('synthesizeFindings', () => {
    it('should combine patterns from all findings', () => {
      const findings: ResearchFindings[] = [
        {
          agentType: 'patterns',
          summary: 'Patterns summary',
          recommendations: [],
          patterns: [{ name: 'Repository', description: 'Data access', examples: ['repo.ts'] }],
        },
        {
          agentType: 'testing',
          summary: 'Testing summary',
          recommendations: [],
          patterns: [{ name: 'AAA', description: 'Arrange-Act-Assert', examples: ['test.ts'] }],
        },
      ];

      const context = createResearchContext();
      const frozenContracts = ResearchCoordinator.synthesizeFindings(findings, context);

      expect(frozenContracts.patterns).toHaveLength(2);
      expect(frozenContracts.patterns![0].name).toBe('Repository');
      expect(frozenContracts.patterns![1].name).toBe('AAA');
    });

    it('should organize contracts by layer', () => {
      const findings: ResearchFindings[] = [
        {
          agentType: 'contracts',
          summary: 'Contracts summary',
          recommendations: [],
          contracts: [
            { layer: 'ui', contractType: 'Props', definition: 'interface Props {}', implementedBy: [] },
            { layer: 'api', contractType: 'Request', definition: 'interface Request {}', implementedBy: [] },
            { layer: 'db', contractType: 'Schema', definition: 'interface Schema {}', implementedBy: [] },
          ],
        },
      ];

      const context = createResearchContext();
      const frozenContracts = ResearchCoordinator.synthesizeFindings(findings, context);

      expect(frozenContracts.ui).toHaveLength(1);
      expect(frozenContracts.api).toHaveLength(1);
      expect(frozenContracts.db).toHaveLength(1);
      expect(frozenContracts.ui[0].contractType).toBe('Props');
      expect(frozenContracts.api[0].contractType).toBe('Request');
      expect(frozenContracts.db[0].contractType).toBe('Schema');
    });

    it('should collect all recommendations', () => {
      const findings: ResearchFindings[] = [
        {
          agentType: 'patterns',
          summary: 'Patterns summary',
          recommendations: ['Rec 1', 'Rec 2'],
        },
        {
          agentType: 'security',
          summary: 'Security summary',
          recommendations: ['Rec 3'],
        },
      ];

      const context = createResearchContext();
      const frozenContracts = ResearchCoordinator.synthesizeFindings(findings, context);

      expect(frozenContracts.implementationGuidance).toContain('Rec 1');
      expect(frozenContracts.implementationGuidance).toContain('Rec 2');
      expect(frozenContracts.implementationGuidance).toContain('Rec 3');
    });

    it('should include security concerns in guidance', () => {
      const findings: ResearchFindings[] = [
        {
          agentType: 'security',
          summary: 'Security analysis',
          recommendations: [],
          securityConcerns: [
            { severity: 'P0', category: 'injection', description: 'SQL injection risk', recommendation: 'Use params' },
          ],
        },
      ];

      const context = createResearchContext();
      const frozenContracts = ResearchCoordinator.synthesizeFindings(findings, context);

      expect(frozenContracts.implementationGuidance).toContain('Security Considerations');
      expect(frozenContracts.implementationGuidance).toContain('P0');
      expect(frozenContracts.implementationGuidance).toContain('injection');
    });

    it('should include performance notes in guidance', () => {
      const findings: ResearchFindings[] = [
        {
          agentType: 'performance',
          summary: 'Performance analysis',
          recommendations: [],
          performanceNotes: ['Use caching for frequent queries'],
        },
      ];

      const context = createResearchContext();
      const frozenContracts = ResearchCoordinator.synthesizeFindings(findings, context);

      expect(frozenContracts.implementationGuidance).toContain('Performance Considerations');
      expect(frozenContracts.implementationGuidance).toContain('Use caching for frequent queries');
    });

    it('should include testing strategies in guidance', () => {
      const findings: ResearchFindings[] = [
        {
          agentType: 'testing',
          summary: 'Testing analysis',
          recommendations: [],
          testingStrategies: ['Write unit tests first', 'Mock external services'],
        },
      ];

      const context = createResearchContext();
      const frozenContracts = ResearchCoordinator.synthesizeFindings(findings, context);

      expect(frozenContracts.implementationGuidance).toContain('Testing Strategies');
      expect(frozenContracts.implementationGuidance).toContain('Write unit tests first');
    });

    it('should include agent summaries in guidance', () => {
      const findings: ResearchFindings[] = [
        { agentType: 'patterns', summary: 'Patterns are good', recommendations: [] },
        { agentType: 'security', summary: 'Security is solid', recommendations: [] },
      ];

      const context = createResearchContext();
      const frozenContracts = ResearchCoordinator.synthesizeFindings(findings, context);

      expect(frozenContracts.implementationGuidance).toContain('Research Agent Summaries');
      expect(frozenContracts.implementationGuidance).toContain('Patterns Agent');
      expect(frozenContracts.implementationGuidance).toContain('Patterns are good');
      expect(frozenContracts.implementationGuidance).toContain('Security Agent');
      expect(frozenContracts.implementationGuidance).toContain('Security is solid');
    });

    it('should set frozenAt timestamp', () => {
      const findings: ResearchFindings[] = [
        { agentType: 'patterns', summary: 'Test', recommendations: [] },
      ];

      const context = createResearchContext();
      const frozenContracts = ResearchCoordinator.synthesizeFindings(findings, context);

      expect(frozenContracts.frozenAt).toBeDefined();
      expect(new Date(frozenContracts.frozenAt).toString()).not.toBe('Invalid Date');
    });
  });

  describe('calculateMetrics', () => {
    it('should count agents spawned, succeeded, and failed', () => {
      const results: AgentResult[] = [
        { agentType: 'patterns', success: true, findings: null, durationMs: 100 },
        { agentType: 'contracts', success: true, findings: null, durationMs: 100 },
        { agentType: 'testing', success: false, findings: null, error: 'Failed', durationMs: 100 },
        { agentType: 'security', success: false, findings: null, error: 'Timeout', durationMs: 100 },
        { agentType: 'performance', success: true, findings: null, durationMs: 100 },
      ];

      const metrics = ResearchCoordinator.calculateMetrics(results);

      expect(metrics.agentsSpawned).toBe(5);
      expect(metrics.agentsSucceeded).toBe(3);
      expect(metrics.agentsFailed).toBe(2);
    });

    it('should count patterns discovered', () => {
      const results: AgentResult[] = [
        {
          agentType: 'patterns',
          success: true,
          findings: {
            agentType: 'patterns',
            summary: 'Test',
            recommendations: [],
            patterns: [
              { name: 'Factory', description: 'Factory pattern', examples: [] },
              { name: 'Repository', description: 'Repository pattern', examples: [] },
            ],
          },
          durationMs: 100,
        },
        {
          agentType: 'testing',
          success: true,
          findings: {
            agentType: 'testing',
            summary: 'Test',
            recommendations: [],
            patterns: [{ name: 'AAA', description: 'Arrange-Act-Assert', examples: [] }],
          },
          durationMs: 100,
        },
      ];

      const metrics = ResearchCoordinator.calculateMetrics(results);

      expect(metrics.patternsDiscovered).toBe(3);
    });

    it('should count contracts identified', () => {
      const results: AgentResult[] = [
        {
          agentType: 'contracts',
          success: true,
          findings: {
            agentType: 'contracts',
            summary: 'Test',
            recommendations: [],
            contracts: [
              { layer: 'ui', contractType: 'Props', definition: '', implementedBy: [] },
              { layer: 'api', contractType: 'Request', definition: '', implementedBy: [] },
            ],
          },
          durationMs: 100,
        },
      ];

      const metrics = ResearchCoordinator.calculateMetrics(results);

      expect(metrics.contractsIdentified).toBe(2);
    });

    it('should count security concerns found', () => {
      const results: AgentResult[] = [
        {
          agentType: 'security',
          success: true,
          findings: {
            agentType: 'security',
            summary: 'Test',
            recommendations: [],
            securityConcerns: [
              { severity: 'P0', category: 'injection', description: 'SQL injection', recommendation: 'Fix it' },
              { severity: 'P1', category: 'auth', description: 'Missing auth', recommendation: 'Add auth' },
            ],
          },
          durationMs: 100,
        },
      ];

      const metrics = ResearchCoordinator.calculateMetrics(results);

      expect(metrics.securityConcernsFound).toBe(2);
    });

    it('should not count findings from failed agents', () => {
      const results: AgentResult[] = [
        {
          agentType: 'patterns',
          success: false,
          findings: {
            agentType: 'patterns',
            summary: 'Test',
            recommendations: [],
            patterns: [{ name: 'Factory', description: 'Factory pattern', examples: [] }],
          },
          error: 'Failed',
          durationMs: 100,
        },
      ];

      const metrics = ResearchCoordinator.calculateMetrics(results);

      expect(metrics.patternsDiscovered).toBe(0);
    });

    it('should handle null findings gracefully', () => {
      const results: AgentResult[] = [
        { agentType: 'patterns', success: true, findings: null, durationMs: 100 },
      ];

      const metrics = ResearchCoordinator.calculateMetrics(results);

      expect(metrics.patternsDiscovered).toBe(0);
      expect(metrics.contractsIdentified).toBe(0);
      expect(metrics.securityConcernsFound).toBe(0);
    });
  });

  describe('runWithTimeout', () => {
    it('should resolve when promise completes before timeout', async () => {
      const result = await ResearchCoordinator.runWithTimeout(
        Promise.resolve('success'),
        1000
      );

      expect(result).toBe('success');
    });

    it('should reject with timeout error when promise takes too long', async () => {
      const slowPromise = new Promise((resolve) => setTimeout(resolve, 5000, 'slow'));

      await expect(
        ResearchCoordinator.runWithTimeout(slowPromise, 10)
      ).rejects.toThrow('Agent timeout');
    });

    it('should reject with original error if promise fails', async () => {
      const failingPromise = Promise.reject(new Error('Original error'));

      await expect(
        ResearchCoordinator.runWithTimeout(failingPromise, 1000)
      ).rejects.toThrow('Original error');
    });
  });

  describe('runAgent', () => {
    it('should run agent and return successful result', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValueOnce(createMockAiResponse(createPatternsResponse()));

      const context = createResearchContext();
      const result = await ResearchCoordinator.runAgent(
        'patterns',
        context,
        'agent-123',
        { client: mockClient as any, maxTokens: 4096, model: 'test-model', agentTimeoutMs: 60000 }
      );

      expect(result.success).toBe(true);
      expect(result.agentType).toBe('patterns');
      expect(result.findings).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('should update agent status to running when starting', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValueOnce(createMockAiResponse(createPatternsResponse()));

      const context = createResearchContext();
      await ResearchCoordinator.runAgent(
        'patterns',
        context,
        'agent-123',
        { client: mockClient as any, maxTokens: 4096, model: 'test-model', agentTimeoutMs: 60000 }
      );

      expect(mockAgentRepositoryUpdate).toHaveBeenCalledWith(
        'agent-123',
        expect.objectContaining({ status: 'running' }),
        undefined
      );
    });

    it('should update agent status to completed on success', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValueOnce(createMockAiResponse(createPatternsResponse()));

      const context = createResearchContext();
      await ResearchCoordinator.runAgent(
        'patterns',
        context,
        'agent-123',
        { client: mockClient as any, maxTokens: 4096, model: 'test-model', agentTimeoutMs: 60000 }
      );

      // Should be called twice: once for running, once for completed
      expect(mockAgentRepositoryUpdate).toHaveBeenCalledTimes(2);
      expect(mockAgentRepositoryUpdate).toHaveBeenLastCalledWith(
        'agent-123',
        expect.objectContaining({ status: 'completed' }),
        undefined
      );
    });

    it('should handle API errors and return failure result', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockRejectedValueOnce(new Error('API error'));

      const context = createResearchContext();
      const result = await ResearchCoordinator.runAgent(
        'patterns',
        context,
        'agent-123',
        { client: mockClient as any, maxTokens: 4096, model: 'test-model', agentTimeoutMs: 60000 }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('API error');
      expect(result.findings).toBeNull();
    });

    it('should update agent status to failed on error', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockRejectedValueOnce(new Error('API error'));

      const context = createResearchContext();
      await ResearchCoordinator.runAgent(
        'patterns',
        context,
        'agent-123',
        { client: mockClient as any, maxTokens: 4096, model: 'test-model', agentTimeoutMs: 60000 }
      );

      expect(mockAgentRepositoryUpdate).toHaveBeenLastCalledWith(
        'agent-123',
        expect.objectContaining({ status: 'failed' }),
        undefined
      );
    });

    it('should update agent status to timeout on timeout error', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 5000))
      );

      const context = createResearchContext();
      await ResearchCoordinator.runAgent(
        'patterns',
        context,
        'agent-123',
        { client: mockClient as any, maxTokens: 4096, model: 'test-model', agentTimeoutMs: 10 }
      );

      expect(mockAgentRepositoryUpdate).toHaveBeenLastCalledWith(
        'agent-123',
        expect.objectContaining({ status: 'timeout' }),
        undefined
      );
    });

    it('should handle response without text content', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValueOnce({ content: [] });

      const context = createResearchContext();
      const result = await ResearchCoordinator.runAgent(
        'patterns',
        context,
        'agent-123',
        { client: mockClient as any, maxTokens: 4096, model: 'test-model', agentTimeoutMs: 60000 }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('No text response from agent');
    });

    it('should pass correct parameters to AI client', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValueOnce(createMockAiResponse(createPatternsResponse()));

      const context = createResearchContext();
      await ResearchCoordinator.runAgent(
        'patterns',
        context,
        'agent-123',
        { client: mockClient as any, maxTokens: 2048, model: 'custom-model', agentTimeoutMs: 60000 }
      );

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'custom-model',
          max_tokens: 2048,
        })
      );
    });
  });

  describe('runParallel', () => {
    it('should spawn all 5 agents by default', async () => {
      const mockClient = createMockAnthropicClient();
      // Mock 5 successful responses
      for (let i = 0; i < 5; i++) {
        mockAnthropicCreate.mockResolvedValueOnce(createMockAiResponse(createPatternsResponse()));
      }

      const context = createResearchContext();
      const result = await ResearchCoordinator.runParallel(
        undefined,
        context,
        'phase-123',
        { anthropicClient: mockClient as any }
      );

      expect(result.metrics.agentsSpawned).toBe(5);
      expect(mockAgentRepositoryCreate).toHaveBeenCalledTimes(5);
    });

    it('should spawn only specified agent types', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse(createPatternsResponse()));

      const context = createResearchContext();
      const result = await ResearchCoordinator.runParallel(
        ['patterns', 'security'],
        context,
        'phase-123',
        { anthropicClient: mockClient as any }
      );

      expect(result.metrics.agentsSpawned).toBe(2);
      expect(mockAgentRepositoryCreate).toHaveBeenCalledTimes(2);
    });

    it('should run agents in parallel using Promise.all', async () => {
      const mockClient = createMockAnthropicClient();
      const startTimes: number[] = [];

      // Track when each agent starts
      mockAnthropicCreate.mockImplementation(() => {
        startTimes.push(Date.now());
        return Promise.resolve(createMockAiResponse(createPatternsResponse()));
      });

      const context = createResearchContext();
      await ResearchCoordinator.runParallel(
        ['patterns', 'contracts', 'testing'],
        context,
        'phase-123',
        { anthropicClient: mockClient as any }
      );

      // All agents should start nearly simultaneously (within 50ms of each other)
      const maxTimeDiff = Math.max(...startTimes) - Math.min(...startTimes);
      expect(maxTimeDiff).toBeLessThan(50);
    });

    it('should return success when all agents succeed', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse(createPatternsResponse()));

      const context = createResearchContext();
      const result = await ResearchCoordinator.runParallel(
        ['patterns'],
        context,
        'phase-123',
        { anthropicClient: mockClient as any }
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return partial success when some agents fail', async () => {
      const mockClient = createMockAnthropicClient();
      // First agent succeeds, second fails
      mockAnthropicCreate.mockResolvedValueOnce(createMockAiResponse(createPatternsResponse()));
      mockAnthropicCreate.mockRejectedValueOnce(new Error('Agent failed'));

      const context = createResearchContext();
      const result = await ResearchCoordinator.runParallel(
        ['patterns', 'security'],
        context,
        'phase-123',
        { anthropicClient: mockClient as any }
      );

      expect(result.success).toBe(true); // Partial success
      expect(result.metrics.agentsSucceeded).toBe(1);
      expect(result.metrics.agentsFailed).toBe(1);
      expect(result.error).toContain('1 agent(s) failed');
    });

    it('should continue with partial results when agents fail', async () => {
      const mockClient = createMockAnthropicClient();
      // patterns succeeds with findings
      mockAnthropicCreate.mockResolvedValueOnce(
        createMockAiResponse({
          summary: 'Found patterns',
          recommendations: ['Use factory'],
          patterns: [{ name: 'Factory', description: 'Factory pattern', examples: [] }],
        })
      );
      // contracts fails
      mockAnthropicCreate.mockRejectedValueOnce(new Error('Agent failed'));

      const context = createResearchContext();
      const result = await ResearchCoordinator.runParallel(
        ['patterns', 'contracts'],
        context,
        'phase-123',
        { anthropicClient: mockClient as any }
      );

      expect(result.frozenContracts).not.toBeNull();
      expect(result.frozenContracts!.patterns).toHaveLength(1);
    });

    it('should return failure when all agents fail', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockRejectedValue(new Error('All failed'));

      const context = createResearchContext();
      const result = await ResearchCoordinator.runParallel(
        ['patterns', 'contracts'],
        context,
        'phase-123',
        { anthropicClient: mockClient as any }
      );

      expect(result.success).toBe(false);
      expect(result.frozenContracts).toBeNull();
      expect(result.metrics.agentsSucceeded).toBe(0);
      expect(result.metrics.agentsFailed).toBe(2);
    });

    it('should synthesize findings from successful agents', async () => {
      const mockClient = createMockAnthropicClient();

      // patterns agent response
      mockAnthropicCreate.mockResolvedValueOnce(
        createMockAiResponse({
          summary: 'Found patterns',
          recommendations: ['Use patterns'],
          patterns: [{ name: 'Repository', description: 'Data access', examples: [] }],
        })
      );

      // contracts agent response
      mockAnthropicCreate.mockResolvedValueOnce(
        createMockAiResponse({
          summary: 'Found contracts',
          recommendations: ['Define interfaces'],
          contracts: [
            { layer: 'ui', contractType: 'Props', definition: '', implementedBy: [] },
            { layer: 'api', contractType: 'Request', definition: '', implementedBy: [] },
          ],
        })
      );

      const context = createResearchContext();
      const result = await ResearchCoordinator.runParallel(
        ['patterns', 'contracts'],
        context,
        'phase-123',
        { anthropicClient: mockClient as any }
      );

      expect(result.frozenContracts).not.toBeNull();
      expect(result.frozenContracts!.patterns).toHaveLength(1);
      expect(result.frozenContracts!.ui).toHaveLength(1);
      expect(result.frozenContracts!.api).toHaveLength(1);
    });

    it('should track total duration', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse(createPatternsResponse()));

      const context = createResearchContext();
      const result = await ResearchCoordinator.runParallel(
        ['patterns'],
        context,
        'phase-123',
        { anthropicClient: mockClient as any }
      );

      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should create agent records in database', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse(createPatternsResponse()));

      const context = createResearchContext();
      await ResearchCoordinator.runParallel(
        ['patterns', 'security'],
        context,
        'phase-123',
        { anthropicClient: mockClient as any }
      );

      expect(mockAgentRepositoryCreate).toHaveBeenCalledWith(
        expect.objectContaining({ phaseId: 'phase-123', agentType: 'patterns' }),
        undefined
      );
      expect(mockAgentRepositoryCreate).toHaveBeenCalledWith(
        expect.objectContaining({ phaseId: 'phase-123', agentType: 'security' }),
        undefined
      );
    });

    it('should handle timeout for slow agents', async () => {
      const mockClient = createMockAnthropicClient();
      // Fast agent
      mockAnthropicCreate.mockResolvedValueOnce(createMockAiResponse(createPatternsResponse()));
      // Slow agent
      mockAnthropicCreate.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 5000))
      );

      const context = createResearchContext();
      const result = await ResearchCoordinator.runParallel(
        ['patterns', 'security'],
        context,
        'phase-123',
        { anthropicClient: mockClient as any, agentTimeoutMs: 10 }
      );

      expect(result.metrics.agentsSucceeded).toBe(1);
      expect(result.metrics.agentsFailed).toBe(1);
      expect(result.agentResults.find((r) => !r.success)?.error).toContain('timeout');
    });

    it('should use provided config values', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValue(createMockAiResponse(createPatternsResponse()));

      const context = createResearchContext();
      await ResearchCoordinator.runParallel(
        ['patterns'],
        context,
        'phase-123',
        {
          anthropicClient: mockClient as any,
          maxTokens: 2048,
          model: 'custom-model',
        }
      );

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'custom-model',
          max_tokens: 2048,
        })
      );
    });

    it('should return all agent results including failures', async () => {
      const mockClient = createMockAnthropicClient();
      mockAnthropicCreate.mockResolvedValueOnce(createMockAiResponse(createPatternsResponse()));
      mockAnthropicCreate.mockRejectedValueOnce(new Error('Failed'));
      mockAnthropicCreate.mockResolvedValueOnce(createMockAiResponse(createTestingResponse()));

      const context = createResearchContext();
      const result = await ResearchCoordinator.runParallel(
        ['patterns', 'security', 'testing'],
        context,
        'phase-123',
        { anthropicClient: mockClient as any }
      );

      expect(result.agentResults).toHaveLength(3);
      expect(result.agentResults.filter((r) => r.success)).toHaveLength(2);
      expect(result.agentResults.filter((r) => !r.success)).toHaveLength(1);
    });

    it('should handle exception during agent record creation', async () => {
      const mockClient = createMockAnthropicClient();
      mockAgentRepositoryCreate.mockImplementationOnce(() => {
        throw new Error('Database error');
      });

      const context = createResearchContext();
      const result = await ResearchCoordinator.runParallel(
        ['patterns'],
        context,
        'phase-123',
        { anthropicClient: mockClient as any }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database error');
    });
  });

  describe('loadRelevantFiles', () => {
    it('should return empty array when src directory does not exist', () => {
      mockFsExistsSync.mockReturnValue(false);

      const files = ResearchCoordinator.loadRelevantFiles('/test/project');

      expect(files).toEqual([]);
    });

    it('should discover TypeScript files in src directory', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReaddirSync.mockReturnValueOnce([
        { name: 'index.ts', isFile: () => true, isDirectory: () => false },
        { name: 'utils.ts', isFile: () => true, isDirectory: () => false },
      ] as any);
      mockFsReadFileSync.mockReturnValue('// File content');

      const files = ResearchCoordinator.loadRelevantFiles('/test/project');

      expect(files).toHaveLength(2);
      expect(files[0].path).toContain('index.ts');
      expect(files[1].path).toContain('utils.ts');
    });

    it('should recursively discover files in subdirectories', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReaddirSync
        .mockReturnValueOnce([
          { name: 'utils', isFile: () => false, isDirectory: () => true },
        ] as any)
        .mockReturnValueOnce([
          { name: 'helper.ts', isFile: () => true, isDirectory: () => false },
        ] as any);
      mockFsReadFileSync.mockReturnValue('// Helper content');

      const files = ResearchCoordinator.loadRelevantFiles('/test/project');

      expect(files).toHaveLength(1);
      expect(files[0].path).toContain('helper.ts');
    });

    it('should skip hidden directories and node_modules', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReaddirSync.mockReturnValueOnce([
        { name: '.git', isFile: () => false, isDirectory: () => true },
        { name: 'node_modules', isFile: () => false, isDirectory: () => true },
        { name: 'index.ts', isFile: () => true, isDirectory: () => false },
      ] as any);
      mockFsReadFileSync.mockReturnValue('// Content');

      const files = ResearchCoordinator.loadRelevantFiles('/test/project');

      // Should only find index.ts, not traverse hidden or node_modules
      expect(files).toHaveLength(1);
      expect(files[0].path).toContain('index.ts');
    });

    it('should limit number of files', () => {
      mockFsExistsSync.mockReturnValue(true);
      const manyFiles = Array.from({ length: 30 }, (_, i) => ({
        name: `file${i}.ts`,
        isFile: () => true,
        isDirectory: () => false,
      }));
      mockFsReaddirSync.mockReturnValue(manyFiles as any);
      mockFsReadFileSync.mockReturnValue('// Content');

      const files = ResearchCoordinator.loadRelevantFiles('/test/project', ['src/**/*.ts'], 10);

      expect(files).toHaveLength(10);
    });

    it('should truncate file content to limit', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReaddirSync.mockReturnValue([
        { name: 'large.ts', isFile: () => true, isDirectory: () => false },
      ] as any);
      const largeContent = 'x'.repeat(10000);
      mockFsReadFileSync.mockReturnValue(largeContent);

      const files = ResearchCoordinator.loadRelevantFiles('/test/project');

      expect(files[0].content.length).toBe(5000);
    });

    it('should skip files that cannot be read', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReaddirSync.mockReturnValue([
        { name: 'readable.ts', isFile: () => true, isDirectory: () => false },
        { name: 'unreadable.ts', isFile: () => true, isDirectory: () => false },
      ] as any);
      mockFsReadFileSync
        .mockReturnValueOnce('// Readable')
        .mockImplementationOnce(() => { throw new Error('Permission denied'); });

      const files = ResearchCoordinator.loadRelevantFiles('/test/project');

      expect(files).toHaveLength(1);
      expect(files[0].path).toContain('readable.ts');
    });

    it('should only include .ts and .tsx files', () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReaddirSync.mockReturnValue([
        { name: 'index.ts', isFile: () => true, isDirectory: () => false },
        { name: 'component.tsx', isFile: () => true, isDirectory: () => false },
        { name: 'styles.css', isFile: () => true, isDirectory: () => false },
        { name: 'readme.md', isFile: () => true, isDirectory: () => false },
      ] as any);
      mockFsReadFileSync.mockReturnValue('// Content');

      const files = ResearchCoordinator.loadRelevantFiles('/test/project');

      expect(files).toHaveLength(2);
      expect(files[0].path).toContain('.ts');
      expect(files[1].path).toContain('.tsx');
    });
  });

  describe('buildImplementationGuidance', () => {
    it('should include user story title and description', () => {
      const findings: ResearchFindings[] = [];
      const context = createResearchContext({
        userStory: createUserStory({
          title: 'Add authentication',
          description: 'As a user, I want to log in',
        }),
      });

      const guidance = ResearchCoordinator.buildImplementationGuidance(
        findings, [], [], [], [], context
      );

      expect(guidance).toContain('Add authentication');
      expect(guidance).toContain('As a user, I want to log in');
    });

    it('should include recommendations section when present', () => {
      const findings: ResearchFindings[] = [];
      const recommendations = ['Use factory pattern', 'Add error handling'];

      const guidance = ResearchCoordinator.buildImplementationGuidance(
        findings, recommendations, [], [], [], createResearchContext()
      );

      expect(guidance).toContain('## Recommendations');
      expect(guidance).toContain('Use factory pattern');
      expect(guidance).toContain('Add error handling');
    });

    it('should include security section when concerns present', () => {
      const findings: ResearchFindings[] = [];
      const securityConcerns: SecurityConcern[] = [
        { severity: 'P0', category: 'injection', description: 'SQL injection risk', recommendation: 'Use params' },
      ];

      const guidance = ResearchCoordinator.buildImplementationGuidance(
        findings, [], securityConcerns, [], [], createResearchContext()
      );

      expect(guidance).toContain('## Security Considerations');
      expect(guidance).toContain('[P0]');
      expect(guidance).toContain('injection');
      expect(guidance).toContain('Use params');
    });

    it('should include performance section when notes present', () => {
      const findings: ResearchFindings[] = [];
      const performanceNotes = ['Cache database queries', 'Use lazy loading'];

      const guidance = ResearchCoordinator.buildImplementationGuidance(
        findings, [], [], performanceNotes, [], createResearchContext()
      );

      expect(guidance).toContain('## Performance Considerations');
      expect(guidance).toContain('Cache database queries');
      expect(guidance).toContain('Use lazy loading');
    });

    it('should include testing section when strategies present', () => {
      const findings: ResearchFindings[] = [];
      const testingStrategies = ['Write unit tests first', 'Mock external APIs'];

      const guidance = ResearchCoordinator.buildImplementationGuidance(
        findings, [], [], [], testingStrategies, createResearchContext()
      );

      expect(guidance).toContain('## Testing Strategies');
      expect(guidance).toContain('Write unit tests first');
      expect(guidance).toContain('Mock external APIs');
    });
  });
});
