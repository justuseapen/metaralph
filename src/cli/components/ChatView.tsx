/**
 * ChatView - Provides AI chat interface in the dashboard
 *
 * Displays chat history with timestamps and allows sending prompts to Claude.
 * US-102: Message display with user/assistant styling and scroll support.
 * US-103: Multi-line chat input with Ctrl+Enter submit.
 * US-104: Streaming Claude responses with real-time display.
 * US-105: Project context selector for targeted AI assistance.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Anthropic from '@anthropic-ai/sdk';
import {
  ConversationRepository,
  type Message,
  type Conversation,
} from '../../collaboration/conversation.js';
import { listProjects, getProject, type Project } from '../../registry/index.js';
import { DiscussionEngine, type ProjectContext } from '../../collaboration/discussion.js';

// Maximum character limit for chat input
const MAX_INPUT_LENGTH = 4000;

// Spinner frames for streaming indicator
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Streaming message type for in-progress responses
interface StreamingMessage {
  content: string;
  isComplete: boolean;
}

/**
 * Format a timestamp for display
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a date for display (for message grouping headers)
 */
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Message display component - renders a single message with role-specific styling
 */
function MessageItem({ message }: { message: Message }): React.ReactElement {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  // Style based on role
  const roleLabel = isUser ? 'You' : isSystem ? 'System' : 'Claude';
  const roleColor = isUser ? 'cyan' : isSystem ? 'yellow' : 'green';
  const contentColor = isUser ? 'white' : isSystem ? 'yellow' : 'greenBright';

  // Truncate very long messages for display (full content in detail view later)
  const maxContentLength = 500;
  const displayContent =
    message.content.length > maxContentLength
      ? message.content.slice(0, maxContentLength) + '...'
      : message.content;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={roleColor} bold>
          {roleLabel}
        </Text>
        <Text dimColor> · {formatTimestamp(message.createdAt)}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text color={isUser ? undefined : contentColor} wrap="wrap">
          {displayContent}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Streaming indicator with spinner animation
 * US-104: Shows while Claude is generating a response
 */
function StreamingIndicator({
  content,
  spinnerFrame,
}: {
  content: string;
  spinnerFrame: number;
}): React.ReactElement {
  const spinner = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];

  // Truncate streaming content for display
  const maxContentLength = 500;
  const displayContent =
    content.length > maxContentLength
      ? content.slice(0, maxContentLength) + '...'
      : content;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="green" bold>
          Claude
        </Text>
        <Text color="cyan"> {spinner} </Text>
        <Text dimColor>generating...</Text>
      </Box>
      {displayContent && (
        <Box paddingLeft={2}>
          <Text color="greenBright" wrap="wrap">
            {displayContent}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Empty state when no conversations exist
 */
function EmptyState(): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
    >
      <Text dimColor>No chat history yet.</Text>
      <Text dimColor>Start a conversation from a project to see messages here.</Text>
    </Box>
  );
}

/**
 * Loading state while fetching data
 */
function LoadingState(): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
    >
      <Text color="blue">Loading chat history...</Text>
    </Box>
  );
}

/**
 * Conversation selector for multiple conversations
 */
function ConversationList({
  conversations,
  selectedIndex,
  projects,
}: {
  conversations: Conversation[];
  selectedIndex: number;
  projects: Map<string, Project>;
}): React.ReactElement {
  return (
    <Box flexDirection="column" width={30} borderStyle="single" borderColor="gray">
      <Box paddingX={1} borderStyle="single" borderBottom borderTop={false} borderLeft={false} borderRight={false}>
        <Text bold color="blue">Conversations</Text>
      </Box>
      {conversations.map((conv, index) => {
        const isSelected = index === selectedIndex;
        const project = projects.get(conv.projectId);
        return (
          <Box key={conv.id} paddingX={1}>
            <Text inverse={isSelected} bold={isSelected}>
              {isSelected ? ' ▸ ' : '   '}
              {conv.title.slice(0, 22)}
              {project && ` [${project.name.slice(0, 8)}]`}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Project context selector dropdown
 * US-105: Allows selecting which project Claude should know about
 */
function ProjectSelector({
  projects,
  selectedProjectId,
  onSelect,
  isOpen,
  onToggle,
  selectedIndex,
}: {
  projects: Project[];
  selectedProjectId: string | null;
  onSelect: (projectId: string | null) => void;
  isOpen: boolean;
  onToggle: () => void;
  selectedIndex: number;
}): React.ReactElement {
  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId)
    : null;
  const displayName = selectedProject ? selectedProject.name : 'No project';

  return (
    <Box flexDirection="column">
      <Box
        borderStyle="single"
        borderColor={isOpen ? 'cyan' : 'gray'}
        paddingX={1}
      >
        <Text color="cyan" bold>
          Project:{' '}
        </Text>
        <Text color={selectedProject ? 'green' : 'gray'}>
          [{displayName}]
        </Text>
        <Text dimColor> (p to change)</Text>
      </Box>

      {isOpen && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="cyan"
          marginTop={0}
        >
          {/* No project option */}
          <Box paddingX={1}>
            <Text inverse={selectedIndex === 0} bold={selectedIndex === 0}>
              {selectedIndex === 0 ? ' ▸ ' : '   '}
              No project
            </Text>
          </Box>
          {/* Project list */}
          {projects.map((project, index) => {
            const itemIndex = index + 1;
            const isSelected = itemIndex === selectedIndex;
            return (
              <Box key={project.id} paddingX={1}>
                <Text inverse={isSelected} bold={isSelected}>
                  {isSelected ? ' ▸ ' : '   '}
                  {project.name}
                </Text>
                <Text dimColor> ({project.path.split('/').pop()})</Text>
              </Box>
            );
          })}
          <Box paddingX={1} marginTop={1}>
            <Text dimColor>↑↓ Select • Enter Confirm • Esc Cancel</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * Message list with scroll support
 * US-104: Includes streaming message display
 */
function MessageList({
  messages,
  scrollOffset,
  visibleCount,
  streamingMessage,
  spinnerFrame,
}: {
  messages: Message[];
  scrollOffset: number;
  visibleCount: number;
  streamingMessage: StreamingMessage | null;
  spinnerFrame: number;
}): React.ReactElement {
  // Calculate visible messages based on scroll offset
  const startIndex = Math.max(0, scrollOffset);
  const visibleMessages = messages.slice(startIndex, startIndex + visibleCount);

  // Group messages by date for better readability
  let lastDate = '';

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {/* Scroll indicator at top */}
      {scrollOffset > 0 && (
        <Box justifyContent="center" marginBottom={1}>
          <Text dimColor>↑ {scrollOffset} more message(s) above</Text>
        </Box>
      )}

      {visibleMessages.map((message) => {
        const messageDate = formatDate(message.createdAt);
        const showDateHeader = messageDate !== lastDate;
        lastDate = messageDate;

        return (
          <Box key={message.id} flexDirection="column">
            {showDateHeader && (
              <Box justifyContent="center" marginY={1}>
                <Text dimColor>── {messageDate} ──</Text>
              </Box>
            )}
            <MessageItem message={message} />
          </Box>
        );
      })}

      {/* Streaming message indicator - US-104 */}
      {streamingMessage && !streamingMessage.isComplete && (
        <StreamingIndicator content={streamingMessage.content} spinnerFrame={spinnerFrame} />
      )}

      {/* Scroll indicator at bottom */}
      {startIndex + visibleCount < messages.length && !streamingMessage && (
        <Box justifyContent="center" marginTop={1}>
          <Text dimColor>
            ↓ {messages.length - startIndex - visibleCount} more message(s) below
          </Text>
        </Box>
      )}

      {/* Auto-scroll hint */}
      {messages.length > 0 && !streamingMessage && (
        <Box marginTop={1}>
          <Text dimColor>Use ↑/↓ to scroll • End to jump to latest</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Chat input component with multi-line support
 * US-103: Multi-line input with Ctrl+Enter submit and character count
 */
function ChatInput({
  onSubmit,
  disabled,
}: {
  onSubmit: (message: string) => void;
  disabled: boolean;
}): React.ReactElement {
  const [value, setValue] = useState('');

  // Handle keyboard input for special keys
  useInput((input, key) => {
    if (disabled) return;

    // Escape clears current input
    if (key.escape) {
      setValue('');
      return;
    }

    // Ctrl+Enter or Cmd+Enter submits (key.meta is cmd on mac)
    // Note: Enter alone also submits via TextInput's onSubmit
    if ((key.ctrl || key.meta) && key.return) {
      if (value.trim()) {
        onSubmit(value.trim());
        setValue('');
      }
      return;
    }
  });

  // Handle submit from TextInput (Enter key)
  const handleSubmit = (submittedValue: string) => {
    if (disabled) return;
    if (submittedValue.trim()) {
      onSubmit(submittedValue.trim());
      setValue('');
    }
  };

  // Handle value change with max length enforcement
  const handleChange = (newValue: string) => {
    if (newValue.length <= MAX_INPUT_LENGTH) {
      setValue(newValue);
    }
  };

  const charCount = value.length;
  const isNearLimit = charCount > MAX_INPUT_LENGTH * 0.9;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={disabled ? 'gray' : 'cyan'}
      paddingX={1}
    >
      {/* Input header with character count */}
      <Box justifyContent="space-between" marginBottom={0}>
        <Text dimColor={disabled}>
          {disabled ? '⏳ Waiting for response...' : '💬 Type your message:'}
        </Text>
        <Text color={isNearLimit ? 'yellow' : 'gray'}>
          {charCount}/{MAX_INPUT_LENGTH}
        </Text>
      </Box>

      {/* Text input */}
      <Box>
        {disabled ? (
          <Text dimColor>Input disabled while processing...</Text>
        ) : (
          <TextInput
            value={value}
            onChange={handleChange}
            onSubmit={handleSubmit}
            placeholder="Enter your prompt... (Enter or Ctrl+Enter to send, Escape to clear)"
          />
        )}
      </Box>

      {/* Keyboard hints */}
      <Box marginTop={0}>
        <Text dimColor>
          <Text bold>Enter</Text> or <Text bold>Ctrl+Enter</Text> Send |{' '}
          <Text bold>Esc</Text> Clear
        </Text>
      </Box>
    </Box>
  );
}

/**
 * ChatView component - main chat interface for the dashboard
 * US-104: Enhanced with streaming Claude responses
 * US-105: Enhanced with project context selector
 */
export function ChatView(): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvIndex, setSelectedConvIndex] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [projects, setProjects] = useState<Map<string, Project>>(new Map());
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  // US-104: Streaming state
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const streamAbortRef = useRef<AbortController | null>(null);

  // US-105: Project selector state
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectSelectorOpen, setProjectSelectorOpen] = useState(false);
  const [projectSelectorIndex, setProjectSelectorIndex] = useState(0);

  // Number of messages visible at once (adjust based on terminal size)
  const visibleMessageCount = 10;

  // US-104: Spinner animation effect
  useEffect(() => {
    if (!streamingMessage || streamingMessage.isComplete) return;

    const interval = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 100);

    return () => clearInterval(interval);
  }, [streamingMessage]);

  // Load conversations and projects
  useEffect(() => {
    const loadData = () => {
      try {
        // Load all active conversations
        const convs = ConversationRepository.findActive();
        setConversations(convs);

        // Load all projects for display - US-105
        const allProjects = listProjects();
        const projectMap = new Map<string, Project>();
        for (const project of allProjects) {
          projectMap.set(project.id, project);
        }
        setProjects(projectMap);
        setProjectList(allProjects);

        // Load messages for selected conversation
        if (convs.length > 0 && selectedConvIndex < convs.length) {
          const msgs = ConversationRepository.getMessages(convs[selectedConvIndex].id);
          setMessages(msgs);

          // Auto-scroll to bottom on new messages
          if (autoScroll && msgs.length > visibleMessageCount) {
            setScrollOffset(msgs.length - visibleMessageCount);
          }

          // US-105: Auto-select project from conversation if not manually set
          const currentConv = convs[selectedConvIndex];
          if (currentConv && currentConv.projectId && selectedProjectId === null) {
            setSelectedProjectId(currentConv.projectId);
            // Update selector index
            const projIndex = allProjects.findIndex((p) => p.id === currentConv.projectId);
            if (projIndex >= 0) {
              setProjectSelectorIndex(projIndex + 1); // +1 because 0 is "No project"
            }
          }
        } else {
          setMessages([]);
        }

        setLoading(false);
      } catch (error) {
        console.error('Failed to load chat data:', error);
        setLoading(false);
      }
    };

    // Load immediately
    loadData();

    // Refresh every 2 seconds
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, [selectedConvIndex, autoScroll, selectedProjectId]);

  /**
   * Build system prompt for Claude with project context
   * US-104: Used for streaming responses
   */
  const buildSystemPrompt = useCallback((projectContext: ProjectContext | null): string => {
    let prompt = `You are MetaRalph, an intelligent assistant helping developers improve their software projects.

Your role is to:
1. Help the user understand their codebase
2. Suggest improvements and optimizations
3. Help create PRDs (Product Requirements Documents) for new features
4. Answer questions about the project architecture and best practices
5. Help identify and prioritize technical debt

Be concise but thorough. Focus on practical, actionable advice.

`;

    if (projectContext) {
      prompt += `You are currently discussing the project: ${projectContext.name}\nProject path: ${projectContext.path}\n\n`;

      if (projectContext.readme) {
        prompt += `## Project README\n\n${projectContext.readme.slice(0, 3000)}\n\n`;
      }

      if (projectContext.structure) {
        prompt += `## Project Structure\n\n\`\`\`\n${projectContext.structure}\n\`\`\`\n\n`;
      }
    }

    return prompt;
  }, []);

  /**
   * Handle message submission with Claude streaming
   * US-104: Implements streaming responses from Claude
   * US-105: Uses selected project context from project selector
   */
  const handleSubmitMessage = useCallback(
    async (message: string) => {
      if (!message.trim() || isProcessing) return;

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        // eslint-disable-next-line no-console
        console.error('ANTHROPIC_API_KEY environment variable is required');
        return;
      }

      setIsProcessing(true);
      setStreamingMessage({ content: '', isComplete: false });
      setAutoScroll(true);

      // Get current conversation context
      const currentConversation =
        conversations.length > 0 ? conversations[selectedConvIndex] : null;

      // US-105: Get project context from the selected project (not conversation)
      let projectContext: ProjectContext | null = null;
      if (selectedProjectId) {
        const project = getProject(selectedProjectId);
        if (project) {
          projectContext = DiscussionEngine.getProjectContext(project);
        }
      }

      try {
        // Add user message to conversation first
        if (currentConversation) {
          ConversationRepository.addMessage({
            conversationId: currentConversation.id,
            role: 'user',
            content: message,
          });
        }

        // Create Anthropic client and stream
        const client = new Anthropic({ apiKey });
        const abortController = new AbortController();
        streamAbortRef.current = abortController;

        // Build message history for context
        const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string }> =
          messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .slice(-10) // Keep last 10 messages for context
            .map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            }));

        // Add current message
        anthropicMessages.push({ role: 'user', content: message });

        // Start streaming
        const stream = client.messages.stream({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: buildSystemPrompt(projectContext),
          messages: anthropicMessages,
        });

        let fullContent = '';

        // Handle text delta events
        stream.on('text', (textDelta: string) => {
          fullContent += textDelta;
          setStreamingMessage({ content: fullContent, isComplete: false });

          // Auto-scroll to follow new content - US-104
          if (autoScroll) {
            setScrollOffset(Math.max(0, messages.length - visibleMessageCount + 1));
          }
        });

        // Wait for stream to complete
        const finalMessage = await stream.finalMessage();

        // Extract full response text
        const textContent = finalMessage.content.find((c) => c.type === 'text');
        const responseText = textContent && textContent.type === 'text' ? textContent.text : fullContent;

        // Save assistant message to database
        if (currentConversation) {
          ConversationRepository.addMessage({
            conversationId: currentConversation.id,
            role: 'assistant',
            content: responseText,
          });
        }

        // Complete streaming
        setStreamingMessage({ content: responseText, isComplete: true });

        // Refresh messages from database to show new messages
        if (currentConversation) {
          const updatedMessages = ConversationRepository.getMessages(currentConversation.id);
          setMessages(updatedMessages);
          if (autoScroll) {
            setScrollOffset(Math.max(0, updatedMessages.length - visibleMessageCount));
          }
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Stream error:', error);
        setStreamingMessage(null);
      } finally {
        setIsProcessing(false);
        setStreamingMessage(null);
        streamAbortRef.current = null;
      }
    },
    [
      isProcessing,
      conversations,
      selectedConvIndex,
      selectedProjectId,
      messages,
      autoScroll,
      visibleMessageCount,
      buildSystemPrompt,
    ]
  );

  // US-105: Handle project selection
  const handleProjectSelect = useCallback((projectId: string | null) => {
    setSelectedProjectId(projectId);
    setProjectSelectorOpen(false);
    // Update index for next open
    if (projectId === null) {
      setProjectSelectorIndex(0);
    } else {
      const idx = projectList.findIndex((p) => p.id === projectId);
      setProjectSelectorIndex(idx >= 0 ? idx + 1 : 0);
    }
  }, [projectList]);

  // Handle keyboard input for navigation and scrolling
  useInput((input, key) => {
    // US-105: Project selector keyboard handling when open
    if (projectSelectorOpen) {
      const totalItems = projectList.length + 1; // +1 for "No project"

      if (key.upArrow) {
        setProjectSelectorIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setProjectSelectorIndex((prev) => Math.min(totalItems - 1, prev + 1));
        return;
      }
      if (key.return) {
        // Select the project at current index
        if (projectSelectorIndex === 0) {
          handleProjectSelect(null);
        } else {
          const selectedProject = projectList[projectSelectorIndex - 1];
          if (selectedProject) {
            handleProjectSelect(selectedProject.id);
          }
        }
        return;
      }
      if (key.escape) {
        setProjectSelectorOpen(false);
        return;
      }
      return; // Block other keys when selector is open
    }

    // US-105: Open project selector with 'p'
    if (input === 'p' && !isProcessing) {
      setProjectSelectorOpen(true);
      return;
    }

    // Conversation selection (when in conversation list)
    if (key.leftArrow || key.rightArrow) {
      // Reserved for future: switch between conv list and message pane
      return;
    }

    // Scroll messages with up/down arrows
    if (key.upArrow) {
      setAutoScroll(false);
      setScrollOffset((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      const maxOffset = Math.max(0, messages.length - visibleMessageCount);
      setScrollOffset((prev) => {
        const newOffset = Math.min(maxOffset, prev + 1);
        // Re-enable auto-scroll if at bottom
        if (newOffset >= maxOffset) {
          setAutoScroll(true);
        }
        return newOffset;
      });
      return;
    }

    // Page up/down for faster scrolling
    if (key.pageUp) {
      setAutoScroll(false);
      setScrollOffset((prev) => Math.max(0, prev - visibleMessageCount));
      return;
    }

    if (key.pageDown) {
      const maxOffset = Math.max(0, messages.length - visibleMessageCount);
      setScrollOffset((prev) => {
        const newOffset = Math.min(maxOffset, prev + visibleMessageCount);
        if (newOffset >= maxOffset) {
          setAutoScroll(true);
        }
        return newOffset;
      });
      return;
    }

    // G (shift+g) jumps to latest messages
    if (input === 'G') {
      setAutoScroll(true);
      setScrollOffset(Math.max(0, messages.length - visibleMessageCount));
      return;
    }

    // g jumps to oldest messages
    if (input === 'g') {
      setAutoScroll(false);
      setScrollOffset(0);
      return;
    }

    // Switch conversations with [ and ]
    if (input === '[' && conversations.length > 0) {
      setSelectedConvIndex((prev) => Math.max(0, prev - 1));
      setScrollOffset(0);
      setAutoScroll(true);
      return;
    }

    if (input === ']' && conversations.length > 0) {
      setSelectedConvIndex((prev) => Math.min(conversations.length - 1, prev + 1));
      setScrollOffset(0);
      setAutoScroll(true);
      return;
    }
  });

  // Show loading state
  if (loading) {
    return (
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        <Box borderStyle="single" borderColor="blue" paddingX={1} marginBottom={1}>
          <Text bold color="blue">
            Chat
          </Text>
        </Box>
        <LoadingState />
      </Box>
    );
  }

  // Show empty state if no conversations
  if (conversations.length === 0) {
    return (
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        <Box borderStyle="single" borderColor="blue" paddingX={1} marginBottom={1}>
          <Text bold color="blue">
            Chat
          </Text>
        </Box>
        {/* US-105: Project selector available even with no conversations */}
        <ProjectSelector
          projects={projectList}
          selectedProjectId={selectedProjectId}
          onSelect={handleProjectSelect}
          isOpen={projectSelectorOpen}
          onToggle={() => setProjectSelectorOpen((prev) => !prev)}
          selectedIndex={projectSelectorIndex}
        />
        <EmptyState />
        {/* Chat input available even with no history - US-103 */}
        <ChatInput onSubmit={handleSubmitMessage} disabled={isProcessing} />
      </Box>
    );
  }

  // Main chat view with conversation list and messages
  return (
    <Box flexGrow={1} flexDirection="column" paddingX={1}>
      <Box borderStyle="single" borderColor="blue" paddingX={1} marginBottom={1}>
        <Text bold color="blue">
          Chat
        </Text>
        {conversations.length > 0 && (
          <Text dimColor>
            {' '}
            · {conversations[selectedConvIndex]?.title || 'Unknown'}
          </Text>
        )}
        <Text dimColor>
          {' '}
          ({messages.length} message{messages.length !== 1 ? 's' : ''})
        </Text>
        {/* US-105: Selected project indicator in header */}
        {selectedProjectId && (
          <Text color="green">
            {' '}
            [{projectList.find((p) => p.id === selectedProjectId)?.name || 'Unknown'}]
          </Text>
        )}
        {/* US-104: Streaming status indicator */}
        {streamingMessage && !streamingMessage.isComplete && (
          <Text color="cyan">
            {' '}
            {SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]} Streaming...
          </Text>
        )}
        {!autoScroll && !streamingMessage && (
          <Text color="yellow"> (auto-scroll paused)</Text>
        )}
      </Box>

      {/* US-105: Project context selector */}
      <ProjectSelector
        projects={projectList}
        selectedProjectId={selectedProjectId}
        onSelect={handleProjectSelect}
        isOpen={projectSelectorOpen}
        onToggle={() => setProjectSelectorOpen((prev) => !prev)}
        selectedIndex={projectSelectorIndex}
      />

      <Box flexGrow={1} flexDirection="row">
        {/* Conversation list sidebar */}
        {conversations.length > 1 && (
          <ConversationList
            conversations={conversations}
            selectedIndex={selectedConvIndex}
            projects={projects}
          />
        )}

        {/* Message display area */}
        <Box flexDirection="column" flexGrow={1}>
          {messages.length === 0 ? (
            <Box
              flexGrow={1}
              alignItems="center"
              justifyContent="center"
              paddingX={1}
            >
              <Text dimColor>No messages in this conversation yet.</Text>
            </Box>
          ) : (
            <MessageList
              messages={messages}
              scrollOffset={scrollOffset}
              visibleCount={visibleMessageCount}
              streamingMessage={streamingMessage}
              spinnerFrame={spinnerFrame}
            />
          )}
        </Box>
      </Box>

      {/* Chat input at bottom - US-103 */}
      <ChatInput onSubmit={handleSubmitMessage} disabled={isProcessing} />

      {/* Navigation hints */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
        <Text dimColor>
          <Text bold>↑↓</Text> Scroll
          {conversations.length > 1 && (
            <>
              {' '}
              | <Text bold>[]</Text> Switch conversation
            </>
          )}
          {' '}| <Text bold>g/G</Text> Start/End
          {' '}| <Text bold>p</Text> Project
        </Text>
      </Box>
    </Box>
  );
}
