/**
 * Discussion Engine - Generates contextual responses using Claude
 *
 * The discussion engine facilitates conversations between users and MetaRalph
 * about projects. It uses Claude to generate intelligent, context-aware responses
 * that incorporate project information like README, structure, and history.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { ConversationRepository, type Message, type Conversation } from './conversation.js';
import { getProject, type Project } from '../registry/index.js';
import { initDatabase, type DatabaseInstance } from '../db/index.js';

/**
 * Context information about a project for discussion prompts
 */
export interface ProjectContext {
  name: string;
  path: string;
  readme: string | null;
  structure: string | null;
  packageJson: Record<string, unknown> | null;
}

/**
 * Options for generating a response
 */
export interface DiscussionOptions {
  /** Maximum tokens for the response */
  maxTokens?: number;
  /** Temperature for response generation (0-1) */
  temperature?: number;
  /** Include project README in context */
  includeReadme?: boolean;
  /** Include project structure in context */
  includeStructure?: boolean;
  /** Include package.json in context */
  includePackageJson?: boolean;
  /** Custom system prompt override */
  systemPrompt?: string;
}

/**
 * Result of a discussion response generation
 */
export interface DiscussionResult {
  success: boolean;
  message?: Message;
  error?: string;
}

/**
 * Default options for discussion
 */
const DEFAULT_OPTIONS: Required<DiscussionOptions> = {
  maxTokens: 2048,
  temperature: 0.7,
  includeReadme: true,
  includeStructure: true,
  includePackageJson: true,
  systemPrompt: '',
};

/**
 * Read a file if it exists, return null otherwise
 */
function readFileIfExists(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Get directory structure (shallow, first 2 levels)
 */
function getDirectoryStructure(projectPath: string, depth: number = 2): string {
  const result: string[] = [];

  function walk(currentPath: string, currentDepth: number, prefix: string = ''): void {
    if (currentDepth > depth) return;

    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      // Filter out common non-essential directories
      const filteredEntries = entries.filter((entry) => {
        const name = entry.name;
        return (
          !name.startsWith('.') &&
          name !== 'node_modules' &&
          name !== 'dist' &&
          name !== 'build' &&
          name !== 'coverage' &&
          name !== '__pycache__' &&
          name !== '.git'
        );
      });

      for (let i = 0; i < filteredEntries.length; i++) {
        const entry = filteredEntries[i];
        const isLast = i === filteredEntries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const nextPrefix = isLast ? '    ' : '│   ';

        result.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? '/' : ''}`);

        if (entry.isDirectory()) {
          walk(path.join(currentPath, entry.name), currentDepth + 1, prefix + nextPrefix);
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  result.push(path.basename(projectPath) + '/');
  walk(projectPath, 1);

  return result.join('\n');
}

/**
 * Build project context from the project path
 */
function buildProjectContext(project: Project, options: Required<DiscussionOptions>): ProjectContext {
  let readme: string | null = null;
  let structure: string | null = null;
  let packageJson: Record<string, unknown> | null = null;

  if (options.includeReadme) {
    // Try different README variations
    const readmeNames = ['README.md', 'README', 'readme.md', 'Readme.md'];
    for (const name of readmeNames) {
      const content = readFileIfExists(path.join(project.path, name));
      if (content) {
        // Truncate very long READMEs
        readme = content.length > 5000 ? content.slice(0, 5000) + '\n\n[... truncated ...]' : content;
        break;
      }
    }
  }

  if (options.includeStructure) {
    structure = getDirectoryStructure(project.path);
  }

  if (options.includePackageJson) {
    const pkgContent = readFileIfExists(path.join(project.path, 'package.json'));
    if (pkgContent) {
      try {
        packageJson = JSON.parse(pkgContent);
      } catch {
        // Ignore parse errors
      }
    }
  }

  return {
    name: project.name,
    path: project.path,
    readme,
    structure,
    packageJson,
  };
}

/**
 * Build the system prompt for Claude
 */
function buildSystemPrompt(context: ProjectContext, customPrompt: string): string {
  let systemPrompt = `You are MetaRalph, an intelligent assistant helping developers improve their software projects.

You are currently discussing the project: ${context.name}
Project path: ${context.path}

Your role is to:
1. Help the user understand their codebase
2. Suggest improvements and optimizations
3. Help create PRDs (Product Requirements Documents) for new features
4. Answer questions about the project architecture and best practices
5. Help identify and prioritize technical debt

Be concise but thorough. Focus on practical, actionable advice. When suggesting changes, explain the benefits and potential trade-offs.

`;

  if (context.readme) {
    systemPrompt += `## Project README\n\n${context.readme}\n\n`;
  }

  if (context.structure) {
    systemPrompt += `## Project Structure\n\n\`\`\`\n${context.structure}\n\`\`\`\n\n`;
  }

  if (context.packageJson) {
    const pkg = context.packageJson;
    systemPrompt += `## Package Information\n\n`;
    if (pkg.name) systemPrompt += `- Name: ${pkg.name}\n`;
    if (pkg.description) systemPrompt += `- Description: ${pkg.description}\n`;
    if (pkg.version) systemPrompt += `- Version: ${pkg.version}\n`;
    if (pkg.dependencies && typeof pkg.dependencies === 'object') {
      const deps = Object.keys(pkg.dependencies);
      if (deps.length > 0) {
        systemPrompt += `- Key dependencies: ${deps.slice(0, 10).join(', ')}${deps.length > 10 ? '...' : ''}\n`;
      }
    }
    systemPrompt += '\n';
  }

  if (customPrompt) {
    systemPrompt += `## Additional Instructions\n\n${customPrompt}\n\n`;
  }

  return systemPrompt;
}

/**
 * Convert conversation messages to Anthropic API format
 */
function messagesToAnthropicFormat(messages: Message[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
}

/**
 * DiscussionEngine - Generates contextual responses using Claude
 */
export const DiscussionEngine = {
  /**
   * Create an Anthropic client
   * Requires ANTHROPIC_API_KEY environment variable
   */
  createClient(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is required for discussion features. ' +
          'Set it in your shell or .env file.'
      );
    }
    return new Anthropic({ apiKey });
  },

  /**
   * Generate a response in a conversation
   *
   * @param conversationId - The conversation to respond in
   * @param userMessage - The user's message
   * @param options - Discussion options
   * @param db - Optional database instance
   * @returns The generated response
   */
  async respond(
    conversationId: string,
    userMessage: string,
    options: DiscussionOptions = {},
    db?: DatabaseInstance
  ): Promise<DiscussionResult> {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      // Get conversation
      const conversation = ConversationRepository.findById(conversationId, database);
      if (!conversation) {
        return {
          success: false,
          error: `Conversation not found: ${conversationId}`,
        };
      }

      // Get project
      const project = getProject(conversation.projectId, database);
      if (!project) {
        return {
          success: false,
          error: `Project not found: ${conversation.projectId}`,
        };
      }

      // Merge options with defaults
      const mergedOptions: Required<DiscussionOptions> = {
        ...DEFAULT_OPTIONS,
        ...options,
      };

      // Build context and prompts
      const context = buildProjectContext(project, mergedOptions);
      const systemPrompt = buildSystemPrompt(context, mergedOptions.systemPrompt);

      // Add user message to conversation first
      const userMsg = ConversationRepository.addMessage(
        {
          conversationId,
          role: 'user',
          content: userMessage,
        },
        database
      );

      // Get existing messages for context
      const existingMessages = ConversationRepository.getMessages(conversationId, database);
      const anthropicMessages = messagesToAnthropicFormat(existingMessages);

      // Create client and make request
      const client = this.createClient();

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: mergedOptions.maxTokens,
        system: systemPrompt,
        messages: anthropicMessages,
      });

      // Extract text content
      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return {
          success: false,
          error: 'No text response from Claude',
        };
      }

      // Add assistant response to conversation
      const assistantMsg = ConversationRepository.addMessage(
        {
          conversationId,
          role: 'assistant',
          content: textContent.text,
        },
        database
      );

      return {
        success: true,
        message: assistantMsg,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to generate response: ${errorMessage}`,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Start a new conversation with an initial message
   *
   * @param projectId - The project to discuss
   * @param title - Title for the conversation
   * @param userMessage - Initial user message
   * @param options - Discussion options
   * @param db - Optional database instance
   * @returns The created conversation and response
   */
  async startConversation(
    projectId: string,
    title: string,
    userMessage: string,
    options: DiscussionOptions = {},
    db?: DatabaseInstance
  ): Promise<{ conversation?: Conversation; result: DiscussionResult }> {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      // Verify project exists
      const project = getProject(projectId, database);
      if (!project) {
        return {
          result: {
            success: false,
            error: `Project not found: ${projectId}`,
          },
        };
      }

      // Create conversation
      const conversation = ConversationRepository.create(
        {
          projectId,
          title,
        },
        database
      );

      // Generate first response
      const result = await this.respond(conversation.id, userMessage, options, database);

      return {
        conversation,
        result,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Get project context for external use (e.g., PRD building)
   */
  getProjectContext(project: Project, options: DiscussionOptions = {}): ProjectContext {
    const mergedOptions: Required<DiscussionOptions> = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
    return buildProjectContext(project, mergedOptions);
  },
};
