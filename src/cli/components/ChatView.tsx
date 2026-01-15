/**
 * ChatView - Provides AI chat interface in the dashboard
 *
 * Displays chat history with timestamps and allows sending prompts to Claude.
 * US-102: Message display with user/assistant styling and scroll support.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  ConversationRepository,
  type Message,
  type Conversation,
} from '../../collaboration/conversation.js';
import { listProjects, type Project } from '../../registry/index.js';

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
