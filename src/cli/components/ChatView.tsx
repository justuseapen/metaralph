/**
 * ChatView - Provides AI chat interface in the dashboard
 *
 * Displays chat history with timestamps and allows sending prompts to Claude.
 * US-102: Message display with user/assistant styling and scroll support.
 * US-103: Multi-line chat input with Ctrl+Enter submit.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import {
  ConversationRepository,
  type Message,
  type Conversation,
} from '../../collaboration/conversation.js';
import { listProjects, type Project } from '../../registry/index.js';

// Maximum character limit for chat input
const MAX_INPUT_LENGTH = 4000;

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
 * Message list with scroll support
 */
function MessageList({
  messages,
  scrollOffset,
  visibleCount,
}: {
  messages: Message[];
  scrollOffset: number;
  visibleCount: number;
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

      {/* Scroll indicator at bottom */}
      {startIndex + visibleCount < messages.length && (
        <Box justifyContent="center" marginTop={1}>
          <Text dimColor>
            ↓ {messages.length - startIndex - visibleCount} more message(s) below
          </Text>
        </Box>
      )}

      {/* Auto-scroll hint */}
      {messages.length > 0 && (
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
 */
export function ChatView(): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvIndex, setSelectedConvIndex] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [projects, setProjects] = useState<Map<string, Project>>(new Map());
  const [autoScroll, setAutoScroll] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  // Number of messages visible at once (adjust based on terminal size)
  const visibleMessageCount = 10;

  // Load conversations and projects
  useEffect(() => {
    const loadData = () => {
      try {
        // Load all active conversations
        const convs = ConversationRepository.findActive();
        setConversations(convs);

        // Load all projects for display
        const projectList = listProjects();
        const projectMap = new Map<string, Project>();
        for (const project of projectList) {
          projectMap.set(project.id, project);
        }
        setProjects(projectMap);

        // Load messages for selected conversation
        if (convs.length > 0 && selectedConvIndex < convs.length) {
          const msgs = ConversationRepository.getMessages(convs[selectedConvIndex].id);
          setMessages(msgs);

          // Auto-scroll to bottom on new messages
          if (autoScroll && msgs.length > visibleMessageCount) {
            setScrollOffset(msgs.length - visibleMessageCount);
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
  }, [selectedConvIndex, autoScroll]);

  // Handle message submission from chat input
  // Note: This is a placeholder - actual Claude API integration will be added in US-104
  const handleSubmitMessage = (message: string) => {
    if (!message.trim() || isProcessing) return;

    // For now, just log the message - actual sending will be implemented in US-104
    // This allows testing the input component works correctly
    setIsProcessing(true);

    // Simulate processing delay (remove when actual API integration is added)
    setTimeout(() => {
      setIsProcessing(false);
      // In US-104, this will actually send the message to Claude
      // For now, auto-scroll to bottom after "sending"
      setAutoScroll(true);
      setScrollOffset(Math.max(0, messages.length - visibleMessageCount));
    }, 1500);
  };

  // Handle keyboard input for navigation and scrolling
  useInput((input, key) => {
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
      </Box>

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
        </Text>
      </Box>
    </Box>
  );
}
