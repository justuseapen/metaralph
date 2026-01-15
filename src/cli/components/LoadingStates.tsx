/**
 * LoadingStates - Shared loading state components for consistent UX
 *
 * Provides:
 * - LoadingSpinner: Animated spinner for initial data loading
 * - RefreshingIndicator: Subtle indicator for background data refreshes
 * - useLoadingState: Hook for managing loading + refreshing states
 * - ErrorBoundary: Error boundary wrapper for graceful error handling
 * - ErrorDisplay: User-friendly error display with retry option
 *
 * US-128: Add loading states to all views
 * US-130: Add error handling wrapper
 */

import React, { useState, useEffect, Component, type ReactNode, type ErrorInfo } from 'react';
import { Box, Text, useInput } from 'ink';

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

/**
 * Empty state component for views with no data
 * Shows a message and optional keyboard shortcut hint
 * US-129: Add empty states to all views
 */
export function EmptyState({
  message,
  shortcutKey,
  shortcutAction,
}: {
  message: string;
  shortcutKey?: string;
  shortcutAction?: string;
}): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text dimColor>{message}</Text>
      {shortcutKey && shortcutAction && (
        <Box marginTop={1}>
          <Text dimColor>Press </Text>
          <Text color="yellow" bold>{shortcutKey}</Text>
          <Text dimColor> to {shortcutAction}.</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Convert error to user-friendly message
 * Detects common error types and provides helpful messages
 */
function getUserFriendlyMessage(error: Error): string {
  const message = error.message.toLowerCase();

  // Database errors
  if (message.includes('sqlite') || message.includes('database') || message.includes('sql')) {
    return 'Database error. The database may be locked or corrupted.';
  }

  // Network errors
  if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
    return 'Network error. Please check your connection.';
  }

  // File system errors
  if (message.includes('enoent') || message.includes('file not found') || message.includes('no such file')) {
    return 'File not found. The requested file may have been moved or deleted.';
  }

  if (message.includes('eacces') || message.includes('permission denied')) {
    return 'Permission denied. You may not have access to this resource.';
  }

  // JSON errors
  if (message.includes('json') || message.includes('unexpected token') || message.includes('parse')) {
    return 'Data format error. The data could not be read properly.';
  }

  // Generic fallback
  return 'An unexpected error occurred.';
}

/**
 * Props for ErrorDisplay component
 */
interface ErrorDisplayProps {
  error: Error;
  viewName: string;
  onRetry?: () => void;
}

/**
 * User-friendly error display component
 * Shows error message with retry option and details toggle
 */
export function ErrorDisplay({
  error,
  viewName,
  onRetry,
}: ErrorDisplayProps): React.ReactElement {
  const [showDetails, setShowDetails] = useState(false);

  useInput((input, key) => {
    // 'd' key toggles error details
    if (input === 'd') {
      setShowDetails(!showDetails);
      return;
    }

    // 'r' key retries if handler provided
    if (input === 'r' && onRetry) {
      onRetry();
      return;
    }

    // Escape hides details
    if (key.escape && showDetails) {
      setShowDetails(false);
      return;
    }
  });

  const friendlyMessage = getUserFriendlyMessage(error);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="blue">{viewName}</Text>
      </Box>

      {/* Error message box */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="red"
        paddingX={1}
        paddingY={0}
      >
        {/* Error icon and message */}
        <Box marginBottom={0}>
          <Text color="red" bold>✗ Error</Text>
        </Box>
        <Box marginBottom={0}>
          <Text>{friendlyMessage}</Text>
        </Box>

        {/* Action hints */}
        <Box marginTop={1}>
          {onRetry && (
            <>
              <Text dimColor>Press </Text>
              <Text color="yellow" bold>r</Text>
              <Text dimColor> to retry</Text>
              <Text dimColor>  |  </Text>
            </>
          )}
          <Text dimColor>Press </Text>
          <Text color="yellow" bold>d</Text>
          <Text dimColor> to {showDetails ? 'hide' : 'show'} details</Text>
        </Box>
      </Box>

      {/* Error details (collapsed by default) */}
      {showDetails && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          paddingY={0}
          marginTop={1}
        >
          <Box marginBottom={0}>
            <Text bold dimColor>Error Details</Text>
            <Text dimColor> — Escape to hide</Text>
          </Box>
          <Box marginBottom={0}>
            <Text bold>Type: </Text>
            <Text>{error.name}</Text>
          </Box>
          <Box marginBottom={0}>
            <Text bold>Message: </Text>
            <Text color="red">{error.message}</Text>
          </Box>
          {error.stack && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold dimColor>Stack trace:</Text>
              {error.stack.split('\n').slice(1, 6).map((line, idx) => (
                <Text key={idx} dimColor wrap="truncate">
                  {line.trim()}
                </Text>
              ))}
              {error.stack.split('\n').length > 6 && (
                <Text dimColor>... and {error.stack.split('\n').length - 6} more lines</Text>
              )}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * Props for ErrorBoundary class component
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  viewName: string;
  onRetry?: () => void;
  fallback?: ReactNode;
}

/**
 * State for ErrorBoundary
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary - Class component that catches JavaScript errors in child components
 * Displays ErrorDisplay with user-friendly message and retry option
 *
 * Usage:
 * <ErrorBoundary viewName="Queue View" onRetry={handleRetry}>
 *   <QueueViewContent />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error for debugging (could be enhanced with proper logging service)
    console.error(`[${this.props.viewName}] Error caught:`, error);
    console.error('Component stack:', errorInfo.componentStack);
  }

  handleRetry = (): void => {
    // Reset error state
    this.setState({ hasError: false, error: null });

    // Call retry handler if provided
    if (this.props.onRetry) {
      this.props.onRetry();
    }
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      // Custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error display
      return (
        <ErrorDisplay
          error={this.state.error}
          viewName={this.props.viewName}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

/**
 * Hook for wrapping async operations with error handling
 * Returns error state that can be used to show ErrorDisplay
 */
export function useErrorHandler(): {
  error: Error | null;
  setError: (error: Error | null) => void;
  clearError: () => void;
  handleError: (fn: () => void | Promise<void>) => Promise<void>;
} {
  const [error, setError] = useState<Error | null>(null);

  const clearError = () => setError(null);

  const handleError = async (fn: () => void | Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  return { error, setError, clearError, handleError };
}

export default {
  LoadingSpinner,
  LoadingView,
  RefreshingIndicator,
  ViewHeader,
  EmptyState,
  useLoadingState,
  ErrorBoundary,
  ErrorDisplay,
  useErrorHandler,
};
