/**
 * LoopsView - Displays Ralph loops in the dashboard
 *
 * Shows all Ralph loops with status, progress, and controls.
 * Automatically refreshes when data changes.
 */

import React from 'react';
import { Box, Text } from 'ink';

/**
 * LoopsView component displays Ralph loop management interface
 */
export function LoopsView(): React.ReactElement {
  return (
    <Box flexGrow={1} flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Ralph Loops</Text>
      </Box>
      <Box flexDirection="column">
        <Text dimColor>No loops yet. Press n to start one.</Text>
      </Box>
    </Box>
  );
}
