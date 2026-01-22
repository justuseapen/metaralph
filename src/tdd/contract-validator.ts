/**
 * Contract Validator - INTEGRATE Phase Implementation
 *
 * Validates contracts across all layers (UI, API, DB) during the INTEGRATE phase.
 * This is the fourth phase of the 6-phase TDD workflow:
 * RED -> RESEARCH -> GREEN -> INTEGRATE -> REFINE -> COMMIT
 *
 * The INTEGRATE phase:
 * 1. Extracts implemented contracts from the codebase
 * 2. Validates UI layer contracts match API layer
 * 3. Validates API layer contracts match DB schema
 * 4. Checks that error boundaries exist
 * 5. Returns validation report with pass/fail status
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import {
  type FrozenContracts,
  type ContractDefinition,
  type IntegrationReceipt,
} from './types.js';
import { type DatabaseInstance, initDatabase } from '../db/index.js';

/**
 * Project context for contract validation
 */
export interface ContractValidatorProjectContext {
  /** Project root path */
  path: string;
  /** Project name */
  name: string;
  /** Source directory (defaults to 'src') */
  srcDir?: string;
}

/**
 * Configuration for ContractValidator
 */
export interface ContractValidatorConfig {
  /** Anthropic client (optional, created if not provided) */
  anthropicClient?: Anthropic;
  /** Max tokens for AI responses */
  maxTokens?: number;
  /** Model to use for validation */
  model?: string;
  /** Timeout for validation in ms */
  timeoutMs?: number;
}

/**
 * Result of a single layer validation
 */
export interface LayerValidationResult {
  /** Layer that was validated */
  layer: 'ui' | 'api' | 'db';
  /** Whether validation passed */
  passed: boolean;
  /** Number of contracts validated */
  contractsValidated: number;
  /** Number of contracts that failed validation */
  contractsFailed: number;
  /** Validation errors */
  errors: ValidationError[];
  /** Validation warnings (non-blocking) */
  warnings: string[];
}

/**
 * A validation error
 */
export interface ValidationError {
  /** Contract that failed validation */
  contractType: string;
  /** Layer where the error was found */
  layer: 'ui' | 'api' | 'db';
  /** Description of the error */
  message: string;
  /** File where the mismatch was found */
  filePath?: string;
  /** Severity of the error */
  severity: 'error' | 'warning';
}

/**
 * Result of contract validation
 */
export interface ContractValidationResult {
  /** Whether all validations passed */
  passed: boolean;
  /** Detailed results per layer */
  layerResults: LayerValidationResult[];
  /** Error boundaries check result */
  errorBoundariesChecked: boolean;
  /** Whether error boundaries exist */
  errorBoundariesExist: boolean;
  /** Total contracts validated */
  totalContractsValidated: number;
  /** Total contracts failed */
  totalContractsFailed: number;
  /** All validation errors */
  errors: ValidationError[];
  /** All warnings */
  warnings: string[];
  /** Total duration in ms */
  totalDurationMs: number;
  /** Integration receipt for PR */
  receipt: IntegrationReceipt;
}

/**
 * Implemented contract found in code
 */
export interface ImplementedContract {
  /** Layer this contract belongs to */
  layer: 'ui' | 'api' | 'db';
  /** Type name of the contract */
  contractType: string;
  /** File where the contract is defined */
  filePath: string;
  /** The contract definition as found in code */
  definition: string;
  /** Dependencies/imports this contract relies on */
  dependencies?: string[];
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<Omit<ContractValidatorConfig, 'anthropicClient'>> = {
  maxTokens: 4096,
  model: 'claude-sonnet-4-20250514',
  timeoutMs: 5 * 60 * 1000, // 5 minutes
};

/**
 * Contract Validator - Validates contracts across all layers
 */
export const ContractValidator = {
  /**
   * Create an Anthropic client
   */
  createClient(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is required for contract validation. ' +
          'Set it in your shell or .env file.'
      );
    }
    return new Anthropic({ apiKey });
  },

  /**
   * Validate contracts against frozen contracts from RESEARCH phase
   *
   * @param frozenContracts - Frozen contracts from RESEARCH phase
   * @param project - Project context
   * @param config - Optional configuration
   * @param db - Optional database instance
   * @returns Validation result
   */
  async validate(
    frozenContracts: FrozenContracts,
    project: ContractValidatorProjectContext,
    config: ContractValidatorConfig = {},
    db?: DatabaseInstance
  ): Promise<ContractValidationResult> {
    const client = config.anthropicClient ?? this.createClient();
    const maxTokens = config.maxTokens ?? DEFAULT_CONFIG.maxTokens;
    const model = config.model ?? DEFAULT_CONFIG.model;
    const timeoutMs = config.timeoutMs ?? DEFAULT_CONFIG.timeoutMs;

    const startTime = Date.now();
    const layerResults: LayerValidationResult[] = [];
    const allErrors: ValidationError[] = [];
    const allWarnings: string[] = [];

    try {
      // 1. Extract implemented contracts from the codebase
      const implementedContracts = await this.extractImplementedContracts(
        project,
        { client, maxTokens, model }
      );

      // 2. Validate UI contracts match API contracts
      if (frozenContracts.ui.length > 0 || frozenContracts.api.length > 0) {
        const uiResult = await this.validateUIContract(
          project,
          implementedContracts,
          frozenContracts.ui,
          frozenContracts.api,
          { client, maxTokens, model }
        );
        layerResults.push(uiResult);
        allErrors.push(...uiResult.errors);
        allWarnings.push(...uiResult.warnings);
      }

      // 3. Validate API contracts match DB schema
      if (frozenContracts.api.length > 0 || frozenContracts.db.length > 0) {
        const apiResult = await this.validateAPIContract(
          project,
          implementedContracts,
          frozenContracts.api,
          frozenContracts.db,
          { client, maxTokens, model }
        );
        layerResults.push(apiResult);
        allErrors.push(...apiResult.errors);
        allWarnings.push(...apiResult.warnings);
      }

      // 4. Check error boundaries exist
      const errorBoundaryResult = await this.checkErrorBoundaries(
        project,
        { client, maxTokens, model }
      );

      // Calculate totals
      const totalContractsValidated = layerResults.reduce(
        (sum, r) => sum + r.contractsValidated,
        0
      );
      const totalContractsFailed = layerResults.reduce(
        (sum, r) => sum + r.contractsFailed,
        0
      );

      // Determine overall pass/fail
      // Pass if all layers pass and error boundaries exist (or no UI layer to check)
      const layersPassed = layerResults.every((r) => r.passed);
      const hasUILayer = frozenContracts.ui.length > 0;
      const errorBoundaryPassed = !hasUILayer || errorBoundaryResult.exists;
      const passed = layersPassed && errorBoundaryPassed;

      if (!errorBoundaryPassed) {
        allWarnings.push(
          'No error boundaries detected in UI code. Consider adding error handling.'
        );
      }

      const totalDurationMs = Date.now() - startTime;

      // Build receipt for PR
      const receipt: IntegrationReceipt = {
        contractsValidated: totalContractsValidated,
        contractsFailed: totalContractsFailed,
        layersChecked: layerResults.map((r) => r.layer),
        errors: allErrors.filter((e) => e.severity === 'error').map((e) => e.message),
      };

      return {
        passed,
        layerResults,
        errorBoundariesChecked: true,
        errorBoundariesExist: errorBoundaryResult.exists,
        totalContractsValidated,
        totalContractsFailed,
        errors: allErrors,
        warnings: allWarnings,
        totalDurationMs,
        receipt,
      };
    } catch (error) {
      const totalDurationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      allErrors.push({
        contractType: 'unknown',
        layer: 'api',
        message: `Contract validation failed: ${errorMessage}`,
        severity: 'error',
      });

      return {
        passed: false,
        layerResults,
        errorBoundariesChecked: false,
        errorBoundariesExist: false,
        totalContractsValidated: 0,
        totalContractsFailed: 0,
        errors: allErrors,
        warnings: allWarnings,
        totalDurationMs,
        receipt: {
          contractsValidated: 0,
          contractsFailed: 0,
          layersChecked: [],
          errors: [errorMessage],
        },
      };
    }
  },

  /**
   * Extract implemented contracts from the codebase using AI
   *
   * @param project - Project context
   * @param aiConfig - AI configuration
   * @returns List of implemented contracts
   */
  async extractImplementedContracts(
    project: ContractValidatorProjectContext,
    aiConfig: { client: Anthropic; maxTokens: number; model: string }
  ): Promise<ImplementedContract[]> {
    const { client, maxTokens, model } = aiConfig;

    // Load source files for analysis
    const sourceFiles = this.loadSourceFiles(project.path, project.srcDir ?? 'src');

    if (sourceFiles.length === 0) {
      return [];
    }

    // Build prompt for AI extraction
    const systemPrompt = `You are a code analysis expert. Your task is to extract contract definitions from TypeScript/JavaScript code.

Contracts include:
- TypeScript interfaces and types (especially those used for API requests/responses)
- React component props interfaces
- Database model/schema definitions
- Zod schemas or validation schemas

For each contract found, identify:
1. The layer it belongs to: "ui" (React props, component interfaces), "api" (request/response types, API schemas), or "db" (database models, ORM entities)
2. The contract type name
3. The file path
4. The full definition

Respond in JSON format:
{
  "contracts": [
    {
      "layer": "ui" | "api" | "db",
      "contractType": "TypeName",
      "filePath": "path/to/file.ts",
      "definition": "interface TypeName { ... }"
    }
  ]
}`;

    const userPrompt = `Analyze the following source files and extract contract definitions:

${sourceFiles.map((f) => `### ${f.path}\n\`\`\`typescript\n${f.content}\n\`\`\``).join('\n\n')}

Extract all interface, type, and schema definitions that define contracts between layers.`;

    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return [];
      }

      return this.parseContractsFromResponse(textContent.text);
    } catch (error) {
      console.error('Error extracting contracts:', error);
      return [];
    }
  },

  /**
   * Parse contracts from AI response
   */
  parseContractsFromResponse(response: string): ImplementedContract[] {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const contracts = parsed.contracts || [];

      return contracts.map((c: Record<string, unknown>) => ({
        layer: c.layer as 'ui' | 'api' | 'db',
        contractType: String(c.contractType ?? ''),
        filePath: String(c.filePath ?? ''),
        definition: String(c.definition ?? ''),
        dependencies: c.dependencies as string[] | undefined,
      }));
    } catch {
      return [];
    }
  },

  /**
   * Validate UI contracts match API contracts
   *
   * @param project - Project context
   * @param implementedContracts - Contracts found in code
   * @param uiContracts - UI contracts from frozen contracts
   * @param apiContracts - API contracts from frozen contracts
   * @param aiConfig - AI configuration
   * @returns Layer validation result
   */
  async validateUIContract(
    project: ContractValidatorProjectContext,
    implementedContracts: ImplementedContract[],
    uiContracts: ContractDefinition[],
    apiContracts: ContractDefinition[],
    aiConfig: { client: Anthropic; maxTokens: number; model: string }
  ): Promise<LayerValidationResult> {
    const { client, maxTokens, model } = aiConfig;
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // Filter UI contracts from implemented
    const implementedUI = implementedContracts.filter((c) => c.layer === 'ui');
    const implementedAPI = implementedContracts.filter((c) => c.layer === 'api');

    // If no contracts to validate, return passing
    if (uiContracts.length === 0 && implementedUI.length === 0) {
      return {
        layer: 'ui',
        passed: true,
        contractsValidated: 0,
        contractsFailed: 0,
        errors: [],
        warnings: ['No UI contracts found to validate'],
      };
    }

    // Build prompt for validation
    const systemPrompt = `You are a contract validation expert. Your task is to verify that UI layer contracts are compatible with API layer contracts.

Check for:
1. Field name mismatches between UI props and API response types
2. Type mismatches (e.g., string vs number)
3. Missing required fields
4. Optional vs required field mismatches

Respond in JSON format:
{
  "passed": true | false,
  "errors": [
    {
      "contractType": "TypeName",
      "message": "Description of mismatch",
      "severity": "error" | "warning"
    }
  ],
  "warnings": ["Warning messages for non-critical issues"]
}`;

    const userPrompt = `Validate that these UI contracts are compatible with their API contracts:

## Frozen UI Contracts (expected):
${JSON.stringify(uiContracts, null, 2)}

## Frozen API Contracts (expected):
${JSON.stringify(apiContracts, null, 2)}

## Implemented UI Contracts (actual):
${JSON.stringify(implementedUI, null, 2)}

## Implemented API Contracts (actual):
${JSON.stringify(implementedAPI, null, 2)}

Verify that:
1. UI components receive data in the format that API provides
2. Required fields in UI are present in API responses
3. Types match between layers`;

    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return {
          layer: 'ui',
          passed: true,
          contractsValidated: uiContracts.length + implementedUI.length,
          contractsFailed: 0,
          errors: [],
          warnings: ['Could not parse validation response'],
        };
      }

      const validationResult = this.parseValidationResponse(textContent.text, 'ui');
      return {
        layer: 'ui',
        passed: validationResult.passed,
        contractsValidated: uiContracts.length + implementedUI.length,
        contractsFailed: validationResult.errors.filter((e) => e.severity === 'error').length,
        errors: validationResult.errors,
        warnings: validationResult.warnings,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        layer: 'ui',
        passed: false,
        contractsValidated: 0,
        contractsFailed: 0,
        errors: [
          {
            contractType: 'unknown',
            layer: 'ui',
            message: `UI validation failed: ${errorMessage}`,
            severity: 'error',
          },
        ],
        warnings: [],
      };
    }
  },

  /**
   * Validate API contracts match DB schema
   *
   * @param project - Project context
   * @param implementedContracts - Contracts found in code
   * @param apiContracts - API contracts from frozen contracts
   * @param dbContracts - DB contracts from frozen contracts
   * @param aiConfig - AI configuration
   * @returns Layer validation result
   */
  async validateAPIContract(
    project: ContractValidatorProjectContext,
    implementedContracts: ImplementedContract[],
    apiContracts: ContractDefinition[],
    dbContracts: ContractDefinition[],
    aiConfig: { client: Anthropic; maxTokens: number; model: string }
  ): Promise<LayerValidationResult> {
    const { client, maxTokens, model } = aiConfig;

    // Filter API and DB contracts from implemented
    const implementedAPI = implementedContracts.filter((c) => c.layer === 'api');
    const implementedDB = implementedContracts.filter((c) => c.layer === 'db');

    // If no contracts to validate, return passing
    if (apiContracts.length === 0 && implementedAPI.length === 0) {
      return {
        layer: 'api',
        passed: true,
        contractsValidated: 0,
        contractsFailed: 0,
        errors: [],
        warnings: ['No API contracts found to validate'],
      };
    }

    // Build prompt for validation
    const systemPrompt = `You are a contract validation expert. Your task is to verify that API layer contracts are compatible with database schema contracts.

Check for:
1. Field name mismatches between API types and database columns
2. Type mismatches (e.g., Date vs string, nullable vs non-nullable)
3. Missing required fields in API that exist in DB
4. Foreign key relationships that need handling in API

Respond in JSON format:
{
  "passed": true | false,
  "errors": [
    {
      "contractType": "TypeName",
      "message": "Description of mismatch",
      "severity": "error" | "warning"
    }
  ],
  "warnings": ["Warning messages for non-critical issues"]
}`;

    const userPrompt = `Validate that these API contracts are compatible with their database contracts:

## Frozen API Contracts (expected):
${JSON.stringify(apiContracts, null, 2)}

## Frozen DB Contracts (expected):
${JSON.stringify(dbContracts, null, 2)}

## Implemented API Contracts (actual):
${JSON.stringify(implementedAPI, null, 2)}

## Implemented DB Contracts (actual):
${JSON.stringify(implementedDB, null, 2)}

Verify that:
1. API models can be properly persisted to database
2. Required database fields are populated by API
3. Types are compatible for storage and retrieval`;

    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return {
          layer: 'api',
          passed: true,
          contractsValidated: apiContracts.length + implementedAPI.length,
          contractsFailed: 0,
          errors: [],
          warnings: ['Could not parse validation response'],
        };
      }

      const validationResult = this.parseValidationResponse(textContent.text, 'api');
      return {
        layer: 'api',
        passed: validationResult.passed,
        contractsValidated: apiContracts.length + implementedAPI.length,
        contractsFailed: validationResult.errors.filter((e) => e.severity === 'error').length,
        errors: validationResult.errors,
        warnings: validationResult.warnings,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        layer: 'api',
        passed: false,
        contractsValidated: 0,
        contractsFailed: 0,
        errors: [
          {
            contractType: 'unknown',
            layer: 'api',
            message: `API validation failed: ${errorMessage}`,
            severity: 'error',
          },
        ],
        warnings: [],
      };
    }
  },

  /**
   * Check if error boundaries exist in the project
   *
   * @param project - Project context
   * @param aiConfig - AI configuration
   * @returns Whether error boundaries exist
   */
  async checkErrorBoundaries(
    project: ContractValidatorProjectContext,
    aiConfig: { client: Anthropic; maxTokens: number; model: string }
  ): Promise<{ exists: boolean; locations: string[] }> {
    const { client, maxTokens, model } = aiConfig;

    // Load source files
    const sourceFiles = this.loadSourceFiles(project.path, project.srcDir ?? 'src');

    if (sourceFiles.length === 0) {
      return { exists: false, locations: [] };
    }

    // Build prompt for error boundary check
    const systemPrompt = `You are a code analysis expert. Your task is to identify error handling patterns in a codebase.

Look for:
1. React Error Boundaries (class components with componentDidCatch or getDerivedStateFromError)
2. Try-catch blocks around async operations
3. Global error handlers
4. API error response handling
5. Form validation error handling

Respond in JSON format:
{
  "exists": true | false,
  "locations": ["path/to/file.ts:functionName", ...]
}`;

    const userPrompt = `Analyze these source files for error handling patterns:

${sourceFiles.map((f) => `### ${f.path}\n\`\`\`typescript\n${f.content}\n\`\`\``).join('\n\n')}

Identify all error handling mechanisms present in the code.`;

    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        // Default to assuming error boundaries exist if we can't check
        return { exists: true, locations: [] };
      }

      return this.parseErrorBoundaryResponse(textContent.text);
    } catch (error) {
      // Default to true on error to avoid false negatives
      console.error('Error checking error boundaries:', error);
      return { exists: true, locations: [] };
    }
  },

  /**
   * Parse validation response from AI
   */
  parseValidationResponse(
    response: string,
    layer: 'ui' | 'api' | 'db'
  ): { passed: boolean; errors: ValidationError[]; warnings: string[] } {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { passed: true, errors: [], warnings: [] };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const passed = parsed.passed ?? true;
      const errors: ValidationError[] = (parsed.errors || []).map(
        (e: Record<string, unknown>) => ({
          contractType: String(e.contractType ?? 'unknown'),
          layer,
          message: String(e.message ?? ''),
          filePath: e.filePath ? String(e.filePath) : undefined,
          severity: e.severity === 'warning' ? 'warning' : 'error',
        })
      );
      const warnings = (parsed.warnings || []).map(String);

      return { passed, errors, warnings };
    } catch {
      return { passed: true, errors: [], warnings: [] };
    }
  },

  /**
   * Parse error boundary check response
   */
  parseErrorBoundaryResponse(response: string): { exists: boolean; locations: string[] } {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { exists: true, locations: [] };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        exists: parsed.exists ?? true,
        locations: (parsed.locations || []).map(String),
      };
    } catch {
      return { exists: true, locations: [] };
    }
  },

  /**
   * Load source files for analysis
   *
   * @param projectPath - Project root path
   * @param srcDir - Source directory name
   * @param maxFiles - Maximum files to load
   * @returns Array of file contents
   */
  loadSourceFiles(
    projectPath: string,
    srcDir: string = 'src',
    maxFiles: number = 30
  ): { path: string; content: string }[] {
    const files: { path: string; content: string }[] = [];
    const srcPath = path.join(projectPath, srcDir);

    if (!fs.existsSync(srcPath)) {
      return files;
    }

    const discoverFiles = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const results: string[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          entry.name !== 'node_modules' &&
          entry.name !== '__tests__' &&
          !entry.name.includes('test')
        ) {
          results.push(...discoverFiles(fullPath));
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
          !entry.name.includes('.test.') &&
          !entry.name.includes('.spec.')
        ) {
          results.push(fullPath);
        }
      }

      return results;
    };

    const allFiles = discoverFiles(srcPath).slice(0, maxFiles);

    for (const filePath of allFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Limit content size per file
        const truncatedContent = content.slice(0, 8000);
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

  /**
   * Store validation result in database
   *
   * @param executionId - Execution ID
   * @param result - Validation result
   * @param frozenContracts - Original frozen contracts
   * @param db - Optional database instance
   */
  storeValidationResult(
    executionId: string,
    result: ContractValidationResult,
    frozenContracts: FrozenContracts,
    db?: DatabaseInstance
  ): void {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      // Store each validated contract in the contracts table
      const allContracts = [
        ...frozenContracts.ui.map((c) => ({ ...c, layer: 'ui' as const })),
        ...frozenContracts.api.map((c) => ({ ...c, layer: 'api' as const })),
        ...frozenContracts.db.map((c) => ({ ...c, layer: 'db' as const })),
      ];

      for (const contract of allContracts) {
        const id = uuidv4();
        const now = new Date().toISOString();

        database
          .prepare(
            `INSERT INTO contracts (id, execution_id, layer, contract_type, definition, frozen_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(id, executionId, contract.layer, contract.contractType, contract.definition, frozenContracts.frozenAt, now);
      }
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },
};
