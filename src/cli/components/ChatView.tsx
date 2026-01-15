/**
 * ChatView - Provides AI chat interface in the dashboard
 *
 * Displays chat history and allows sending prompts to Claude.
 */

import React from 'react';
import { Box, Text } from 'ink';

/**
 * ChatView component - Placeholder for chat functionality
 * Full implementation will be added in US-102
 */
export function ChatView(): React.ReactElement {
  return (
    <Box flexGrow={1} flexDirection="column" paddingX={1}>
      <Box borderStyle="single" borderColor="blue" paddingX={1} marginBottom={1}>
        <Text bold color="blue">Chat</Text>
      </Box>
      <Box flexDirection="column">
        <Text dimColor>Chat interface coming soon...</Text>
        <Text dimColor>This tab will allow you to interact with Claude AI.</Text>
      </Box>
    </Box>
  );
}
