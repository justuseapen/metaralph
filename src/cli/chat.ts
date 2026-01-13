/**
 * Chat CLI - Interactive chat and propose sessions
 *
 * Implements the interactive terminal interface for chatting with MetaRalph
 * about projects and creating PRDs collaboratively.
 */

import * as readline from 'node:readline';
import { DiscussionEngine } from '../collaboration/discussion.js';
import { PrdBuilder, type PrdBuilderSession } from '../collaboration/prd-builder.js';
import { ConversationRepository } from '../collaboration/conversation.js';
import { getProject } from '../registry/index.js';
import { OnboardingEngine } from '../onboarding/index.js';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Start an interactive chat session with MetaRalph
 *
 * @param projectId - The project to chat about
 */
export async function startChatSession(projectId: string): Promise<void> {
  const project = getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // Create readline interface for user input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let prdSession: PrdBuilderSession | null = null;
  let conversationId: string | null = null;

  // Handle cleanup
  const cleanup = () => {
    rl.close();
    console.log('\n\nChat session ended.');
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  // Main chat loop
  const prompt = () => {
    rl.question('You: ', async (input) => {
      const trimmedInput = input.trim();

      // Handle exit
      if (trimmedInput.toLowerCase() === 'exit' || trimmedInput.toLowerCase() === 'quit') {
        cleanup();
        return;
      }

      // Handle empty input
      if (!trimmedInput) {
        prompt();
        return;
      }

      try {
        // Check if we're in a PRD building session
        if (prdSession) {
          // Continue PRD building
          const result = await PrdBuilder.continue(prdSession.id, trimmedInput);

          if (result.success) {
            console.log('');
            console.log('MetaRalph:', result.response);
            console.log('');

            if (result.task) {
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log('Task created from PRD:');
              console.log(`  ID:       ${result.task.id}`);
              console.log(`  Title:    ${result.task.title}`);
              console.log(`  Type:     ${result.task.type}`);
              console.log(`  Effort:   ${result.task.estimatedEffort}`);
              console.log(`  Status:   ${result.task.status}`);
              console.log(`  Approval: ${result.task.approvalStatus}`);
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log('');

              // Reset session after task creation
              prdSession = null;
            } else if (result.session) {
              prdSession = result.session;
            }
          } else {
            console.error(`Error: ${result.error}`);
          }
        } else {
          // Check if user wants to start building a PRD
          const isPrdRequest =
            trimmedInput.toLowerCase().includes('build') ||
            trimmedInput.toLowerCase().includes('create') ||
            trimmedInput.toLowerCase().includes('implement') ||
            trimmedInput.toLowerCase().includes('add') ||
            trimmedInput.toLowerCase().includes('feature') ||
            trimmedInput.toLowerCase().includes('prd');

          if (isPrdRequest) {
            // Start PRD building session
            const result = await PrdBuilder.start(projectId, trimmedInput);

            if (result.success && result.session) {
              prdSession = result.session;
              conversationId = result.session.conversationId;

              console.log('');
              console.log('MetaRalph:', result.response);
              console.log('');
            } else {
              console.error(`Error: ${result.error}`);
            }
          } else {
            // Regular discussion
            if (!conversationId) {
              // Start a new conversation
              const { conversation, result } = await DiscussionEngine.startConversation(
                projectId,
                `Chat: ${trimmedInput.substring(0, 50)}`,
                trimmedInput
              );

              if (result.success && conversation) {
                conversationId = conversation.id;
                console.log('');
                console.log('MetaRalph:', result.message?.content);
                console.log('');
              } else {
                console.error(`Error: ${result.error}`);
              }
            } else {
              // Continue existing conversation
              const result = await DiscussionEngine.respond(conversationId, trimmedInput);

              if (result.success) {
                console.log('');
                console.log('MetaRalph:', result.message?.content);
                console.log('');
              } else {
                console.error(`Error: ${result.error}`);
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Continue the loop
      prompt();
    });
  };

  // Start the chat loop
  prompt();
}

/**
 * System prompt for improvement proposals
 */
const PROPOSE_SYSTEM_PROMPT = `You are MetaRalph, an expert at analyzing software projects and proposing improvements.

Your goal is to analyze the project and suggest high-value improvements that can be executed autonomously.

When proposing improvements, consider:
1. **Quick wins**: Small fixes with immediate value (typos, dead code, simple refactors)
2. **Technical debt**: Type errors, lint issues, outdated dependencies
3. **Testing gaps**: Missing tests, low coverage areas
4. **Documentation**: Missing or outdated docs, unclear code
5. **Performance**: Obvious performance improvements
6. **Security**: Basic security improvements

For each proposal, provide:
- Clear title
- Brief description
- Expected benefit
- Estimated effort (quick_win, small, medium, large)
- Suggested task type (bug_fix, test, docs, refactor, feature)

Focus on actionable, well-scoped improvements that can each be completed in a single autonomous session.

Output your proposals in a structured format, listing each improvement with its details.`;

/**
 * Start a propose session where MetaRalph suggests improvements
 *
 * @param projectId - The project to analyze
 * @param autoQueue - Whether to automatically queue approved proposals
 */
export async function startProposeSession(projectId: string, autoQueue: boolean): Promise<void> {
  const project = getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // First, run the analyzer to get concrete data
  console.log('Analyzing project structure and code...');
  console.log('');

  const analysisResult = await OnboardingEngine.preview(project.path);

  if (!analysisResult.success) {
    console.error(`Analysis failed: ${analysisResult.message}`);
    return;
  }

  // Display analysis summary
  if (analysisResult.analysis) {
    console.log('Analysis Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const byType = analysisResult.analysis.opportunities.reduce((acc, opp) => {
      acc[opp.type] = (acc[opp.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    if (byType.outdated_dep) console.log(`  Outdated dependencies: ${byType.outdated_dep}`);
    if (byType.type_error) console.log(`  Type errors: ${byType.type_error}`);
    if (byType.lint_issue) console.log(`  Lint issues: ${byType.lint_issue}`);
    if (byType.todo_comment) console.log(`  TODO comments: ${byType.todo_comment}`);

    console.log('');
    console.log('TODO Summary');
    console.log(`  TODO:  ${analysisResult.analysis.todoSummary.TODO}`);
    console.log(`  FIXME: ${analysisResult.analysis.todoSummary.FIXME}`);
    console.log(`  XXX:   ${analysisResult.analysis.todoSummary.XXX}`);
    console.log(`  HACK:  ${analysisResult.analysis.todoSummary.HACK}`);
    console.log('');
  }

  // Now ask Claude to propose higher-level improvements
  console.log('Generating improvement proposals...');
  console.log('');

  try {
    // Get project context
    const context = DiscussionEngine.getProjectContext(project);

    // Build analysis context for the prompt
    let analysisContext = '';
    if (analysisResult.analysis) {
      analysisContext = `\n\n## Analysis Results\n`;
      analysisContext += `Found ${analysisResult.analysis.opportunities.length} improvement opportunities.\n`;

      // Group and summarize
      const opportunities = analysisResult.analysis.opportunities;
      if (opportunities.length > 0) {
        analysisContext += '\nTop issues:\n';
        for (const opp of opportunities.slice(0, 10)) {
          analysisContext += `- [${opp.type}] ${opp.title}\n`;
        }
      }
    }

    // Create prompt
    const prompt = `Analyze the following project and propose 3-5 high-value improvements:

Project: ${context.name}
Path: ${context.path}

${context.readme ? `## README\n${context.readme.substring(0, 2000)}` : ''}

${context.structure ? `## Structure\n\`\`\`\n${context.structure}\n\`\`\`` : ''}

${analysisContext}

Based on this analysis, propose specific improvements that would add the most value. Focus on:
1. Any critical bugs or type errors
2. Missing tests for core functionality
3. Documentation gaps
4. Simple refactors that improve code quality
5. Performance or security quick wins

For each proposal, provide: title, description, benefit, effort estimate, and task type.`;

    // Get Claude's response
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: PROPOSE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract and display response
    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    console.log('Improvement Proposals');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log(textContent.text);
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (autoQueue) {
      console.log('');
      console.log('To queue these proposals, run:');
      console.log(`  metaralph projects analyze ${projectId}`);
    } else {
      console.log('');
      console.log('To create tasks from the analysis, run:');
      console.log(`  metaralph projects analyze ${projectId}`);
      console.log('');
      console.log('Or start an interactive session to refine proposals:');
      console.log(`  metaralph chat ${project.name}`);
    }
  } catch (error) {
    throw new Error(`Failed to generate proposals: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
