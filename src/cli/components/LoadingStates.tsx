/**
 * LoadingStates - Shared loading state components for consistent UX
 *
 * Provides:
 * - LoadingSpinner: Animated spinner for initial data loading
 * - RefreshingIndicator: Subtle indicator for background data refreshes
 * - useLoadingState: Hook for managing loading + refreshing states
 *
 * US-128: Add loading states to all views
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

/**
 * Spinner animation frames - consistent across all views
 */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Loading spinner with animation
 * Shows during initial data load
 */
export function LoadingSpinner({
  message = 'Loading...',
  color = 'cyan',
}: {
  message?: string;
  color?: string;
}): React.ReactElement {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);

    return () => clearInterval(interval);
  }, []);

  return (
    <Box>
      <Text color={color}>{SPINNER_FRAMES[frameIndex]} </Text>
      <Text color={color}>{message}</Text>
    </Box>
  );
}

/**
 * Props for LoadingView component
 */
interface LoadingViewProps {
  title: string;
  message?: string;
}

/**
 * Full loading view component for initial page loads
 * Centers the spinner in a view-style container
 */
export function LoadingView({
  title,
  message = 'Loading...',
}: LoadingViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="blue">{title}</Text>
      </Box>
      <LoadingSpinner message={message} />
    </Box>
  );
}

/**
 * Refreshing indicator - subtle indicator for background updates
 * Doesn't block interaction, just shows data is being refreshed
 */
export function RefreshingIndicator({
  visible = true,
}: {
  visible?: boolean;
}): React.ReactElement | null {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!visible) return;

    const interval = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);

    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  return (
    <Text dimColor>
      {SPINNER_FRAMES[frameIndex]} Refreshing...
    </Text>
  );
}

/**
 * Hook return type for useLoadingState
 */
interface LoadingStateResult {
  isLoading: boolean;
  isRefreshing: boolean;
  startLoading: () => void;
  startRefreshing: () => void;
  finishLoading: () => void;
  finishRefreshing: () => void;
}

/**
 * Custom hook for managing loading and refreshing states
 * - isLoading: True only for initial load (blocks view content)
 * - isRefreshing: True for background refreshes (shows indicator but doesn't block)
 */
export function useLoadingState(initialLoading = true): LoadingStateResult {
  const [isLoading, setIsLoading] = useState(initialLoading);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const startLoading = () => {
    if (!hasLoaded) {
      setIsLoading(true);
    }
  };

  const startRefreshing = () => {
    if (hasLoaded) {
      setIsRefreshing(true);
    }
  };

  const finishLoading = () => {
    setIsLoading(false);
    setHasLoaded(true);
  };

  const finishRefreshing = () => {
    setIsRefreshing(false);
  };

  return {
    isLoading,
    isRefreshing,
    startLoading,
    startRefreshing,
    finishLoading,
    finishRefreshing,
  };
}

/**
 * Combined loading state component for view headers
 * Shows title with optional refreshing indicator
 */
export function ViewHeader({
  title,
  subtitle,
  isRefreshing = false,
}: {
  title: string;
  subtitle?: string;
  isRefreshing?: boolean;
}): React.ReactElement {
  return (
    <Box paddingX={1} marginBottom={1}>
      <Text bold color="blue">{title}</Text>
      {subtitle && <Text dimColor> {subtitle}</Text>}
      {isRefreshing && (
        <Box marginLeft={2}>
          <RefreshingIndicator visible={isRefreshing} />
        </Box>
      )}
    </Box>
  );
}

export default {
  LoadingSpinner,
  LoadingView,
  RefreshingIndicator,
  ViewHeader,
  useLoadingState,
};
