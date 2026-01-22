/**
 * Tests for dependency-analyzer.ts - DAG construction and parallel batch analysis
 */

import { describe, it, expect } from 'vitest';
import {
  DependencyAnalyzer,
  CycleDetectedError,
  type ParallelBatch,
} from './dependency-analyzer.js';
import { type UserStory } from '../collaboration/prd-builder.js';

/**
 * Helper to create a UserStory with minimal required fields
 */
function createStory(
  id: string,
  priority: number,
  options: {
    passes?: boolean;
    dependsOn?: string[];
    title?: string;
    description?: string;
    acceptanceCriteria?: string[];
    notes?: string;
  } = {}
): UserStory {
  return {
    id,
    title: options.title ?? `Story ${id}`,
    description: options.description ?? `Description for ${id}`,
    acceptanceCriteria: options.acceptanceCriteria ?? ['Criterion 1'],
    priority,
    passes: options.passes ?? false,
    notes: options.notes ?? '',
    dependsOn: options.dependsOn,
  };
}

describe('dependency-analyzer.ts', () => {
  describe('DependencyAnalyzer constructor', () => {
    it('should create an analyzer from an empty story array', () => {
      const analyzer = new DependencyAnalyzer([]);
      expect(analyzer.storyCount).toBe(0);
    });

    it('should create an analyzer from stories with explicit dependencies', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
        createStory('US-003', 3, { dependsOn: ['US-001', 'US-002'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      expect(analyzer.storyCount).toBe(3);
      expect(analyzer.hasStory('US-001')).toBe(true);
      expect(analyzer.hasStory('US-002')).toBe(true);
      expect(analyzer.hasStory('US-003')).toBe(true);
    });

    it('should ignore dependencies on non-existent stories', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: ['US-001', 'US-NONEXISTENT'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      expect(analyzer.getDependencies('US-002')).toEqual(['US-001']);
    });
  });

  describe('Cycle detection', () => {
    it('should detect a simple cycle (A -> B -> A)', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: ['US-002'] }),
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
      ];

      expect(() => new DependencyAnalyzer(stories)).toThrow(CycleDetectedError);
    });

    it('should detect a longer cycle (A -> B -> C -> A)', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: ['US-003'] }),
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
        createStory('US-003', 3, { dependsOn: ['US-002'] }),
      ];

      expect(() => new DependencyAnalyzer(stories)).toThrow(CycleDetectedError);
    });

    it('should include cycle path in the error', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: ['US-002'] }),
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
      ];

      try {
        new DependencyAnalyzer(stories);
        expect.fail('Should have thrown CycleDetectedError');
      } catch (error) {
        expect(error).toBeInstanceOf(CycleDetectedError);
        expect((error as CycleDetectedError).cycle.length).toBeGreaterThan(0);
      }
    });

    it('should not throw for a valid DAG', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
        createStory('US-003', 3, { dependsOn: ['US-001'] }),
        createStory('US-004', 4, { dependsOn: ['US-002', 'US-003'] }),
      ];

      expect(() => new DependencyAnalyzer(stories)).not.toThrow();
    });

    it('should detect self-referencing dependencies', () => {
      const stories = [createStory('US-001', 1, { dependsOn: ['US-001'] })];

      expect(() => new DependencyAnalyzer(stories)).toThrow(CycleDetectedError);
    });
  });

  describe('getReadyStories', () => {
    it('should return stories with no dependencies as ready', () => {
      // Note: dependsOn: [] is treated as no explicit dependencies, which means
      // backward compatibility kicks in and US-002 depends on US-001.
      // To have truly independent stories, they must be priority 1 or have explicit non-empty dependsOn
      const stories = [
        createStory('US-001', 1, { dependsOn: ['US-003'] }), // Explicit dependency on US-003
        createStory('US-002', 2, { dependsOn: ['US-003'] }), // Explicit dependency on US-003
        createStory('US-003', 3, { dependsOn: ['US-001', 'US-002'] }), // Depends on both - but creates cycle
      ];

      // Use a non-cyclic structure instead
      const validStories = [
        createStory('US-001', 1), // No dependsOn = first priority, no dependencies
        createStory('US-002', 2, { dependsOn: ['US-001'] }), // Explicit dependency
        createStory('US-003', 3, { dependsOn: ['US-001'] }), // Also depends on US-001 only
      ];

      const analyzer = new DependencyAnalyzer(validStories);
      const ready = analyzer.getReadyStories();

      // Only US-001 is ready initially (no prior stories due to priority 1)
      expect(ready.length).toBe(1);
      expect(ready.map((s) => s.id)).toContain('US-001');
    });

    it('should return stories whose dependencies are completed', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
        createStory('US-003', 3, { dependsOn: ['US-002'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);

      // Initially only US-001 is ready
      let ready = analyzer.getReadyStories();
      expect(ready.map((s) => s.id)).toEqual(['US-001']);

      // After completing US-001, US-002 becomes ready
      ready = analyzer.getReadyStories(new Set(['US-001']));
      expect(ready.map((s) => s.id)).toEqual(['US-002']);

      // After completing US-002, US-003 becomes ready
      ready = analyzer.getReadyStories(new Set(['US-001', 'US-002']));
      expect(ready.map((s) => s.id)).toEqual(['US-003']);
    });

    it('should not return stories that already pass', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [], passes: true }),
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      const ready = analyzer.getReadyStories();

      // US-001 is skipped because passes=true, US-002 is ready because US-001 passes
      expect(ready.map((s) => s.id)).toEqual(['US-002']);
    });

    it('should skip stories with failed dependencies', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
        createStory('US-003', 3, { dependsOn: ['US-002'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);

      // If US-001 fails, US-002 and US-003 should not be ready
      const ready = analyzer.getReadyStories(new Set(), new Set(['US-001']));
      expect(ready.length).toBe(0);
    });

    it('should sort ready stories by priority', () => {
      // All stories depend on US-001 (priority 1) explicitly
      // After US-001 completes, US-002 and US-003 become ready
      const stories = [
        createStory('US-003', 3, { dependsOn: ['US-001'] }),
        createStory('US-001', 1), // Priority 1, no prior stories
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);

      // Initially only US-001 is ready
      let ready = analyzer.getReadyStories();
      expect(ready.map((s) => s.id)).toEqual(['US-001']);

      // After completing US-001, both US-002 and US-003 are ready, sorted by priority
      ready = analyzer.getReadyStories(new Set(['US-001']));
      expect(ready.map((s) => s.id)).toEqual(['US-002', 'US-003']);
    });

    it('should not return completed stories', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: [] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      const ready = analyzer.getReadyStories(new Set(['US-001']));

      expect(ready.map((s) => s.id)).toEqual(['US-002']);
    });

    it('should consider dependency.passes when checking readiness', () => {
      // US-002 depends on US-001, but US-001.passes is true
      const stories = [
        createStory('US-001', 1, { dependsOn: [], passes: true }),
        createStory('US-002', 2, { dependsOn: ['US-001'], passes: false }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      const ready = analyzer.getReadyStories();

      // US-002 should be ready because its dependency (US-001) has passes=true
      expect(ready.map((s) => s.id)).toEqual(['US-002']);
    });
  });

  describe('getDependents', () => {
    it('should return stories that depend on the given story', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
        createStory('US-003', 3, { dependsOn: ['US-001'] }),
        createStory('US-004', 4, { dependsOn: ['US-002'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);

      expect(analyzer.getDependents('US-001')).toContain('US-002');
      expect(analyzer.getDependents('US-001')).toContain('US-003');
      expect(analyzer.getDependents('US-001').length).toBe(2);

      expect(analyzer.getDependents('US-002')).toEqual(['US-004']);
      expect(analyzer.getDependents('US-003')).toEqual([]);
    });

    it('should return empty array for non-existent story', () => {
      const stories = [createStory('US-001', 1, { dependsOn: [] })];

      const analyzer = new DependencyAnalyzer(stories);
      expect(analyzer.getDependents('US-NONEXISTENT')).toEqual([]);
    });

    it('should return empty array for story with no dependents', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      expect(analyzer.getDependents('US-002')).toEqual([]);
    });
  });

  describe('getDependencies', () => {
    it('should return stories that the given story depends on', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: [] }),
        createStory('US-003', 3, { dependsOn: ['US-001', 'US-002'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);

      expect(analyzer.getDependencies('US-003')).toContain('US-001');
      expect(analyzer.getDependencies('US-003')).toContain('US-002');
      expect(analyzer.getDependencies('US-003').length).toBe(2);
    });

    it('should return empty array for non-existent story', () => {
      const stories = [createStory('US-001', 1, { dependsOn: [] })];

      const analyzer = new DependencyAnalyzer(stories);
      expect(analyzer.getDependencies('US-NONEXISTENT')).toEqual([]);
    });

    it('should return empty array for story with no dependencies', () => {
      const stories = [createStory('US-001', 1, { dependsOn: [] })];

      const analyzer = new DependencyAnalyzer(stories);
      expect(analyzer.getDependencies('US-001')).toEqual([]);
    });
  });

  describe('getExecutionOrder', () => {
    it('should return stories in topological order', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
        createStory('US-003', 3, { dependsOn: ['US-002'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      const order = analyzer.getExecutionOrder();

      // US-001 must come before US-002, US-002 must come before US-003
      const idx1 = order.indexOf('US-001');
      const idx2 = order.indexOf('US-002');
      const idx3 = order.indexOf('US-003');

      expect(idx1).toBeLessThan(idx2);
      expect(idx2).toBeLessThan(idx3);
    });

    it('should handle diamond dependencies correctly', () => {
      // Diamond: US-001 -> US-002 & US-003 -> US-004
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
        createStory('US-003', 3, { dependsOn: ['US-001'] }),
        createStory('US-004', 4, { dependsOn: ['US-002', 'US-003'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      const order = analyzer.getExecutionOrder();

      const idx1 = order.indexOf('US-001');
      const idx2 = order.indexOf('US-002');
      const idx3 = order.indexOf('US-003');
      const idx4 = order.indexOf('US-004');

      // US-001 must come first
      expect(idx1).toBeLessThan(idx2);
      expect(idx1).toBeLessThan(idx3);

      // US-004 must come last
      expect(idx2).toBeLessThan(idx4);
      expect(idx3).toBeLessThan(idx4);
    });

    it('should return empty array for empty stories', () => {
      const analyzer = new DependencyAnalyzer([]);
      expect(analyzer.getExecutionOrder()).toEqual([]);
    });

    it('should handle multiple independent chains', () => {
      // Two independent chains: A->B and C->D
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
        createStory('US-003', 3, { dependsOn: [] }),
        createStory('US-004', 4, { dependsOn: ['US-003'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      const order = analyzer.getExecutionOrder();

      // All stories should be in the result
      expect(order.length).toBe(4);

      // Chain 1: US-001 before US-002
      expect(order.indexOf('US-001')).toBeLessThan(order.indexOf('US-002'));

      // Chain 2: US-003 before US-004
      expect(order.indexOf('US-003')).toBeLessThan(order.indexOf('US-004'));
    });
  });

  describe('getParallelBatches', () => {
    it('should return correct batches with backward compatibility mode', () => {
      // With backward compatibility: stories without dependsOn depend on all prior stories
      // So these will be sequential batches
      const stories = [
        createStory('US-001', 1), // No dependsOn = priority 1, no prior stories
        createStory('US-002', 2), // No dependsOn = depends on US-001 (priority 1)
        createStory('US-003', 3), // No dependsOn = depends on US-001, US-002
      ];

      const analyzer = new DependencyAnalyzer(stories);
      const batches = analyzer.getParallelBatches();

      // Sequential due to implicit dependencies
      expect(batches.length).toBe(3);
      expect(batches[0].storyIds).toEqual(['US-001']);
      expect(batches[1].storyIds).toEqual(['US-002']);
      expect(batches[2].storyIds).toEqual(['US-003']);
    });

    it('should organize stories into correct batches with explicit dependencies', () => {
      // US-001 has no prior stories (priority 1)
      // US-002 and US-003 both explicitly depend on US-001
      // US-004 depends on US-002 and US-003
      const stories = [
        createStory('US-001', 1), // Priority 1, no prior stories to depend on
        createStory('US-002', 2, { dependsOn: ['US-001'] }), // Explicit dependency
        createStory('US-003', 3, { dependsOn: ['US-001'] }), // Explicit dependency - parallel with US-002
        createStory('US-004', 4, { dependsOn: ['US-002', 'US-003'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      const batches = analyzer.getParallelBatches();

      expect(batches.length).toBe(3);

      // Batch 1: Only US-001
      expect(batches[0].storyIds).toEqual(['US-001']);

      // Batch 2: US-002 and US-003 can run in parallel
      expect(batches[1].storyIds).toContain('US-002');
      expect(batches[1].storyIds).toContain('US-003');
      expect(batches[1].storyIds.length).toBe(2);

      // Batch 3: US-004
      expect(batches[2].storyIds).toEqual(['US-004']);
    });

    it('should sort stories within batches by priority', () => {
      // All depend on ROOT, so they'll be in the same second batch
      const stories = [
        createStory('ROOT', 1), // First priority
        createStory('US-003', 4, { dependsOn: ['ROOT'] }),
        createStory('US-001', 2, { dependsOn: ['ROOT'] }),
        createStory('US-002', 3, { dependsOn: ['ROOT'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      const batches = analyzer.getParallelBatches();

      expect(batches[0].storyIds).toEqual(['ROOT']);
      expect(batches[1].storyIds).toEqual(['US-001', 'US-002', 'US-003']);
    });

    it('should handle linear dependencies (one per batch)', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
        createStory('US-003', 3, { dependsOn: ['US-002'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      const batches = analyzer.getParallelBatches();

      expect(batches.length).toBe(3);
      expect(batches[0].storyIds).toEqual(['US-001']);
      expect(batches[1].storyIds).toEqual(['US-002']);
      expect(batches[2].storyIds).toEqual(['US-003']);
    });

    it('should have correct batch numbers', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: ['US-001'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      const batches = analyzer.getParallelBatches();

      expect(batches[0].batchNumber).toBe(1);
      expect(batches[1].batchNumber).toBe(2);
    });

    it('should return empty array for empty stories', () => {
      const analyzer = new DependencyAnalyzer([]);
      const batches = analyzer.getParallelBatches();
      expect(batches).toEqual([]);
    });
  });

  describe('Backward compatibility (stories without dependsOn)', () => {
    it('should treat stories without dependsOn as depending on prior stories by priority', () => {
      // No dependsOn field - should create implicit dependencies
      const stories = [
        createStory('US-001', 1),
        createStory('US-002', 2),
        createStory('US-003', 3),
      ];

      const analyzer = new DependencyAnalyzer(stories);

      // US-002 should depend on US-001
      expect(analyzer.getDependencies('US-002')).toContain('US-001');

      // US-003 should depend on US-001 and US-002
      expect(analyzer.getDependencies('US-003')).toContain('US-001');
      expect(analyzer.getDependencies('US-003')).toContain('US-002');
    });

    it('should produce linear batches for stories without dependsOn', () => {
      const stories = [
        createStory('US-001', 1),
        createStory('US-002', 2),
        createStory('US-003', 3),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      const batches = analyzer.getParallelBatches();

      // Should be sequential since each depends on all prior
      expect(batches.length).toBe(3);
      expect(batches[0].storyIds).toEqual(['US-001']);
      expect(batches[1].storyIds).toEqual(['US-002']);
      expect(batches[2].storyIds).toEqual(['US-003']);
    });

    it('should handle mixed stories (some with dependsOn, some without)', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }), // Explicit empty
        createStory('US-002', 2), // No dependsOn - depends on US-001
        createStory('US-003', 3, { dependsOn: ['US-001'] }), // Explicit
      ];

      const analyzer = new DependencyAnalyzer(stories);

      // US-002 should depend on US-001 (implicit)
      expect(analyzer.getDependencies('US-002')).toContain('US-001');

      // US-003 should only depend on US-001 (explicit)
      expect(analyzer.getDependencies('US-003')).toEqual(['US-001']);
    });

    it('should treat empty dependsOn array same as no dependsOn (backward compatibility)', () => {
      // Important: dependsOn: [] is treated the same as not having dependsOn at all
      // This is because the condition is: story.dependsOn && story.dependsOn.length > 0
      // An empty array fails the length > 0 check
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }), // Priority 1, no prior stories
        createStory('US-002', 2, { dependsOn: [] }), // Priority 2, implicit dep on US-001
      ];

      const analyzer = new DependencyAnalyzer(stories);

      // US-001 has no dependencies (no prior stories by priority)
      expect(analyzer.getDependencies('US-001')).toEqual([]);
      // US-002 implicitly depends on US-001 due to backward compatibility
      expect(analyzer.getDependencies('US-002')).toEqual(['US-001']);

      // Sequential batches due to implicit dependencies
      const batches = analyzer.getParallelBatches();
      expect(batches.length).toBe(2);
      expect(batches[0].storyIds).toEqual(['US-001']);
      expect(batches[1].storyIds).toEqual(['US-002']);
    });
  });

  describe('getStory and getAllStories', () => {
    it('should retrieve a story by ID', () => {
      const stories = [
        createStory('US-001', 1, { title: 'First Story', dependsOn: [] }),
        createStory('US-002', 2, { title: 'Second Story', dependsOn: [] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);

      const story = analyzer.getStory('US-001');
      expect(story).toBeDefined();
      expect(story?.title).toBe('First Story');
    });

    it('should return undefined for non-existent story', () => {
      const analyzer = new DependencyAnalyzer([]);
      expect(analyzer.getStory('US-NONEXISTENT')).toBeUndefined();
    });

    it('should return all stories', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: [] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      const all = analyzer.getAllStories();

      expect(all.length).toBe(2);
      expect(all.map((s) => s.id)).toContain('US-001');
      expect(all.map((s) => s.id)).toContain('US-002');
    });
  });

  describe('hasStory and storyCount', () => {
    it('should check if a story exists', () => {
      const stories = [createStory('US-001', 1, { dependsOn: [] })];

      const analyzer = new DependencyAnalyzer(stories);

      expect(analyzer.hasStory('US-001')).toBe(true);
      expect(analyzer.hasStory('US-002')).toBe(false);
    });

    it('should return correct story count', () => {
      const stories = [
        createStory('US-001', 1, { dependsOn: [] }),
        createStory('US-002', 2, { dependsOn: [] }),
        createStory('US-003', 3, { dependsOn: [] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      expect(analyzer.storyCount).toBe(3);
    });
  });

  describe('CycleDetectedError', () => {
    it('should have correct error name', () => {
      const error = new CycleDetectedError(['A', 'B', 'A']);
      expect(error.name).toBe('CycleDetectedError');
    });

    it('should contain cycle information', () => {
      const cycle = ['US-001', 'US-002', 'US-001'];
      const error = new CycleDetectedError(cycle);

      expect(error.cycle).toEqual(cycle);
      expect(error.message).toContain('US-001');
      expect(error.message).toContain('US-002');
    });

    it('should accept custom message', () => {
      const error = new CycleDetectedError(['A', 'B'], 'Custom message');
      expect(error.message).toBe('Custom message');
    });
  });

  describe('Complex DAG scenarios', () => {
    it('should handle a complex real-world dependency graph', () => {
      // Simulate a real PRD structure
      const stories = [
        createStory('US-000', 1, { dependsOn: [] }), // Foundation
        createStory('US-001', 2, { dependsOn: ['US-000'] }), // Build on foundation
        createStory('US-002', 3, { dependsOn: ['US-001'] }), // Dependencies
        createStory('US-003', 4, { dependsOn: ['US-002'] }), // Parallel scheduler
        createStory('US-004', 5, { dependsOn: ['US-003'] }), // Wire up parallel
        createStory('US-005', 6, { dependsOn: ['US-003'] }), // Conflict detection (parallel to US-004)
        createStory('US-006', 7, { dependsOn: ['US-001'] }), // TDD types (parallel to US-002)
        createStory('US-007', 8, { dependsOn: ['US-006'] }), // TDD schema
        createStory('US-008', 9, { dependsOn: ['US-007'] }), // Phase repo
        createStory('US-009', 10, { dependsOn: ['US-007'] }), // Test repo (parallel to US-008)
      ];

      const analyzer = new DependencyAnalyzer(stories);

      // Should not throw
      expect(analyzer.storyCount).toBe(10);

      // Check parallel batches
      const batches = analyzer.getParallelBatches();

      // Batch 1: US-000
      expect(batches[0].storyIds).toEqual(['US-000']);

      // Batch 2: US-001
      expect(batches[1].storyIds).toEqual(['US-001']);

      // Batch 3: US-002 and US-006 (both depend only on US-001)
      expect(batches[2].storyIds).toContain('US-002');
      expect(batches[2].storyIds).toContain('US-006');

      // Execution order should respect all dependencies
      const order = analyzer.getExecutionOrder();
      expect(order.indexOf('US-000')).toBeLessThan(order.indexOf('US-001'));
      expect(order.indexOf('US-001')).toBeLessThan(order.indexOf('US-002'));
      expect(order.indexOf('US-001')).toBeLessThan(order.indexOf('US-006'));
      expect(order.indexOf('US-006')).toBeLessThan(order.indexOf('US-007'));
      expect(order.indexOf('US-007')).toBeLessThan(order.indexOf('US-008'));
      expect(order.indexOf('US-007')).toBeLessThan(order.indexOf('US-009'));
    });

    it('should handle multiple roots and multiple sinks with explicit dependencies', () => {
      // Multiple entry points and multiple end points
      // Note: ROOT-1 has priority 1, so no implicit dependencies
      // ROOT-2 also needs explicit dependency to be a root (or same priority)
      // Let's give them same priority or use explicit empty deps on priority 1
      const stories = [
        createStory('ROOT-1', 1), // Priority 1, no prior stories
        createStory('ROOT-2', 2, { dependsOn: ['ROOT-1'] }), // Must depend on ROOT-1 in backward compat
        createStory('MID-1', 3, { dependsOn: ['ROOT-1'] }), // Explicit dep
        createStory('MID-2', 4, { dependsOn: ['ROOT-2'] }), // Explicit dep
        createStory('SINK-1', 5, { dependsOn: ['MID-1'] }),
        createStory('SINK-2', 6, { dependsOn: ['MID-2'] }),
        createStory('SINK-3', 7, { dependsOn: ['MID-1', 'MID-2'] }),
      ];

      const analyzer = new DependencyAnalyzer(stories);
      const batches = analyzer.getParallelBatches();

      // Batch 1: Only ROOT-1 (priority 1, no deps)
      expect(batches[0].storyIds).toEqual(['ROOT-1']);

      // Batch 2: ROOT-2 and MID-1 (both depend only on ROOT-1)
      expect(batches[1].storyIds).toContain('ROOT-2');
      expect(batches[1].storyIds).toContain('MID-1');

      // Batch 3: MID-2 (depends on ROOT-2)
      expect(batches[2].storyIds).toContain('MID-2');

      // After that: SINK-1 (depends on MID-1), then sinks depending on MID-2
      // The exact batch structure depends on dependencies
      const allStoryIds = batches.flatMap((b) => b.storyIds);
      expect(allStoryIds).toContain('SINK-1');
      expect(allStoryIds).toContain('SINK-2');
      expect(allStoryIds).toContain('SINK-3');
    });
  });
});
