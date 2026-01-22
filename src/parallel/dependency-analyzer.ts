/**
 * Dependency Analyzer - Analyzes story dependencies in prd.json for parallel execution
 *
 * Builds a directed acyclic graph (DAG) from user story dependencies and provides
 * methods to determine which stories can run in parallel, execution order, and
 * dependent stories.
 */

import { type UserStory } from '../collaboration/prd-builder.js';

/**
 * Error thrown when a cycle is detected in the dependency graph
 */
export class CycleDetectedError extends Error {
  constructor(
    public readonly cycle: string[],
    message?: string
  ) {
    super(message ?? `Cycle detected in dependencies: ${cycle.join(' -> ')}`);
    this.name = 'CycleDetectedError';
  }
}

/**
 * Represents a node in the dependency graph
 */
interface DependencyNode {
  storyId: string;
  story: UserStory;
  dependencies: Set<string>;
  dependents: Set<string>;
}

/**
 * Status of a story in the execution context
 */
export type StoryStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Story execution state used by the analyzer
 */
export interface StoryState {
  storyId: string;
  status: StoryStatus;
}

/**
 * A batch of stories that can be executed concurrently
 */
export interface ParallelBatch {
  batchNumber: number;
  storyIds: string[];
}

/**
 * DependencyAnalyzer - Analyzes and manages story dependencies
 */
export class DependencyAnalyzer {
  private nodes: Map<string, DependencyNode> = new Map();
  private stories: UserStory[] = [];

  /**
   * Create a new DependencyAnalyzer from user stories
   *
   * @param stories - Array of user stories from prd.json
   * @throws CycleDetectedError if a dependency cycle is found
   */
  constructor(stories: UserStory[]) {
    this.stories = stories;
    this.buildGraph(stories);
    this.validateNoCycles();
  }

  /**
   * Build the dependency graph from user stories
   */
  private buildGraph(stories: UserStory[]): void {
    // First pass: create all nodes
    for (const story of stories) {
      this.nodes.set(story.id, {
        storyId: story.id,
        story,
        dependencies: new Set(),
        dependents: new Set(),
      });
    }

    // Sort stories by priority for backward compatibility handling
    const sortedByPriority = [...stories].sort((a, b) => a.priority - b.priority);

    // Second pass: build edges
    for (const story of stories) {
      const node = this.nodes.get(story.id)!;

      if (story.dependsOn && story.dependsOn.length > 0) {
        // Explicit dependencies
        for (const depId of story.dependsOn) {
          if (this.nodes.has(depId)) {
            node.dependencies.add(depId);
            this.nodes.get(depId)!.dependents.add(story.id);
          }
          // Ignore dependencies on non-existent stories silently
        }
      } else {
        // Backward compatibility: stories without dependsOn depend on all prior stories by priority
        for (const priorStory of sortedByPriority) {
          if (priorStory.priority < story.priority) {
            node.dependencies.add(priorStory.id);
            this.nodes.get(priorStory.id)!.dependents.add(story.id);
          }
        }
      }
    }
  }

  /**
   * Validate that the graph has no cycles using DFS
   *
   * @throws CycleDetectedError if a cycle is found
   */
  private validateNoCycles(): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string): void => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const depId of node.dependencies) {
          if (!visited.has(depId)) {
            dfs(depId);
          } else if (recursionStack.has(depId)) {
            // Found a cycle - construct the cycle path
            const cycleStartIndex = path.indexOf(depId);
            const cycle = [...path.slice(cycleStartIndex), depId];
            throw new CycleDetectedError(cycle);
          }
        }
      }

      path.pop();
      recursionStack.delete(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }
  }

  /**
   * Get stories that are ready to execute (all dependencies satisfied)
   *
   * @param completedStories - Set of story IDs that have been completed
   * @param failedStories - Set of story IDs that have failed (dependents will be skipped)
   * @returns Array of stories ready to execute
   */
  getReadyStories(
    completedStories: Set<string> = new Set(),
    failedStories: Set<string> = new Set()
  ): UserStory[] {
    const readyStories: UserStory[] = [];

    for (const node of this.nodes.values()) {
      // Skip already completed or failed stories
      if (completedStories.has(node.storyId) || failedStories.has(node.storyId)) {
        continue;
      }

      // Skip if already passes
      if (node.story.passes) {
        continue;
      }

      // Check if any dependency has failed (this story should be skipped)
      let hasfailedDependency = false;
      for (const depId of node.dependencies) {
        if (failedStories.has(depId)) {
          hasfailedDependency = true;
          break;
        }
      }
      if (hasfailedDependency) {
        continue;
      }

      // Check if all dependencies are satisfied
      let allDependenciesSatisfied = true;
      for (const depId of node.dependencies) {
        if (!completedStories.has(depId)) {
          // Check if the dependency is already marked as passes in the story
          const depNode = this.nodes.get(depId);
          if (!depNode?.story.passes) {
            allDependenciesSatisfied = false;
            break;
          }
        }
      }

      if (allDependenciesSatisfied) {
        readyStories.push(node.story);
      }
    }

    // Sort by priority (lower priority number = higher priority)
    return readyStories.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get stories that depend on the given story
   *
   * @param storyId - The story ID to get dependents for
   * @returns Array of story IDs that depend on the given story
   */
  getDependents(storyId: string): string[] {
    const node = this.nodes.get(storyId);
    if (!node) {
      return [];
    }
    return Array.from(node.dependents);
  }

  /**
   * Get stories that the given story depends on
   *
   * @param storyId - The story ID to get dependencies for
   * @returns Array of story IDs that the given story depends on
   */
  getDependencies(storyId: string): string[] {
    const node = this.nodes.get(storyId);
    if (!node) {
      return [];
    }
    return Array.from(node.dependencies);
  }

  /**
   * Get topologically sorted list of story IDs (execution order)
   *
   * @returns Array of story IDs in topological order
   */
  getExecutionOrder(): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const tempMarked = new Set<string>();

    const visit = (nodeId: string): void => {
      if (visited.has(nodeId)) {
        return;
      }
      if (tempMarked.has(nodeId)) {
        // Should not happen since we validated no cycles
        return;
      }

      tempMarked.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        // Visit all dependencies first
        for (const depId of node.dependencies) {
          visit(depId);
        }
      }

      tempMarked.delete(nodeId);
      visited.add(nodeId);
      result.push(nodeId);
    };

    // Visit all nodes
    for (const nodeId of this.nodes.keys()) {
      visit(nodeId);
    }

    return result;
  }

  /**
   * Get stories organized into batches that can run concurrently
   *
   * Each batch contains stories whose dependencies are all in previous batches.
   *
   * @returns Array of parallel batches
   */
  getParallelBatches(): ParallelBatch[] {
    const batches: ParallelBatch[] = [];
    const assigned = new Set<string>();
    let batchNumber = 1;

    while (assigned.size < this.nodes.size) {
      const batch: string[] = [];

      for (const node of this.nodes.values()) {
        // Skip already assigned stories
        if (assigned.has(node.storyId)) {
          continue;
        }

        // Check if all dependencies are assigned to previous batches
        let allDepsAssigned = true;
        for (const depId of node.dependencies) {
          if (!assigned.has(depId)) {
            allDepsAssigned = false;
            break;
          }
        }

        if (allDepsAssigned) {
          batch.push(node.storyId);
        }
      }

      // Sort batch by priority for consistent ordering
      batch.sort((a, b) => {
        const nodeA = this.nodes.get(a)!;
        const nodeB = this.nodes.get(b)!;
        return nodeA.story.priority - nodeB.story.priority;
      });

      // Add stories to assigned set
      for (const storyId of batch) {
        assigned.add(storyId);
      }

      batches.push({
        batchNumber,
        storyIds: batch,
      });

      batchNumber++;
    }

    return batches;
  }

  /**
   * Get a specific story by ID
   *
   * @param storyId - The story ID
   * @returns The user story or undefined
   */
  getStory(storyId: string): UserStory | undefined {
    return this.nodes.get(storyId)?.story;
  }

  /**
   * Get all stories
   *
   * @returns Array of all user stories
   */
  getAllStories(): UserStory[] {
    return this.stories;
  }

  /**
   * Get the total number of stories
   */
  get storyCount(): number {
    return this.nodes.size;
  }

  /**
   * Check if a story exists in the graph
   *
   * @param storyId - The story ID to check
   * @returns True if the story exists
   */
  hasStory(storyId: string): boolean {
    return this.nodes.has(storyId);
  }
}
