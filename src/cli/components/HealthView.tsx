/**
 * HealthView - Terminal UI component for viewing project and system health
 *
 * Provides:
 * - Self-improvement status section showing analysis time, proposals, and approvals
 * - Self-improvement proposal list with risk scoring
 * - Future: Project health overview with scores and trends
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, Key } from 'ink';
import { initDatabase, type DatabaseInstance } from '../../db/index.js';
import { listProjects, type Project } from '../../registry/index.js';
import { TaskRepository, type Task, type TaskType } from '../../queue/task.js';
import { getRegisteredSelfProjects, Guardrails, type RiskAssessment } from '../../self-improve/index.js';

/**
 * Self-improvement status data
 */
interface SelfImprovementStatus {
  lastAnalysisTime: string | null;
  proposalsInQueue: number;
  pendingApprovals: number;
  recentResults: Array<{
    id: string;
    title: string;
    status: string;
    completedAt: string | null;
  }>;
  selfProjectsCount: number;
}

/**
 * Proposal with risk assessment for display
 */
interface ProposalWithRisk {
  task: Task;
  riskAssessment: RiskAssessment;
  projectName: string;
}

/**
 * Get risk score color
 */
function getRiskColor(score: number): string {
  if (score < 40) return 'green';
  if (score <= 70) return 'yellow';
  return 'red';
}

/**
 * Format date for display
 */
function formatDate(dateString: string | null): string {
  if (!dateString) return 'Never';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateString;
  }
}

/**
 * Self-Improvement Status Section Component
 */
function SelfImprovementSection({
  status,
  loading,
}: {
  status: SelfImprovementStatus | null;
  loading: boolean;
}): React.ReactElement {
  if (loading) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="magenta">Self-Improvement Status</Text>
        <Text color="gray">Loading...</Text>
      </Box>
    );
  }

  if (!status) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="magenta">Self-Improvement Status</Text>
        <Text color="gray">Unable to load self-improvement status.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text bold color="magenta">Self-Improvement Status</Text>

      {/* Summary stats row */}
      <Box flexDirection="row" marginTop={1} gap={4}>
        <Box flexDirection="column">
          <Text color="gray">Self-Managed Projects</Text>
          <Text bold color={status.selfProjectsCount > 0 ? 'cyan' : 'gray'}>
            {status.selfProjectsCount}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text color="gray">Last Analysis</Text>
          <Text bold color={status.lastAnalysisTime ? 'cyan' : 'gray'}>
            {formatDate(status.lastAnalysisTime)}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text color="gray">Proposals in Queue</Text>
          <Text bold color={status.proposalsInQueue > 0 ? 'yellow' : 'gray'}>
            {status.proposalsInQueue}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text color="gray">Pending Approvals</Text>
          <Text bold color={status.pendingApprovals > 0 ? 'red' : 'green'}>
            {status.pendingApprovals}
          </Text>
        </Box>
      </Box>

      {/* Recent results */}
      {status.recentResults.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">Recent Results</Text>
          {status.recentResults.map((result, index) => {
            const statusColor =
              result.status === 'completed' ? 'green' :
              result.status === 'failed' ? 'red' :
              result.status === 'running' ? 'yellow' : 'gray';

            return (
              <Box key={result.id} flexDirection="row" gap={2}>
                <Text color={statusColor}>
                  {result.status === 'completed' ? '✓' :
                   result.status === 'failed' ? '✗' :
                   result.status === 'running' ? '▶' : '○'}
                </Text>
                <Box width={40}>
                  <Text>{result.title.substring(0, 38)}</Text>
                </Box>
                <Text color="gray">{formatDate(result.completedAt)}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {status.selfProjectsCount === 0 && (
        <Box marginTop={1}>
          <Text color="gray" italic>
            No self-managed projects registered. Use "metaralph self-improve register" to enable.
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Format task type for display
 */
function formatTaskType(type: TaskType): string {
  switch (type) {
    case 'bug_fix': return 'Bug Fix';
    case 'test': return 'Test';
    case 'docs': return 'Docs';
    case 'refactor': return 'Refactor';
    case 'feature': return 'Feature';
    default: return type;
  }
}

/**
 * Proposal list header
 */
function ProposalListHeader(): React.ReactElement {
  return (
    <Box flexDirection="row" paddingX={1}>
      <Box width={40}>
        <Text bold color="gray">Title</Text>
      </Box>
      <Box width={12}>
        <Text bold color="gray">Type</Text>
      </Box>
      <Box width={8}>
        <Text bold color="gray">Risk</Text>
      </Box>
      <Box width={12}>
        <Text bold color="gray">Project</Text>
      </Box>
    </Box>
  );
}

/**
 * Single proposal row
 */
function ProposalRow({
  proposal,
  selected,
}: {
  proposal: ProposalWithRisk;
  selected: boolean;
}): React.ReactElement {
  const riskColor = getRiskColor(proposal.riskAssessment.score);
  const truncatedTitle = proposal.task.title.length > 38
    ? proposal.task.title.substring(0, 35) + '...'
    : proposal.task.title;
  const truncatedProject = proposal.projectName.length > 10
    ? proposal.projectName.substring(0, 9) + '…'
    : proposal.projectName;

  return (
    <Box flexDirection="row" paddingX={1}>
      <Box width={40}>
        <Text inverse={selected} color={selected ? undefined : 'white'}>
          {truncatedTitle}
        </Text>
      </Box>
      <Box width={12}>
        <Text color="cyan">{formatTaskType(proposal.task.type)}</Text>
      </Box>
      <Box width={8}>
        <Text color={riskColor} bold>
          {proposal.riskAssessment.score}
        </Text>
      </Box>
      <Box width={12}>
        <Text color="gray">{truncatedProject}</Text>
      </Box>
    </Box>
  );
}

/**
 * Proposal detail view
 */
function ProposalDetailView({
  proposal,
}: {
  proposal: ProposalWithRisk;
}): React.ReactElement {
  const riskColor = getRiskColor(proposal.riskAssessment.score);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={riskColor} paddingX={1}>
      <Text bold color="cyan">{proposal.task.title}</Text>

      <Box flexDirection="row" marginTop={1} gap={4}>
        <Box flexDirection="column">
          <Text color="gray">Type</Text>
          <Text>{formatTaskType(proposal.task.type)}</Text>
        </Box>
        <Box flexDirection="column">
          <Text color="gray">Risk Score</Text>
          <Text color={riskColor} bold>{proposal.riskAssessment.score}/100</Text>
        </Box>
        <Box flexDirection="column">
          <Text color="gray">Risk Level</Text>
          <Text color={riskColor} bold>{proposal.riskAssessment.level.toUpperCase()}</Text>
        </Box>
        <Box flexDirection="column">
          <Text color="gray">Project</Text>
          <Text>{proposal.projectName}</Text>
        </Box>
      </Box>

      {proposal.task.description && (
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Description</Text>
          <Text>{proposal.task.description}</Text>
        </Box>
      )}

      {proposal.riskAssessment.reasons.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Risk Factors</Text>
          {proposal.riskAssessment.reasons.map((reason, i) => (
            <Text key={i} color="yellow">  • {reason}</Text>
          ))}
        </Box>
      )}

      {proposal.riskAssessment.affectedFiles.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Affected Files</Text>
          {proposal.riskAssessment.affectedFiles.map((file, i) => (
            <Text key={i}>  • {file}</Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">
          Press ESC to go back | a: Approve | r: Reject
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Self-Improvement Proposal List Component
 */
function ProposalListSection({
  proposals,
  loading,
  selectedIndex,
  showDetail,
}: {
  proposals: ProposalWithRisk[];
  loading: boolean;
  selectedIndex: number;
  showDetail: boolean;
}): React.ReactElement {
  if (loading) {
    return (
      <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text bold color="yellow">Pending Proposals</Text>
        <Text color="gray">Loading...</Text>
      </Box>
    );
  }

  if (proposals.length === 0) {
    return (
      <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text bold color="yellow">Pending Proposals</Text>
        <Text color="gray" italic>No pending proposals. Run self-improvement analysis to generate proposals.</Text>
      </Box>
    );
  }

  // Show detail view if selected
  if (showDetail && proposals[selectedIndex]) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <ProposalDetailView proposal={proposals[selectedIndex]} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="yellow" paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color="yellow">Pending Proposals</Text>
        <Text color="gray">{proposals.length} proposal{proposals.length !== 1 ? 's' : ''}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <ProposalListHeader />
        {proposals.map((proposal, index) => (
          <ProposalRow
            key={proposal.task.id}
            proposal={proposal}
            selected={index === selectedIndex}
          />
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color="gray">↑↓: Navigate | Enter: View details | a: Approve | r: Reject</Text>
      </Box>
    </Box>
  );
}

/**
 * Placeholder Health Overview Section
 */
function HealthOverviewSection(): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">Project Health Overview</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          Project health metrics coming soon. This section will show:
        </Text>
        <Text color="gray">  - Health scores per project</Text>
        <Text color="gray">  - Trend indicators (improving/declining)</Text>
        <Text color="gray">  - Active alerts and recommendations</Text>
      </Box>
    </Box>
  );
}

/**
 * Main HealthView component
 */
export function HealthView(): React.ReactElement {
  const [selfImprovementStatus, setSelfImprovementStatus] = useState<SelfImprovementStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<ProposalWithRisk[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [projectMap, setProjectMap] = useState<Map<string, Project>>(new Map());

  // Load projects for name lookup
  const loadProjects = useCallback(() => {
    const projects = listProjects();
    const map = new Map<string, Project>();
    for (const project of projects) {
      map.set(project.id, project);
    }
    setProjectMap(map);
    return map;
  }, []);

  // Load pending proposals with risk assessment
  const loadProposals = useCallback((projectMap: Map<string, Project>) => {
    const db = initDatabase();
    try {
      // Get pending self-improvement tasks
      const pendingTasks = db.prepare(`
        SELECT * FROM tasks
        WHERE source = 'self_improvement'
        AND approval_status = 'pending'
        ORDER BY created_at DESC
      `).all() as Array<{
        id: string;
        project_id: string;
        type: string;
        title: string;
        source: string;
        priority_score: number;
        estimated_effort: string;
        requires_approval: number;
        approval_status: string;
        status: string;
        prd_json: string | null;
        description: string | null;
        created_at: string;
        updated_at: string;
      }>;

      // Convert to Task and assess risk
      const proposalsWithRisk: ProposalWithRisk[] = pendingTasks.map(row => {
        const task: Task = {
          id: row.id,
          projectId: row.project_id,
          type: row.type as TaskType,
          title: row.title,
          source: row.source as 'self_improvement',
          priorityScore: row.priority_score,
          estimatedEffort: row.estimated_effort as Task['estimatedEffort'],
          requiresApproval: row.requires_approval === 1,
          approvalStatus: row.approval_status as Task['approvalStatus'],
          status: row.status as Task['status'],
          prdJson: row.prd_json,
          description: row.description,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };

        const project = projectMap.get(task.projectId);
        const projectPath = project?.path || '.';
        const riskAssessment = Guardrails.assessTaskRisk(task, projectPath);

        return {
          task,
          riskAssessment,
          projectName: project?.name || 'Unknown',
        };
      });

      setProposals(proposalsWithRisk);
      setProposalsLoading(false);
    } catch (error) {
      console.error('Error loading proposals:', error);
      setProposalsLoading(false);
    } finally {
      db.close();
    }
  }, []);

  // Load self-improvement data
  const loadSelfImprovementData = useCallback(() => {
    const db = initDatabase();
    try {
      // Get self-managed projects
      const selfProjects = getRegisteredSelfProjects(db);

      // Get self-improvement tasks
      const allTasks = db.prepare(`
        SELECT * FROM tasks
        WHERE source = 'self_improvement'
        ORDER BY created_at DESC
      `).all() as Array<{
        id: string;
        title: string;
        status: string;
        approval_status: string;
        updated_at: string;
        created_at: string;
      }>;

      // Calculate stats
      const proposalsInQueue = allTasks.filter(
        t => t.status === 'pending' || t.status === 'queued'
      ).length;

      const pendingApprovals = allTasks.filter(
        t => t.approval_status === 'pending'
      ).length;

      // Get last analysis time (most recent self-improvement task creation)
      const lastAnalysisTime = allTasks.length > 0 ? allTasks[0].created_at : null;

      // Get recent results (completed or failed tasks)
      const recentResults = allTasks
        .filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'running')
        .slice(0, 5)
        .map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          completedAt: t.updated_at,
        }));

      setSelfImprovementStatus({
        lastAnalysisTime,
        proposalsInQueue,
        pendingApprovals,
        recentResults,
        selfProjectsCount: selfProjects.length,
      });
      setLoading(false);
    } catch (error) {
      console.error('Error loading self-improvement data:', error);
      setLoading(false);
    } finally {
      db.close();
    }
  }, []);

  // Load all data
  const loadAllData = useCallback(() => {
    const map = loadProjects();
    loadSelfImprovementData();
    loadProposals(map);
  }, [loadProjects, loadSelfImprovementData, loadProposals]);

  // Initial load and periodic refresh
  useEffect(() => {
    loadAllData();
    // Refresh every 10 seconds
    const interval = setInterval(loadAllData, 10000);
    return () => clearInterval(interval);
  }, [loadAllData]);

  // Reset selected index when proposals change
  useEffect(() => {
    if (selectedIndex >= proposals.length && proposals.length > 0) {
      setSelectedIndex(proposals.length - 1);
    }
  }, [proposals.length, selectedIndex]);

  // Handle keyboard input
  useInput((input: string, key: Key) => {
    // Global refresh
    if (input === 'r' && !showDetail) {
      setLoading(true);
      setProposalsLoading(true);
      loadAllData();
      return;
    }

    // Navigation when not in detail view
    if (!showDetail && proposals.length > 0) {
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex(prev => Math.min(proposals.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        setShowDetail(true);
        return;
      }
    }

    // Exit detail view
    if (showDetail && key.escape) {
      setShowDetail(false);
      return;
    }
  });

  return (
    <Box flexDirection="column" padding={1} flexGrow={1}>
      <SelfImprovementSection status={selfImprovementStatus} loading={loading} />
      <ProposalListSection
        proposals={proposals}
        loading={proposalsLoading}
        selectedIndex={selectedIndex}
        showDetail={showDetail}
      />
      <HealthOverviewSection />

      {/* Footer with shortcuts */}
      <Box marginTop={1}>
        <Text color="gray">
          r: Refresh | ↑↓: Navigate proposals | Enter: View details | ESC: Back | Number keys: Switch tabs
        </Text>
      </Box>
    </Box>
  );
}
