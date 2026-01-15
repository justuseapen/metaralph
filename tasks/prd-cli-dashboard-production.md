# PRD: MetaRalph CLI Dashboard - Production Ready

## Introduction

Transform the MetaRalph CLI dashboard from a functional prototype into a polished, production-ready developer tool. The dashboard is the primary interface for developers to control MetaRalph - managing autonomous coding loops, monitoring workers, tracking costs, and observing project health.

The current terminal UI (React/Ink) has 8 tabs covering core functionality, but lacks real-time feedback, an embedded Claude Code interface, and the polish expected of a public release. This PRD addresses feature additions, UX improvements, and production hardening to make the dashboard the definitive way to interact with MetaRalph.

## Goals

- Add embedded Claude Code chat interface for direct AI interaction without leaving dashboard
- Implement comprehensive Ralph loop monitoring with start/stop/pause controls
- Improve real-time feedback with WebSocket-style updates (eliminate polling staleness)
- Enhance task management with better creation workflows and searchable history
- Polish UX for public release quality (consistent navigation, clear feedback, helpful errors)
- Add self-improvement status and controls to the dashboard
- Ensure all common workflows are completable without leaving the dashboard

## User Stories

---

### Phase 1: Embedded Claude Code Chat

#### US-001: Add Claude Chat tab to dashboard
**Description:** As a developer, I want a dedicated tab for chatting with Claude Code so I can get AI assistance without leaving the dashboard.

**Acceptance Criteria:**
- [ ] New "Chat" tab added as Tab 9 (shortcut key `9`)
- [ ] Tab shows in tab bar with other tabs
- [ ] Pressing `9` switches to Chat view
- [ ] Typecheck passes

#### US-002: Chat input interface
**Description:** As a developer, I want to type prompts to Claude so I can ask questions and request code changes.

**Acceptance Criteria:**
- [ ] Multi-line text input at bottom of Chat view
- [ ] `Ctrl+Enter` or `Cmd+Enter` submits the prompt
- [ ] `Escape` clears current input
- [ ] Input supports standard text editing (backspace, arrow keys, etc.)
- [ ] Character count shown (Claude has context limits)
- [ ] Typecheck passes

#### US-003: Stream Claude responses
**Description:** As a developer, I want to see Claude's response stream in real-time so I know it's working and can read as it generates.

**Acceptance Criteria:**
- [ ] Responses stream token-by-token into the chat view
- [ ] Spinner/indicator shows while Claude is generating
- [ ] Markdown formatting rendered (bold, code blocks, lists)
- [ ] Code blocks syntax highlighted where possible
- [ ] Auto-scroll follows new content (can be paused by scrolling up)
- [ ] Typecheck passes

#### US-004: Chat history persistence
**Description:** As a developer, I want my chat history saved so I can reference previous conversations.

**Acceptance Criteria:**
- [ ] Chat messages stored in SQLite database
- [ ] History loads when entering Chat tab
- [ ] Scroll up to see previous messages
- [ ] `Ctrl+L` clears current conversation (starts fresh)
- [ ] Old conversations accessible (last 10 conversations)
- [ ] Typecheck passes

#### US-005: Project context injection
**Description:** As a developer, I want Claude to have context about my selected project so responses are relevant.

**Acceptance Criteria:**
- [ ] Dropdown or selector to choose active project context
- [ ] Selected project's README, structure, and recent changes sent as context
- [ ] Context indicator shows which project is active
- [ ] "No project" option for general questions
- [ ] Typecheck passes

#### US-006: Execute Claude suggestions
**Description:** As a developer, I want to execute code suggestions from Claude directly so I don't have to copy-paste.

**Acceptance Criteria:**
- [ ] Code blocks in responses have "Execute" action (press `e` when focused)
- [ ] Confirmation prompt before executing commands
- [ ] Execution output shown inline below the code block
- [ ] Shell commands run in project directory
- [ ] Typecheck passes

---

### Phase 2: Ralph Loop Control Center

#### US-007: Add Ralph Loops tab
**Description:** As a developer, I want a dedicated tab to manage Ralph autonomous loops so I can monitor and control them in one place.

**Acceptance Criteria:**
- [ ] New "Loops" tab added (Tab 0 or reorganize tabs)
- [ ] Shows list of active and recent Ralph loops
- [ ] Each loop shows: project name, branch, status, progress, duration
- [ ] Typecheck passes

#### US-008: Start new Ralph loop
**Description:** As a developer, I want to start a Ralph loop from the dashboard so I don't need to use CLI commands.

**Acceptance Criteria:**
- [ ] `n` key opens "New Loop" dialog
- [ ] Select project from dropdown
- [ ] Select or create PRD file
- [ ] Set max iterations (default 10)
- [ ] Optional: select branch name
- [ ] `Enter` starts the loop, `Escape` cancels
- [ ] Typecheck passes

#### US-009: View loop progress
**Description:** As a developer, I want to see real-time progress of running loops so I know what Ralph is doing.

**Acceptance Criteria:**
- [ ] Progress bar showing completed/total stories
- [ ] Current story title and status displayed
- [ ] Iteration count (e.g., "Iteration 3/10")
- [ ] Live output stream from current iteration
- [ ] Updates without manual refresh (sub-second latency)
- [ ] Typecheck passes

#### US-010: Pause and resume loops
**Description:** As a developer, I want to pause a running loop so I can review changes before continuing.

**Acceptance Criteria:**
- [ ] `p` key pauses selected running loop
- [ ] Paused loops show "Paused" status with pause reason
- [ ] `r` key resumes paused loop
- [ ] Pause takes effect after current iteration completes
- [ ] Typecheck passes

#### US-011: Stop/cancel loops
**Description:** As a developer, I want to stop a loop so I can abort if something goes wrong.

**Acceptance Criteria:**
- [ ] `s` key stops selected loop (with confirmation)
- [ ] Stop can be immediate or "finish current iteration"
- [ ] Stopped loops show "Stopped" status
- [ ] Reason for stop recorded (manual, error, max iterations)
- [ ] Typecheck passes

#### US-012: Loop iteration history
**Description:** As a developer, I want to see the history of iterations so I can review what Ralph did.

**Acceptance Criteria:**
- [ ] Detail view (`Enter` on loop) shows iteration list
- [ ] Each iteration shows: story attempted, status, duration, commit SHA
- [ ] Expand iteration to see full output/logs
- [ ] Failed iterations highlighted in red
- [ ] Link to view diff of changes made
- [ ] Typecheck passes

#### US-013: Loop git integration
**Description:** As a developer, I want to see git changes from loops so I can review Ralph's commits.

**Acceptance Criteria:**
- [ ] Branch name displayed for each loop
- [ ] Commit count and latest commit message shown
- [ ] `d` key shows diff of uncommitted changes
- [ ] `g` key opens git log for loop's branch
- [ ] Typecheck passes

---

### Phase 3: Task Management & Observability

#### US-014: Unified task search
**Description:** As a developer, I want to search across all tasks so I can find specific items quickly.

**Acceptance Criteria:**
- [ ] `/` key opens search input in Queue view
- [ ] Search filters by title, project, type, or description
- [ ] Results update as you type (debounced)
- [ ] `Escape` clears search and shows all
- [ ] Search term highlighted in results
- [ ] Typecheck passes

#### US-015: Task filtering controls
**Description:** As a developer, I want to filter tasks by status, project, and type so I can focus on relevant items.

**Acceptance Criteria:**
- [ ] Filter bar at top of Queue view
- [ ] Status filter: All | Pending | Running | Completed | Failed
- [ ] Project filter: dropdown of registered projects
- [ ] Type filter: Feature | Bug | Test | Docs | Refactor
- [ ] Filters persist during session
- [ ] Filter count shown (e.g., "Showing 12 of 45")
- [ ] Typecheck passes

#### US-016: Enhanced task detail view
**Description:** As a developer, I want a comprehensive task detail view so I can see everything about a task.

**Acceptance Criteria:**
- [ ] `Enter` on task opens full-screen detail view
- [ ] Shows: title, description, acceptance criteria, status, timestamps
- [ ] Shows: assigned project, estimated effort, priority
- [ ] Shows: execution history (all attempts)
- [ ] Shows: related commits and branches
- [ ] `Escape` returns to list view
- [ ] Typecheck passes

#### US-017: Quick task creation
**Description:** As a developer, I want to create tasks quickly without filling out every field.

**Acceptance Criteria:**
- [ ] `c` key in Queue view opens quick create
- [ ] Only title required (other fields have smart defaults)
- [ ] Project auto-selected if only one registered
- [ ] Type inferred from title keywords (e.g., "fix" → bug_fix)
- [ ] `Tab` cycles through optional fields
- [ ] `Enter` creates task, `Escape` cancels
- [ ] Typecheck passes

#### US-018: Task templates
**Description:** As a developer, I want to use templates for common task types so I don't repeat myself.

**Acceptance Criteria:**
- [ ] `t` key in task create shows template picker
- [ ] Built-in templates: Bug Fix, Feature, Test Coverage, Refactor, Documentation
- [ ] Templates pre-fill description and acceptance criteria
- [ ] Custom templates can be saved from existing tasks
- [ ] Typecheck passes

#### US-019: Bulk task operations
**Description:** As a developer, I want to perform actions on multiple tasks so I can manage efficiently.

**Acceptance Criteria:**
- [ ] `Space` toggles task selection
- [ ] `Ctrl+A` selects all visible tasks
- [ ] Selected count shown in status bar
- [ ] Bulk actions: Delete, Change Status, Change Priority, Assign Project
- [ ] Confirmation required for destructive bulk actions
- [ ] Typecheck passes

#### US-020: Worker log search
**Description:** As a developer, I want to search worker logs so I can find specific output.

**Acceptance Criteria:**
- [ ] `/` key in Worker detail view opens log search
- [ ] Highlights matching lines
- [ ] `n` jumps to next match, `N` to previous
- [ ] Search supports regex (toggle with `Ctrl+R`)
- [ ] Typecheck passes

#### US-021: Worker output filtering
**Description:** As a developer, I want to filter worker output by log level so I can focus on errors.

**Acceptance Criteria:**
- [ ] Filter options: All | Errors | Warnings | Info
- [ ] Error lines highlighted in red
- [ ] Warning lines highlighted in yellow
- [ ] Line count by level shown
- [ ] Typecheck passes

---

### Phase 4: Real-time Updates & Polish

#### US-022: WebSocket-style live updates
**Description:** As a developer, I want the dashboard to update instantly when things change so I don't see stale data.

**Acceptance Criteria:**
- [ ] File-based event system for cross-process communication
- [ ] Dashboard subscribes to change events
- [ ] Updates propagate within 100ms of change
- [ ] No polling intervals (event-driven)
- [ ] Visual indicator when update received (subtle flash)
- [ ] Typecheck passes

#### US-023: Notification system
**Description:** As a developer, I want to be notified of important events so I don't miss critical updates.

**Acceptance Criteria:**
- [ ] Notification area in header (bell icon with count)
- [ ] Notifications for: task completed, task failed, loop finished, approval needed
- [ ] `!` key opens notification list
- [ ] Notifications marked as read when viewed
- [ ] Critical notifications highlighted
- [ ] macOS system notifications for background events (optional)
- [ ] Typecheck passes

#### US-024: Keyboard shortcut help
**Description:** As a developer, I want to see available keyboard shortcuts so I can use the dashboard efficiently.

**Acceptance Criteria:**
- [ ] `?` key opens shortcut help overlay
- [ ] Shortcuts grouped by context (global, queue, workers, etc.)
- [ ] Current tab's shortcuts highlighted
- [ ] `Escape` or `?` closes overlay
- [ ] Typecheck passes

#### US-025: Consistent navigation patterns
**Description:** As a developer, I want navigation to work the same way everywhere so I don't get confused.

**Acceptance Criteria:**
- [ ] Arrow keys always navigate lists
- [ ] `Enter` always opens detail view
- [ ] `Escape` always goes back/closes
- [ ] `Tab` cycles through sections within a view
- [ ] Number keys always switch main tabs
- [ ] Consistent color coding across all views
- [ ] Typecheck passes

#### US-026: Error handling and recovery
**Description:** As a developer, I want clear error messages and recovery options so I can fix problems.

**Acceptance Criteria:**
- [ ] Database errors show helpful message (not stack trace)
- [ ] Network errors show retry option
- [ ] Invalid input shows what's wrong and how to fix
- [ ] Crash recovery: dashboard can restart and resume state
- [ ] Error log accessible from Debug tab
- [ ] Typecheck passes

#### US-027: Loading states
**Description:** As a developer, I want to see loading indicators so I know when data is being fetched.

**Acceptance Criteria:**
- [ ] Spinner shown during initial data load
- [ ] Skeleton placeholders for list items while loading
- [ ] "Refreshing..." indicator for background updates
- [ ] Loading never blocks keyboard input
- [ ] Typecheck passes

#### US-028: Empty states
**Description:** As a developer, I want helpful messages when there's no data so I know what to do.

**Acceptance Criteria:**
- [ ] Each view has a meaningful empty state
- [ ] Empty states explain how to add first item
- [ ] Quick action buttons in empty states (e.g., "Add Project")
- [ ] Typecheck passes

---

### Phase 5: Self-Improvement Integration

#### US-029: Self-improvement status in Health tab
**Description:** As a developer, I want to see self-improvement status so I know what MetaRalph is doing to improve itself.

**Acceptance Criteria:**
- [ ] New section in Health tab: "Self-Improvement Status"
- [ ] Shows: last analysis time, proposals generated, proposals executed
- [ ] Shows: current queue size, pending approvals
- [ ] Shows: recent execution results (success/failure)
- [ ] Typecheck passes

#### US-030: Self-improvement proposal queue
**Description:** As a developer, I want to see and manage self-improvement proposals so I can control what MetaRalph changes.

**Acceptance Criteria:**
- [ ] List of pending proposals with risk scores
- [ ] Each proposal shows: title, type, risk score, affected files
- [ ] Color coding: green (auto-approvable), yellow (needs review), red (high risk)
- [ ] Detail view shows full proposal with rationale
- [ ] Typecheck passes

#### US-031: Approve/reject self-improvement proposals
**Description:** As a developer, I want to approve or reject proposals so I control what changes are made.

**Acceptance Criteria:**
- [ ] `a` key approves selected proposal
- [ ] `r` key rejects selected proposal (with reason prompt)
- [ ] Bulk approve for low-risk proposals
- [ ] Approved proposals queue for execution
- [ ] Typecheck passes

#### US-032: Self-improvement execution controls
**Description:** As a developer, I want to trigger and monitor self-improvement execution so I can see it working.

**Acceptance Criteria:**
- [ ] `x` key executes next approved proposal
- [ ] Progress shown during execution
- [ ] Output streamed to detail view
- [ ] Success/failure clearly indicated
- [ ] Rollback option if execution fails
- [ ] Typecheck passes

#### US-033: Self-improvement history
**Description:** As a developer, I want to see history of self-improvements so I can track what changed.

**Acceptance Criteria:**
- [ ] List of past executions with status
- [ ] Each shows: proposal title, execution time, result, commit SHA
- [ ] Failed executions show error reason
- [ ] Rollback status shown if applicable
- [ ] Typecheck passes

---

### Phase 6: Tab Reorganization

#### US-034: Reorganize tabs for better workflow
**Description:** As a developer, I want tabs organized by frequency of use so the most important things are easily accessible.

**Acceptance Criteria:**
- [ ] New tab order: 1-Chat, 2-Loops, 3-Queue, 4-Workers, 5-Projects, 6-Health, 7-Costs, 8-Approvals, 9-Debug
- [ ] Most-used tabs (Chat, Loops, Queue) get low numbers
- [ ] Less-used tabs (Debug) get high numbers
- [ ] Consistent with keyboard number shortcuts
- [ ] Typecheck passes

#### US-035: Tab badges for attention
**Description:** As a developer, I want to see badges on tabs so I know when something needs attention.

**Acceptance Criteria:**
- [ ] Queue tab shows count of pending tasks
- [ ] Approvals tab shows count of pending approvals
- [ ] Workers tab shows count of running workers
- [ ] Health tab shows count of critical alerts
- [ ] Loops tab shows count of active loops
- [ ] Badges update in real-time
- [ ] Typecheck passes

---

## Functional Requirements

### Chat System
- FR-1: Chat tab spawns Claude Code subprocess and streams output
- FR-2: Chat messages persisted to SQLite with conversation threading
- FR-3: Project context (README, structure, recent commits) sent with prompts
- FR-4: Code blocks in responses are executable with confirmation

### Loop Management
- FR-5: Ralph loops trackable as first-class entities in database
- FR-6: Loop state machine: pending → running → paused → completed/failed/stopped
- FR-7: Loop output captured and stored for each iteration
- FR-8: Loops can be started, paused, resumed, and stopped from dashboard

### Task Management
- FR-9: Tasks searchable by title, description, project, and type
- FR-10: Tasks filterable by status, project, type with AND logic
- FR-11: Bulk operations supported with multi-select
- FR-12: Task templates stored and retrievable

### Real-time Updates
- FR-13: Event-based update system replaces polling where possible
- FR-14: Updates propagate within 100ms of underlying change
- FR-15: Notifications queued and displayed for important events

### Self-Improvement
- FR-16: Self-improvement proposals viewable and manageable from Health tab
- FR-17: Proposal approval/rejection workflow integrated
- FR-18: Execution triggerable and monitorable from dashboard

### UX Polish
- FR-19: All views have loading, empty, and error states
- FR-20: Keyboard shortcuts consistent across all views
- FR-21: Help overlay accessible from any screen

---

## Non-Goals

- **Not a web app**: This PRD is for the CLI/terminal dashboard only
- **No multi-user support**: Single-user, local installation assumed
- **No mobile/touch support**: Keyboard-only interface
- **No themes/customization**: Single consistent visual style
- **No plugin system**: Features built-in, not extensible
- **No i18n/localization**: English only for initial release

---

## Technical Considerations

### Architecture
- Continue using React/Ink for terminal UI
- SQLite for all persistent state
- File-based IPC for cross-process events (daemon ↔ dashboard)
- Claude Code spawned as subprocess with PTY for chat

### Performance
- Virtualized lists for large datasets (>100 items)
- Debounced search inputs (150ms)
- Lazy-load detail views on demand
- Event-driven updates to eliminate polling overhead

### Dependencies
- Existing: React 18, Ink 5, better-sqlite3, @anthropic-ai/sdk
- May need: node-pty (for terminal emulation), chokidar (file watching)

### Database Changes
- New tables: chat_messages, loops, loop_iterations, notifications
- New columns: tasks.template_id, executions.loop_id

---

## Success Metrics

- Developer can complete full workflow (create task → run loop → review changes) without leaving dashboard
- Chat responses stream with <500ms time-to-first-token
- Dashboard updates reflect backend changes within 100ms
- Zero "stale data" complaints from users
- All keyboard shortcuts discoverable via `?` help
- Error states provide actionable recovery steps

---

## Open Questions

1. Should Chat support multiple concurrent conversations or one at a time?
2. Should loops have configurable auto-pause conditions (e.g., pause after 3 failures)?
3. How should we handle very long worker logs (>10k lines)?
4. Should notifications support sound/bell for terminal alerts?
5. Should we add vim-style keybindings as an option?

---

## Story Dependency Order

```
Phase 1 (Chat): US-001 → US-002 → US-003 → US-004 → US-005 → US-006
Phase 2 (Loops): US-007 → US-008 → US-009 → US-010 → US-011 → US-012 → US-013
Phase 3 (Tasks): US-014 → US-015 → US-016 → US-017 → US-018 → US-019 → US-020 → US-021
Phase 4 (Polish): US-022 → US-023 → US-024 → US-025 → US-026 → US-027 → US-028
Phase 5 (Self-Improve): US-029 → US-030 → US-031 → US-032 → US-033
Phase 6 (Reorg): US-034 → US-035

Recommended implementation order: Phase 1 → Phase 2 → Phase 6 → Phase 3 → Phase 4 → Phase 5
```
