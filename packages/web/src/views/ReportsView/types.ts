// Shared types for the Reports skeleton.
//
// Findings are the unit of value - each finding is a claim with citations
// and actions. Actions are split into three categories so the UI can
// visually distinguish "this changes chinmeister state" from "this hands you
// an artifact" from "this launches your own managed agent with context".

export type RunStatus = 'queued' | 'running' | 'complete' | 'failed';

/**
 * Which AI path a run is using.
 * - `primary`   = user's own managed agent (Claude Code / Codex / Aider)
 * - `secondary` = chinmeister-offered AI (when primary is unavailable)
 */
export type RunPath = 'primary' | 'secondary';

export interface MockRun {
  id: string;
  reportId: string;
  project: string;
  status: RunStatus;
  path: RunPath;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  findingsCount?: number;
  criticalCount?: number;
}

export type CitationType = 'session' | 'file' | 'tool_call' | 'memory' | 'conflict' | 'metric';

export interface Citation {
  type: CitationType;
  label: string;
  detail?: string;
}

/**
 * Action categories mapped to how they connect to chinmeister's architecture:
 * - `state`  = Worker-side DO write (memory, config, watcher, rule, team state)
 * - `export` = artifact the user takes with them (download, copy, draft snippet)
 * - `spawn`  = delegate to the user's managed agent (spawns a fresh session with context)
 */
export type ActionCategory = 'state' | 'export' | 'spawn';

export interface FindingAction {
  id: string;
  category: ActionCategory;
  label: string;
}

export type Severity = 'critical' | 'warning' | 'info';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  body?: string;
  citations: Citation[];
  actions: FindingAction[];
}

export interface CompletedReport {
  runId: string;
  reportId: string;
  summary: string;
  findings: Finding[];
  stats: {
    sessionsRead: number;
    filesRead: number;
    tokensUsed: number;
    estimatedCost: number;
    path: RunPath;
  };
}
