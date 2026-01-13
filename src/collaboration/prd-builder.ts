/**
 * PRD Builder - Interactive PRD creation through conversation
 *
 * The PrdBuilder facilitates collaborative PRD creation between users and MetaRalph.
 * Claude helps refine the description, user stories, and acceptance criteria
 * through an iterative conversation flow.
 */

import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import { ConversationRepository, type Message, type Conversation } from './conversation.js';
import { DiscussionEngine, type ProjectContext } from './discussion.js';
import { getProject, type Project } from '../registry/index.js';
import { TaskRepository, type CreateTaskInput, type Task, type TaskType, type EffortLevel } from '../queue/task.js';
import { initDatabase, type DatabaseInstance } from '../db/index.js';

/**
 * User story structure for a PRD
 */
export interface UserStory {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: number;
  passes: boolean;
  notes: string;
}

/**
 * PRD structure matching Ralph's expected format
 */
export interface Prd {
  project: string;
  branchName: string;
  description: string;
  userStories: UserStory[];
}

/**
 * State of the PRD building process
 */
export type PrdBuildState = 'initial' | 'refining_description' | 'creating_stories' | 'reviewing' | 'finalized';

/**
 * PRD Builder session
 */
export interface PrdBuilderSession {
  id: string;
  conversationId: string;
  projectId: string;
  state: PrdBuildState;
  currentPrd: Partial<Prd>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Result of a PRD build step
 */
export interface PrdBuildResult {
  success: boolean;
  session?: PrdBuilderSession;
  message?: string;
  response?: string;
  error?: string;
  task?: Task;
}

/**
 * Options for building a PRD
 */
export interface PrdBuildOptions {
  /** Initial feature description */
  description?: string;
  /** Suggested task type */
  taskType?: TaskType;
  /** Estimated effort */
  effort?: EffortLevel;
  /** Maximum tokens for AI response */
  maxTokens?: number;
}

/**
 * System prompt for PRD building conversations
 */
const PRD_BUILDER_SYSTEM_PROMPT = `You are MetaRalph, an expert at creating Product Requirements Documents (PRDs) for software projects.

Your goal is to help the user create a clear, actionable PRD that can be executed by an autonomous coding agent (Ralph).

When creating PRDs, follow these principles:
1. **Small, focused tasks**: Each user story should be completable in ONE context window (~10 iterations max)
2. **Verifiable criteria**: Every story needs clear acceptance criteria, always including "Typecheck passes"
3. **Proper sequencing**: Dependencies come first (schema -> backend -> UI)
4. **Clear descriptions**: Each story should have an "As a [user], I want [feature] so that [benefit]" format

When the user describes what they want to build, help them:
1. Clarify the requirements and scope
2. Break it down into small, incremental user stories
3. Define clear acceptance criteria for each story
4. Order the stories by dependency

Respond conversationally but stay focused on building the PRD. Ask clarifying questions when needed.

When you have enough information to create the PRD, format it clearly with:
- A brief description of the feature
- User stories with ID, title, description, and acceptance criteria

If the user says "finalize" or indicates they're happy with the PRD, output the final PRD in JSON format between <prd> and </prd> tags.`;

/**
 * In-memory store for active PRD builder sessions
 */
const activeSessions = new Map<string, PrdBuilderSession>();

/**
 * Parse PRD JSON from Claude's response
 */
function parsePrdFromResponse(response: string): Prd | null {
  // Look for PRD between tags
  const prdMatch = response.match(/<prd>([\s\S]*?)<\/prd>/);
  if (prdMatch) {
    try {
      return JSON.parse(prdMatch[1].trim());
    } catch {
      // Try to extract just the JSON object
      const jsonMatch = prdMatch[1].match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          return null;
        }
      }
    }
  }

  // Try to find raw JSON object in response
  const jsonMatch = response.match(/\{\s*"project"[\s\S]*?\}\s*\]/);
  if (jsonMatch) {
    try {
      // Add closing brace if missing
      let jsonStr = jsonMatch[0];
      if (!jsonStr.endsWith('}')) {
        jsonStr += '}';
      }
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Generate a branch name from the PRD description
 */
function generateBranchName(projectName: string, description: string): string {
  // Create a slug from the description
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 40)
    .replace(/-+$/, '');

  return `ralph/${slug}-${Date.now().toString(36)}`;
}

/**
 * Infer task type from description
 */
function inferTaskType(description: string): TaskType {
  const lowerDesc = description.toLowerCase();

  if (lowerDesc.includes('bug') || lowerDesc.includes('fix') || lowerDesc.includes('error')) {
    return 'bug_fix';
  }
  if (lowerDesc.includes('test') || lowerDesc.includes('spec') || lowerDesc.includes('coverage')) {
    return 'test';
  }
  if (lowerDesc.includes('doc') || lowerDesc.includes('readme') || lowerDesc.includes('comment')) {
    return 'docs';
  }
  if (lowerDesc.includes('refactor') || lowerDesc.includes('clean') || lowerDesc.includes('reorganize')) {
    return 'refactor';
  }

  return 'feature';
}

/**
 * Infer effort level from user stories count
 */
function inferEffortLevel(storiesCount: number): EffortLevel {
  if (storiesCount === 1) {
    return 'quick_win';
  }
  if (storiesCount <= 3) {
    return 'small';
  }
  if (storiesCount <= 5) {
    return 'medium';
  }
  return 'large';
}

/**
 * PrdBuilder - Interactive PRD creation through conversation
 */
export const PrdBuilder = {
  /**
   * Create an Anthropic client
   */
  createClient(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is required for PRD building. ' +
          'Set it in your shell or .env file.'
      );
    }
    return new Anthropic({ apiKey });
  },

  /**
   * Start a new PRD building session
   *
   * @param projectId - The project to build PRD for
   * @param initialMessage - Initial description or request
   * @param options - Build options
   * @param db - Optional database instance
   * @returns The build result with session and response
   */
  async start(
    projectId: string,
    initialMessage: string,
    options: PrdBuildOptions = {},
    db?: DatabaseInstance
  ): Promise<PrdBuildResult> {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      // Verify project exists
      const project = getProject(projectId, database);
      if (!project) {
        return {
          success: false,
          error: `Project not found: ${projectId}`,
        };
      }

      // Create conversation for the PRD building session
      const conversation = ConversationRepository.create(
        {
          projectId,
          title: `PRD: ${initialMessage.substring(0, 50)}...`,
        },
        database
      );

      // Build project context
      const context = DiscussionEngine.getProjectContext(project);

      // Build system prompt with project context
      let systemPrompt = PRD_BUILDER_SYSTEM_PROMPT;
      systemPrompt += `\n\n## Project Context\n`;
      systemPrompt += `Project: ${context.name}\n`;
      systemPrompt += `Path: ${context.path}\n`;

      if (context.readme) {
        systemPrompt += `\n### README\n${context.readme.substring(0, 2000)}\n`;
      }

      if (context.structure) {
        systemPrompt += `\n### Structure\n\`\`\`\n${context.structure}\n\`\`\`\n`;
      }

      // Add user message to conversation
      ConversationRepository.addMessage(
        {
          conversationId: conversation.id,
          role: 'user',
          content: initialMessage,
        },
        database
      );

      // Create initial session
      const session: PrdBuilderSession = {
        id: uuidv4(),
        conversationId: conversation.id,
        projectId,
        state: 'initial',
        currentPrd: {
          project: project.name,
          description: options.description ?? initialMessage,
          userStories: [],
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Store session
      activeSessions.set(session.id, session);

      // Get AI response
      const client = this.createClient();
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: options.maxTokens ?? 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: initialMessage }],
      });

      // Extract text response
      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return {
          success: false,
          error: 'No text response from Claude',
        };
      }

      // Add assistant response to conversation
      ConversationRepository.addMessage(
        {
          conversationId: conversation.id,
          role: 'assistant',
          content: textContent.text,
        },
        database
      );

      // Update session state based on response
      session.state = 'refining_description';
      session.updatedAt = new Date().toISOString();

      return {
        success: true,
        session,
        response: textContent.text,
        message: 'PRD building session started',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to start PRD building: ${errorMessage}`,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Continue an existing PRD building session
   *
   * @param sessionId - The session ID
   * @param userMessage - User's message
   * @param options - Build options
   * @param db - Optional database instance
   * @returns The build result
   */
  async continue(
    sessionId: string,
    userMessage: string,
    options: PrdBuildOptions = {},
    db?: DatabaseInstance
  ): Promise<PrdBuildResult> {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      // Get session
      const session = activeSessions.get(sessionId);
      if (!session) {
        return {
          success: false,
          error: `Session not found: ${sessionId}`,
        };
      }

      // Get project
      const project = getProject(session.projectId, database);
      if (!project) {
        return {
          success: false,
          error: `Project not found: ${session.projectId}`,
        };
      }

      // Add user message to conversation
      ConversationRepository.addMessage(
        {
          conversationId: session.conversationId,
          role: 'user',
          content: userMessage,
        },
        database
      );

      // Get conversation history
      const messages = ConversationRepository.getMessages(session.conversationId, database);
      const anthropicMessages = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      // Build context-aware system prompt
      const context = DiscussionEngine.getProjectContext(project);
      let systemPrompt = PRD_BUILDER_SYSTEM_PROMPT;
      systemPrompt += `\n\n## Project Context\n`;
      systemPrompt += `Project: ${context.name}\n`;
      systemPrompt += `Path: ${context.path}\n`;

      if (context.readme) {
        systemPrompt += `\n### README\n${context.readme.substring(0, 2000)}\n`;
      }

      // Get AI response
      const client = this.createClient();
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: options.maxTokens ?? 2048,
        system: systemPrompt,
        messages: anthropicMessages,
      });

      // Extract text response
      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return {
          success: false,
          error: 'No text response from Claude',
        };
      }

      const responseText = textContent.text;

      // Add assistant response to conversation
      ConversationRepository.addMessage(
        {
          conversationId: session.conversationId,
          role: 'assistant',
          content: responseText,
        },
        database
      );

      // Check if PRD was finalized
      const prd = parsePrdFromResponse(responseText);
      if (prd) {
        // PRD was finalized - create task
        session.state = 'finalized';
        session.currentPrd = prd;
        session.updatedAt = new Date().toISOString();

        // Create task from PRD
        const task = await this.createTaskFromPrd(prd, session.projectId, database);

        // Clean up session
        activeSessions.delete(sessionId);

        return {
          success: true,
          session,
          response: responseText,
          message: 'PRD finalized and task created',
          task,
        };
      }

      // Update session state based on conversation
      if (session.state === 'initial' || session.state === 'refining_description') {
        if (userMessage.toLowerCase().includes('story') || userMessage.toLowerCase().includes('stories')) {
          session.state = 'creating_stories';
        }
      } else if (session.state === 'creating_stories') {
        if (userMessage.toLowerCase().includes('review') || userMessage.toLowerCase().includes('looks good')) {
          session.state = 'reviewing';
        }
      }

      session.updatedAt = new Date().toISOString();

      return {
        success: true,
        session,
        response: responseText,
        message: 'PRD building continued',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to continue PRD building: ${errorMessage}`,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Build PRD from scratch with AI assistance
   *
   * @param projectId - The project ID
   * @param description - Feature description
   * @param options - Build options
   * @param db - Optional database instance
   * @returns The final PRD
   */
  async buildPrd(
    projectId: string,
    description: string,
    options: PrdBuildOptions = {},
    db?: DatabaseInstance
  ): Promise<{ success: boolean; prd?: Prd; error?: string }> {
    const shouldCloseDb = !db;
    const database = db ?? initDatabase();

    try {
      // Get project
      const project = getProject(projectId, database);
      if (!project) {
        return {
          success: false,
          error: `Project not found: ${projectId}`,
        };
      }

      // Build project context
      const context = DiscussionEngine.getProjectContext(project);

      // Create a prompt for PRD generation
      const prompt = `Create a PRD for the following feature request:

${description}

Based on the project context, generate a complete PRD with:
1. A clear description
2. User stories broken down into small, incremental tasks
3. Clear acceptance criteria for each story

Remember:
- Each story should be completable in ONE context window
- Order stories by dependency (schema -> backend -> UI)
- Always include "Typecheck passes" in acceptance criteria

Output the PRD in JSON format between <prd> and </prd> tags with this structure:
{
  "project": "${project.name}",
  "branchName": "ralph/<feature-slug>-<timestamp>",
  "description": "Feature description",
  "userStories": [
    {
      "id": "US-001",
      "title": "Story title",
      "description": "As a [user], I want [feature] so that [benefit]",
      "acceptanceCriteria": ["Criterion 1", "Typecheck passes"],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}`;

      // Build system prompt
      let systemPrompt = PRD_BUILDER_SYSTEM_PROMPT;
      systemPrompt += `\n\n## Project Context\n`;
      systemPrompt += `Project: ${context.name}\n`;
      systemPrompt += `Path: ${context.path}\n`;

      if (context.readme) {
        systemPrompt += `\n### README\n${context.readme.substring(0, 2000)}\n`;
      }

      if (context.structure) {
        systemPrompt += `\n### Structure\n\`\`\`\n${context.structure}\n\`\`\`\n`;
      }

      // Get AI to generate PRD
      const client = this.createClient();
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: options.maxTokens ?? 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      });

      // Extract text response
      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return {
          success: false,
          error: 'No text response from Claude',
        };
      }

      // Parse PRD from response
      const prd = parsePrdFromResponse(textContent.text);
      if (!prd) {
        return {
          success: false,
          error: 'Failed to parse PRD from AI response',
        };
      }

      // Ensure branch name is set
      if (!prd.branchName) {
        prd.branchName = generateBranchName(project.name, description);
      }

      return {
        success: true,
        prd,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to build PRD: ${errorMessage}`,
      };
    } finally {
      if (shouldCloseDb) {
        database.close();
      }
    }
  },

  /**
   * Create a task from a finalized PRD
   *
   * @param prd - The PRD to create a task from
   * @param projectId - The project ID
   * @param db - Optional database instance
   * @returns The created task
   */
  async createTaskFromPrd(
    prd: Prd,
    projectId: string,
    db?: DatabaseInstance
  ): Promise<Task> {
    // Infer task properties from PRD
    const taskType = inferTaskType(prd.description);
    const effort = inferEffortLevel(prd.userStories.length);

    const taskInput: CreateTaskInput = {
      projectId,
      type: taskType,
      title: prd.description.substring(0, 100),
      source: 'conversation',
      estimatedEffort: effort,
      description: prd.description,
      prdJson: JSON.stringify(prd, null, 2),
    };

    return TaskRepository.create(taskInput, db);
  },

  /**
   * Get an active PRD builder session
   */
  getSession(sessionId: string): PrdBuilderSession | undefined {
    return activeSessions.get(sessionId);
  },

  /**
   * List all active sessions for a project
   */
  getSessionsForProject(projectId: string): PrdBuilderSession[] {
    return Array.from(activeSessions.values()).filter(
      (session) => session.projectId === projectId
    );
  },

  /**
   * Cancel an active session
   */
  cancelSession(sessionId: string): boolean {
    return activeSessions.delete(sessionId);
  },
};
