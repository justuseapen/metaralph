# Roadmap: Autonomous Multi-Project Ralph Loop Orchestration

## Current State Assessment

### ✅ What's Built
- **Core Infrastructure**: Daemon, database, config system, project registry
- **Work Queue**: Task management, priority scoring, approval queue
- **Worker Orchestration**: Basic Ralph spawning, execution tracking, failure handling
- **CLI Dashboard**: Queue, Approvals, Projects, Workers, Chat tabs (partial)
- **Chat Integration**: Streaming Claude responses with project context

### ❌ What's Missing for Autonomous Multi-Project Loops
- **Loop Management System**: No database tables or models for tracking loops
- **Loop UI**: No Loops tab in dashboard (US-106-114 from current PRD)
- **Branch Isolation**: Tasks run on main branch, no parallel execution support
- **Multi-Project Coordination**: One worker per project limit prevents true parallelism
- **Autonomous Loop Scheduling**: No system to automatically start loops based on queue state
- **Loop Lifecycle Management**: No pause/resume/stop controls
- **Cross-Project Resource Management**: No intelligent routing of work across projects

---

## Goal: Autonomous Multi-Project Ralph Loop Orchestration

**Vision**: MetaRalph continuously runs Ralph loops across multiple projects simultaneously, autonomously deciding when to start new loops, managing resources, and coordinating work without manual intervention.

**Key Capabilities**:
1. Run multiple Ralph loops in parallel across different projects
2. Each loop runs on isolated git branches
3. Autonomous scheduling: automatically start loops when queue has work
4. Resource management: balance work across projects based on capacity
5. Full lifecycle control: start, pause, resume, stop loops
6. Real-time monitoring of all active loops
7. Cross-project learning: apply patterns from one project to others

---

## Roadmap Phases

### Phase A: Loop Foundation (Prerequisites)
**Goal**: Build the core loop management infrastructure

**User Stories**:
1. **US-L001**: Create loops database schema
   - `loops` table: id, project_id, branch_name, prd_path, status, max_iterations, current_iteration, started_at, completed_at
   - `loop_iterations` table: id, loop_id, iteration_number, story_id, status, output, commit_sha, started_at, completed_at
   - Status enum: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped'

2. **US-L002**: Create LoopRepository
   - Methods: create(), findById(), findByProject(), findRunning(), updateStatus()
   - Integration with existing database system

3. **US-L003**: Create Loop model and types
   - TypeScript interfaces matching database schema
   - Status transitions and validation

4. **US-L004**: Add Loops tab to dashboard
   - Add 'loops' to TabId type and TABS array
   - Create LoopsView component (basic list view)
   - Show: project, branch, status, progress (3/10), duration

**Dependencies**: None (builds on existing infrastructure)
**Blocks**: Everything else

---

### Phase B: Loop Execution Engine
**Goal**: Execute Ralph loops with proper lifecycle management

**User Stories**:
1. **US-L005**: Create LoopExecutor class
   - Spawns Ralph process for a loop (similar to RalphSpawner but for loops)
   - Manages loop lifecycle: start → running → pause → resume → complete
   - Tracks iteration progress by parsing Ralph output

2. **US-L006**: Implement branch-per-loop isolation
   - Create branch: `ralph/loop-<loop-id>-<timestamp>`
   - Checkout branch before starting loop
   - Merge strategy: auto (on success) | manual | PR

3. **US-L007**: Implement loop start functionality
   - Create loop record in database
   - Spawn Ralph subprocess with PRD
   - Capture output and track iterations
   - Update loop status and progress

4. **US-L008**: Implement pause/resume/stop controls
   - Pause: SIGSTOP to process, save state, mark as paused
   - Resume: SIGCONT, restore state, mark as running
   - Stop: SIGTERM, cleanup branch, mark as stopped

5. **US-L009**: Add loop progress tracking
   - Parse Ralph output to detect iteration boundaries
   - Update current_iteration in real-time
   - Store per-iteration metadata in loop_iterations table

**Dependencies**: Phase A
**Blocks**: Phase C, D

---

### Phase C: Loop UI and Monitoring
**Goal**: Complete dashboard UI for loop management

**User Stories**:
1. **US-L010**: Enhance LoopsView with full functionality
   - List all loops with sorting (running first, then by created_at DESC)
   - Status color coding: running=green, paused=yellow, completed=cyan, failed=red
   - Progress bars showing completed/total stories
   - Real-time updates (2-second refresh)

2. **US-L011**: Add loop creation dialog
   - 'n' key opens creation dialog
   - Project selector dropdown
   - PRD file input (defaults to prd.json)
   - Max iterations input (default 10)
   - Branch name auto-generation

3. **US-L012**: Add loop detail view
   - Enter on loop opens detail view
   - Shows: all iterations, current story, status, duration
   - Iteration history with expandable output
   - Pause/Resume/Stop buttons

4. **US-L013**: Add loop controls to WorkersView
   - Show loops alongside workers
   - Unified view of all active work
   - Loop-specific controls (pause/stop)

**Dependencies**: Phase B
**Blocks**: Phase D (for manual testing)

---

### Phase D: Multi-Project Parallel Execution
**Goal**: Enable true parallel execution across projects

**User Stories**:
1. **US-L014**: Remove one-worker-per-project limit for loops
   - Modify WorkerOrchestrator to allow multiple loops per project
   - Use branch isolation instead of project locks
   - Track active loops per project separately from workers

2. **US-L015**: Implement loop capacity management
   - Config: `maxConcurrentLoops` (default: 5)
   - Config: `maxLoopsPerProject` (default: 2)
   - Queue loops when capacity is full

3. **US-L016**: Implement merge coordinator
   - Auto-merge completed loop branches (if strategy=auto)
   - Conflict detection before merge
   - Manual merge queue for strategy=manual
   - PR creation for strategy=pr

4. **US-L017**: Add loop scheduling to QueueManager
   - New scheduling mode: "loop" (vs "task")
   - Automatically create loops from queued tasks
   - Respect loop capacity limits

**Dependencies**: Phase C
**Blocks**: Phase E

---

### Phase E: Autonomous Loop Orchestration
**Goal**: MetaRalph autonomously manages loops across projects

**User Stories**:
1. **US-L018**: Create LoopOrchestrator class
   - Monitors queue for work
   - Decides when to start new loops
   - Balances work across projects
   - Manages loop lifecycle autonomously

2. **US-L019**: Implement intelligent loop scheduling
   - Start loops when: queue has pending tasks, capacity available, project not at limit
   - Prioritize projects with: high-priority tasks, fewer active loops, better health scores
   - Batch related tasks into single loops when possible

3. **US-L020**: Add autonomous loop management
   - Auto-pause loops on: user activity detected, resource limits, errors
   - Auto-resume when: conditions improve, user inactive
   - Auto-stop loops on: repeated failures, timeout, user override

4. **US-L021**: Implement cross-project resource balancing
   - Monitor resource usage per project (CPU, memory, API tokens)
   - Route new loops to projects with available capacity
   - Load balancing algorithm: round-robin, least-active, priority-weighted

5. **US-L022**: Add loop health monitoring
   - Track loop success rates per project
   - Detect stuck loops (no progress for X minutes)
   - Auto-recover from failures (retry with adjusted parameters)

**Dependencies**: Phase D
**Blocks**: Phase F

---

### Phase F: Advanced Orchestration Features
**Goal**: Advanced features for production-ready autonomous operation

**User Stories**:
1. **US-L023**: Implement loop dependencies
   - Loops can depend on other loops completing
   - Dependency graph visualization
   - Automatic sequencing of dependent loops

2. **US-L024**: Add loop templates and presets
   - Pre-configured loop types: "quick-fix", "feature", "refactor", "test-coverage"
   - Template defines: max_iterations, branch strategy, merge strategy
   - Quick-start loops from templates

3. **US-L025**: Implement loop learning system
   - Track which loop configurations work best per project type
   - Learn optimal max_iterations, branch strategies
   - Auto-adjust future loops based on historical success

4. **US-L026**: Add loop cost tracking
   - Track API token usage per loop
   - Cost per iteration, cost per project
   - Budget alerts and auto-pause on budget limits

5. **US-L027**: Implement loop notifications
   - Notify on: loop start, completion, failure, pause
   - Notification channels: dashboard, optional email/Slack
   - Configurable notification preferences

**Dependencies**: Phase E
**Blocks**: None (nice-to-have features)

---

## Implementation Strategy

### Step 1: Complete Current PRD (US-106-114)
The current `prd.json` has loop-related stories that should be completed first:
- US-107: Create loops database table ✅ (Phase A)
- US-106: Add Loops tab ✅ (Phase A)
- US-108-114: Loop UI and controls ✅ (Phase C)

**Action**: Complete these stories as foundation before moving to autonomous orchestration.

### Step 2: Build Loop Execution Engine (Phase B)
Once basic loop tracking exists, build the execution engine that can actually run loops.

### Step 3: Enable Parallelism (Phase D)
Remove project locks and enable true multi-project parallel execution.

### Step 4: Add Autonomy (Phase E)
Build the orchestration layer that makes decisions autonomously.

### Step 5: Polish (Phase F)
Add advanced features for production readiness.

---

## Success Metrics

### Phase A-C (Foundation)
- ✅ Can create and track loops in database
- ✅ Can start a loop and see it running
- ✅ Can pause/resume/stop loops manually
- ✅ Dashboard shows all loops with real-time updates

### Phase D (Parallelism)
- ✅ Multiple loops can run simultaneously across different projects
- ✅ Multiple loops can run on same project (different branches)
- ✅ No conflicts between parallel loops

### Phase E (Autonomy)
- ✅ Loops start automatically when queue has work
- ✅ Work is balanced across projects intelligently
- ✅ System recovers from failures autonomously
- ✅ Resource usage is optimized

### Phase F (Advanced)
- ✅ Loop success rates improve over time (learning)
- ✅ Cost tracking and budget management works
- ✅ Dependencies between loops are respected

---

## Risk Mitigation

### Risk 1: Branch Conflicts
**Mitigation**:
- Use unique branch names (loop-id + timestamp)
- Implement conflict detection before merge
- Manual merge strategy as fallback

### Risk 2: Resource Exhaustion
**Mitigation**:
- Configurable limits (maxConcurrentLoops, maxLoopsPerProject)
- Resource monitoring and auto-pause
- Budget limits with auto-stop

### Risk 3: Autonomous Decisions Go Wrong
**Mitigation**:
- Gradual autonomy increase (start conservative)
- User override controls always available
- Audit log of autonomous decisions
- Rollback capability for bad decisions

### Risk 4: Performance Degradation
**Mitigation**:
- Monitor system performance metrics
- Auto-throttle when resources constrained
- Queue management prevents overload

---

**Recommendation**: Implement in order, with testing and validation after each phase before moving to the next.

---

## Next Steps

1. **Immediate**: Complete US-107 (loops database) and US-106 (Loops tab) from current PRD
2. Finish Phase A and B (foundation + execution)
3. Complete Phase C (UI) and Phase D (parallelism)
4. Implement Phase E (autonomy)
5. Polish with Phase F features

This roadmap builds incrementally on existing infrastructure and gets you to full autonomous multi-project loop orchestration in a systematic way.
