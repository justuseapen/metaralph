/**
 * NavigationPatterns - Standard keyboard navigation patterns for the dashboard
 *
 * US-133: Standardize navigation patterns across all views
 *
 * This module defines the consistent navigation patterns used throughout
 * the MetaRalph dashboard. All views should follow these patterns.
 *
 * STANDARD NAVIGATION PATTERNS:
 *
 * 1. LIST NAVIGATION (applies to all list views):
 *    - ↑/↓ Arrow keys: Navigate items in lists
 *    - Enter: Open detail view for selected item
 *    - Escape: Close detail view / go back to list
 *    - PgUp/PgDn: Page through long lists (where applicable)
 *    - g/G: Jump to start/end of list (in scrollable views)
 *
 * 2. DIALOG NAVIGATION (applies to all modal dialogs):
 *    - Tab/Shift+Tab: Cycle through form fields
 *    - Enter: Submit/confirm dialog
 *    - Escape: Cancel/close dialog
 *    - ↑/↓ for dropdowns/selectors within dialogs
 *    - ←/→ for cycling through options (filters, types)
 *
 * 3. TAB NAVIGATION (global, handled by dashboard.tsx):
 *    - Number keys 1-7: Switch between main tabs
 *    - Number keys always work regardless of view state
 *
 * 4. GLOBAL SHORTCUTS (work in all views):
 *    - ?: Open keyboard shortcut help overlay
 *    - !: Open notification list overlay
 *    - q: Quit dashboard
 *
 * 5. VIEW-SPECIFIC ACTION KEYS:
 *    - Action keys should be single lowercase letters
 *    - Common patterns: n=new, c=create, a=approve, r=reject/refresh/resume,
 *                       p=pause, s=stop, d=delete, /=search, f=filter
 *
 * IMPLEMENTATION NOTES:
 * - Detail views should handle Escape to close before parent useInput runs
 * - Dialogs should block parent useInput while open (early return)
 * - Search mode should block navigation keys while input is active
 * - All views use consistent 2-second refresh intervals
 */

import React, { useCallback, useState, useEffect } from 'react';
import type { Key } from 'ink';

/**
 * Standard list navigation handler
 * Returns the new selected index after handling arrow key navigation
 */
export function handleListNavigation(
  key: Key,
  currentIndex: number,
  listLength: number
): number {
  if (key.upArrow && currentIndex > 0) {
    return currentIndex - 1;
  }
  if (key.downArrow && currentIndex < listLength - 1) {
    return currentIndex + 1;
  }
  return currentIndex;
}

/**
 * Standard scroll navigation handler for output/content views
 * Returns the new scroll offset after handling scroll keys
 */
export function handleScrollNavigation(
  input: string,
  key: Key,
  currentOffset: number,
  maxOffset: number,
  pageSize: number
): number {
  if (key.upArrow && currentOffset > 0) {
    return currentOffset - 1;
  }
  if (key.downArrow && currentOffset < maxOffset) {
    return currentOffset + 1;
  }
  if (key.pageUp) {
    return Math.max(0, currentOffset - pageSize);
  }
  if (key.pageDown) {
    return Math.min(maxOffset, currentOffset + pageSize);
  }
  if (input === 'g') {
    return 0; // Jump to start
  }
  if (input === 'G') {
    return maxOffset; // Jump to end
  }
  return currentOffset;
}

/**
 * Standard filter cycling handler
 * Returns the new filter index after handling left/right arrow keys
 */
export function handleFilterCycling<T>(
  key: Key,
  currentIndex: number,
  filterCount: number
): number {
  if (key.leftArrow) {
    return (currentIndex - 1 + filterCount) % filterCount;
  }
  if (key.rightArrow) {
    return (currentIndex + 1) % filterCount;
  }
  return currentIndex;
}

/**
 * Check if a key event should trigger detail view opening
 */
export function shouldOpenDetailView(key: Key): boolean {
  return key.return === true;
}

/**
 * Check if a key event should close/go back
 */
export function shouldCloseView(key: Key): boolean {
  return key.escape === true;
}

/**
 * Hook to manage list selection state with bounds checking
 */
export function useListSelection(listLength: number, initialIndex = 0) {
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  // Keep selection in bounds when list length changes
  useEffect(() => {
    if (selectedIndex >= listLength && listLength > 0) {
      setSelectedIndex(listLength - 1);
    }
  }, [listLength, selectedIndex]);

  const handleNavigation = useCallback((key: Key) => {
    const newIndex = handleListNavigation(key, selectedIndex, listLength);
    if (newIndex !== selectedIndex) {
      setSelectedIndex(newIndex);
      return true; // Indicates key was handled
    }
    return false;
  }, [selectedIndex, listLength]);

  return {
    selectedIndex,
    setSelectedIndex,
    handleNavigation,
  };
}

/**
 * Hook to manage scroll offset state with bounds checking
 */
export function useScrollNavigation(totalLines: number, visibleLines: number) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const maxOffset = Math.max(0, totalLines - visibleLines);

  // Keep scroll offset in bounds when content length changes
  useEffect(() => {
    if (scrollOffset > maxOffset) {
      setScrollOffset(maxOffset);
    }
  }, [scrollOffset, maxOffset]);

  const handleNavigation = useCallback((input: string, key: Key) => {
    const newOffset = handleScrollNavigation(input, key, scrollOffset, maxOffset, visibleLines);
    if (newOffset !== scrollOffset) {
      setScrollOffset(newOffset);
      return true; // Indicates key was handled
    }
    return false;
  }, [scrollOffset, maxOffset, visibleLines]);

  return {
    scrollOffset,
    setScrollOffset,
    maxOffset,
    handleNavigation,
  };
}

/**
 * Standard navigation hint text components
 * Use these for consistent footer/header hints
 */
export const NavigationHints = {
  list: '↑↓: Navigate',
  detail: 'Enter: Details',
  back: 'ESC: Back',
  scroll: '↑↓: Scroll  PgUp/PgDn: Page  g/G: Start/End',
  tabs: 'Tab: Cycle',
  search: '/: Search',
  filter: 'f: Filter',
  create: 'n: New',

  // Combined hints for common scenarios
  listView: '↑↓: Navigate  Enter: Details',
  detailView: 'ESC: Back  ↑↓: Scroll',
  dialogView: 'Tab: Next  Enter: Submit  ESC: Cancel',
};

/**
 * Standard action key documentation
 * Maps common action keys to their standard meanings
 */
export const StandardActionKeys = {
  n: 'New/Create',
  c: 'Create',
  a: 'Approve',
  r: 'Reject/Refresh/Resume',
  p: 'Pause',
  s: 'Stop',
  d: 'Delete/Dismiss',
  '/': 'Search',
  f: 'Filter',
  '?': 'Help',
  '!': 'Notifications',
};

/**
 * NAVIGATION PATTERNS DOCUMENTATION
 *
 * Every view in the dashboard should follow these patterns:
 *
 * 1. MAIN LIST VIEW:
 *    - Use useListSelection hook for selection management
 *    - Arrow keys navigate the list
 *    - Enter opens detail view (set detailItem state)
 *    - Don't handle number keys - they're for tabs
 *
 * 2. DETAIL VIEW:
 *    - Check if detail is open first in useInput
 *    - Escape closes detail view (set detailItem to null)
 *    - May have nested scroll or expandable sections
 *
 * 3. SEARCH MODE:
 *    - '/' activates search
 *    - Escape clears search and exits search mode
 *    - Search input should block other key handlers
 *
 * 4. FILTER MODE:
 *    - Tab cycles through filter fields
 *    - Left/Right arrows change filter values
 *    - Escape deactivates filter field
 *
 * 5. DIALOG/OVERLAY:
 *    - Should block parent useInput when open
 *    - Tab cycles through fields
 *    - Enter submits, Escape cancels
 *
 * Example useInput pattern:
 *
 * useInput((input, key) => {
 *   // 1. Check for overlays/dialogs first (block everything)
 *   if (showDialog) return;
 *
 *   // 2. Check for detail view (handle Escape to close)
 *   if (detailItem) {
 *     if (key.escape) {
 *       setDetailItem(null);
 *       return;
 *     }
 *     // Handle detail-specific navigation
 *     return;
 *   }
 *
 *   // 3. Check for search mode (block navigation during search)
 *   if (searchActive) {
 *     if (key.escape) {
 *       clearSearch();
 *       return;
 *     }
 *     return; // Let TextInput handle the rest
 *   }
 *
 *   // 4. Handle main list navigation
 *   if (key.upArrow || key.downArrow) {
 *     handleNavigation(key);
 *     return;
 *   }
 *
 *   // 5. Handle Enter to open detail
 *   if (key.return && items.length > 0) {
 *     setDetailItem(items[selectedIndex]);
 *     return;
 *   }
 *
 *   // 6. Handle view-specific action keys
 *   if (input === 'n') {
 *     setShowDialog(true);
 *     return;
 *   }
 * });
 */
