/**
 * TDD Research Agent Repository
 *
 * CRUD operations for research agent records. Tracks agents spawned during
 * the RESEARCH phase and their findings (patterns, contracts, testing, security, performance).
 */

import { v4 as uuidv4 } from 'uuid';
import { initDatabase, type DatabaseInstance } from '../../db/index.js';
import type { ResearchAgentType, ResearchAgentStatus, ResearchAgent, ResearchFindings } from '../types.js';

/**
 * Input for creating a new research agent record
 */
export interface CreateAgentInput {
  phaseId: string;
  agentType: ResearchAgentType;
  status?: ResearchAgentStatus;
  startedAt?: string;
}

/**
 * Input for updating a research agent record
 */
export interface UpdateAgentInput {
  status?: ResearchAgentStatus;
  findings?: ResearchFindings;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

/**
 * Database row representation for research_agents table
 */
interface AgentRow {
  id: string;
  phase_id: string;
  agent_type: string;
  status: string;
  findings: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  created_at: string;
}

/**
 * Convert database row to ResearchAgent
 */
function rowToRecord(row: AgentRow): ResearchAgent {
  return {
    id: row.id,
    phaseId: row.phase_id,
    agentType: row.agent_type as ResearchAgentType,
    status: row.status as ResearchAgentStatus,
    findings: row.findings ? JSON.parse(row.findings) : null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms ?? undefined,
  };
}

/**
 * TDD Agent Repository - CRUD operations for research agents
 */
export const AgentRepository = {
  /**
   * Create a new research agent record
   *
   * @param input - Agent creation parameters
   * @param db - Optional database instance for testing
   * @returns The created agent record
   */
  create(input: CreateAgentInput, db?: DatabaseInstance): ResearchAgent {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const id = uuidv4();
      const now = new Date().toISOString();
      const status = input.status ?? 'pending';

      database.prepare(`
        INSERT INTO research_agents (id, phase_id, agent_type, status, started_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, input.phaseId, input.agentType, status, input.startedAt ?? null, now);

      return {
        id,
        phaseId: input.phaseId,
        agentType: input.agentType,
        status,
        findings: null,
        startedAt: input.startedAt ?? null,
        completedAt: null,
        durationMs: undefined,
      };
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Update an existing research agent record
   *
   * @param id - Agent ID to update
   * @param input - Fields to update
   * @param db - Optional database instance for testing
   * @returns The updated agent record or null if not found
   */
  update(id: string, input: UpdateAgentInput, db?: DatabaseInstance): ResearchAgent | null {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      // Build dynamic update query
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (input.status !== undefined) {
        updates.push('status = ?');
        values.push(input.status);
      }
      if (input.findings !== undefined) {
        updates.push('findings = ?');
        values.push(JSON.stringify(input.findings));
      }
      if (input.startedAt !== undefined) {
        updates.push('started_at = ?');
        values.push(input.startedAt);
      }
      if (input.completedAt !== undefined) {
        updates.push('completed_at = ?');
        values.push(input.completedAt);
      }
      if (input.durationMs !== undefined) {
        updates.push('duration_ms = ?');
        values.push(input.durationMs);
      }

      if (updates.length === 0) {
        return this.findById(id, database);
      }

      values.push(id);
      database.prepare(`
        UPDATE research_agents
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...values);

      return this.findById(id, database);
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Find a research agent record by ID
   *
   * @param id - Agent ID to find
   * @param db - Optional database instance for testing
   * @returns The agent record or null if not found
   */
  findById(id: string, db?: DatabaseInstance): ResearchAgent | null {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const row = database.prepare(`
        SELECT id, phase_id, agent_type, status, findings, started_at, completed_at, duration_ms, created_at
        FROM research_agents
        WHERE id = ?
      `).get(id) as AgentRow | undefined;

      return row ? rowToRecord(row) : null;
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Find all research agents for a phase
   *
   * @param phaseId - Phase ID to filter by
   * @param db - Optional database instance for testing
   * @returns Array of agent records ordered by created_at
   */
  findByPhase(phaseId: string, db?: DatabaseInstance): ResearchAgent[] {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const rows = database.prepare(`
        SELECT id, phase_id, agent_type, status, findings, started_at, completed_at, duration_ms, created_at
        FROM research_agents
        WHERE phase_id = ?
        ORDER BY created_at ASC
      `).all(phaseId) as AgentRow[];

      return rows.map(rowToRecord);
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Find a research agent by phase and type
   *
   * @param phaseId - Phase ID to filter by
   * @param agentType - Agent type to filter by
   * @param db - Optional database instance for testing
   * @returns The agent record or null if not found
   */
  findByType(phaseId: string, agentType: ResearchAgentType, db?: DatabaseInstance): ResearchAgent | null {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      const row = database.prepare(`
        SELECT id, phase_id, agent_type, status, findings, started_at, completed_at, duration_ms, created_at
        FROM research_agents
        WHERE phase_id = ? AND agent_type = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(phaseId, agentType) as AgentRow | undefined;

      return row ? rowToRecord(row) : null;
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },

  /**
   * Check if all agents for a phase have completed (or failed/timeout)
   *
   * @param phaseId - Phase ID to check
   * @param db - Optional database instance for testing
   * @returns True if all agents have finished (completed, failed, or timeout), false otherwise
   */
  allCompleted(phaseId: string, db?: DatabaseInstance): boolean {
    const database = db ?? initDatabase();
    const shouldClose = !db;

    try {
      // Count agents that are still pending or running
      const result = database.prepare(`
        SELECT COUNT(*) as count
        FROM research_agents
        WHERE phase_id = ? AND status IN ('pending', 'running')
      `).get(phaseId) as { count: number };

      return result.count === 0;
    } finally {
      if (shouldClose) {
        database.close();
      }
    }
  },
};
