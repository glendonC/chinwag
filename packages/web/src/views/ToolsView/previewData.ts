// Preview data for Tools sections before real data flows through.
// When a section receives an empty live dataset, it falls back to these
// values and shows a "Preview" badge so the reader sees what the view
// looks like under real conditions. When real data arrives, the preview
// is replaced automatically - no flags, no toggles, no dead code path.
//
// Keep these numbers realistic: 3 tools with differentiated work-type
// mixes plus a small set of files co-edited across those tools to feed
// the shared-file stream section.

import type { ToolCallCategory } from '@chinmeister/shared/tool-call-categories.js';
import type { ToolDailyTrend, ToolHandoff, ToolWorkTypeBreakdown } from '../../lib/apiSchemas.js';
import { normalizeToolId } from '../../lib/toolMeta.js';

// Helper so each row reads as a five-tuple (tool, type, sessions, edits, rate)
// without forcing fixture authors to recompute `completed` by hand. The rate
// reflects each tool's fit narrative (Claude Code wins frontend, Cursor wins
// styling, Codex wins backend) so the heatmap viz reads as designed in
// preview mode.
function wt(
  host_tool: string,
  work_type: string,
  sessions: number,
  edits: number,
  completion_rate: number,
): ToolWorkTypeBreakdown {
  return {
    host_tool,
    work_type,
    sessions,
    edits,
    completed: Math.round((completion_rate / 100) * sessions),
    completion_rate,
  };
}

export const PREVIEW_TOOL_WORK_TYPE: ToolWorkTypeBreakdown[] = [
  // Claude Code - frontend-heavy, some backend, some styling
  wt('claude-code', 'frontend', 58, 412, 82),
  wt('claude-code', 'backend', 26, 198, 73),
  wt('claude-code', 'styling', 19, 141, 58),
  wt('claude-code', 'test', 13, 87, 71),
  wt('claude-code', 'docs', 7, 34, 88),
  wt('claude-code', 'config', 4, 19, 75),
  wt('claude-code', 'other', 2, 8, 50),

  // Cursor - styling specialist
  wt('cursor', 'styling', 26, 134, 84),
  wt('cursor', 'frontend', 16, 97, 76),
  wt('cursor', 'backend', 13, 64, 39),
  wt('cursor', 'docs', 9, 22, 78),
  wt('cursor', 'test', 6, 28, 50),
  wt('cursor', 'config', 2, 7, 50),
  wt('cursor', 'other', 2, 5, 50),

  // Codex - backend-dominant, heavy on config
  wt('codex', 'backend', 12, 83, 75),
  wt('codex', 'config', 6, 28, 67),
  wt('codex', 'frontend', 5, 31, 40),
  wt('codex', 'styling', 3, 14, 33),
  wt('codex', 'test', 2, 8, 50),
  wt('codex', 'docs', 2, 4, 50),
  wt('codex', 'other', 1, 2, 0),
];

// ── Shared file stream ──
// Per-file edit timelines where multiple tools have touched the same
// file. This is the raw shape of cross-tool coordination at the file
// grain - the list-view section computes handoff delta, tightest pair,
// and everything else from these events, so every stat stays honest
// against whatever shapes we mock in here.

export type FileEditOutcome = 'completed' | 'abandoned' | 'failed';

export interface FileEditEvent {
  tool: string;
  timestamp: string; // ISO - sequence order is what matters for the viz
  sessionId: string;
  sessionMinutes: number;
  handle: string;
  outcome: FileEditOutcome;
  hadConflict: boolean;
  lockContested: boolean;
  linesAdded: number;
  linesRemoved: number;
  summary: string;
}

export interface SharedFile {
  filePath: string;
  projectLabel: string;
  edits: FileEditEvent[];
}

export const PREVIEW_SHARED_FILES: SharedFile[] = [
  {
    filePath: 'packages/worker/src/auth/middleware.ts',
    projectLabel: 'chinmeister-api',
    edits: [
      {
        tool: 'claude-code',
        timestamp: '2026-04-07T09:14:00Z',
        sessionId: 's-a01',
        sessionMinutes: 42,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 28,
        linesRemoved: 6,
        summary: 'Add JWT validation layer',
      },
      {
        tool: 'cursor',
        timestamp: '2026-04-07T14:02:00Z',
        sessionId: 's-a02',
        sessionMinutes: 18,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 6,
        linesRemoved: 2,
        summary: 'Fix typo in error message',
      },
      {
        tool: 'claude-code',
        timestamp: '2026-04-08T10:30:00Z',
        sessionId: 's-a03',
        sessionMinutes: 64,
        handle: 'mira',
        outcome: 'abandoned',
        hadConflict: true,
        lockContested: true,
        linesAdded: 0,
        linesRemoved: 0,
        summary: 'Refactor attempt - hit file lock from cursor',
      },
      {
        tool: 'codex',
        timestamp: '2026-04-08T11:15:00Z',
        sessionId: 's-a04',
        sessionMinutes: 31,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 14,
        linesRemoved: 22,
        summary: 'Extract helper function',
      },
      {
        tool: 'claude-code',
        timestamp: '2026-04-09T08:45:00Z',
        sessionId: 's-a05',
        sessionMinutes: 52,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 34,
        linesRemoved: 4,
        summary: 'Add session binding',
      },
      {
        tool: 'cursor',
        timestamp: '2026-04-10T16:20:00Z',
        sessionId: 's-a06',
        sessionMinutes: 12,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 3,
        linesRemoved: 1,
        summary: 'Update comment',
      },
      {
        tool: 'claude-code',
        timestamp: '2026-04-11T11:02:00Z',
        sessionId: 's-a07',
        sessionMinutes: 28,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 18,
        linesRemoved: 3,
        summary: 'Tighten audience check',
      },
    ],
  },
  {
    filePath: 'packages/web/src/App.tsx',
    projectLabel: 'chinmeister-web',
    edits: [
      {
        tool: 'claude-code',
        timestamp: '2026-04-06T10:00:00Z',
        sessionId: 's-b01',
        sessionMinutes: 35,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 42,
        linesRemoved: 18,
        summary: 'Route scaffold + query params',
      },
      {
        tool: 'cursor',
        timestamp: '2026-04-06T13:45:00Z',
        sessionId: 's-b02',
        sessionMinutes: 22,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 12,
        linesRemoved: 3,
        summary: 'Swap layout primitives',
      },
      {
        tool: 'claude-code',
        timestamp: '2026-04-07T09:30:00Z',
        sessionId: 's-b03',
        sessionMinutes: 48,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 26,
        linesRemoved: 9,
        summary: 'Wire sidebar + track transitions',
      },
      {
        tool: 'cursor',
        timestamp: '2026-04-08T15:10:00Z',
        sessionId: 's-b04',
        sessionMinutes: 15,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 4,
        linesRemoved: 2,
        summary: 'Hotkey tweak',
      },
      {
        tool: 'claude-code',
        timestamp: '2026-04-09T11:45:00Z',
        sessionId: 's-b05',
        sessionMinutes: 72,
        handle: 'mira',
        outcome: 'abandoned',
        hadConflict: false,
        lockContested: false,
        linesAdded: 0,
        linesRemoved: 0,
        summary: 'Routing rewrite - rolled back',
      },
      {
        tool: 'cursor',
        timestamp: '2026-04-10T10:05:00Z',
        sessionId: 's-b06',
        sessionMinutes: 19,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 8,
        linesRemoved: 5,
        summary: 'Split header into own component',
      },
      {
        tool: 'claude-code',
        timestamp: '2026-04-11T08:20:00Z',
        sessionId: 's-b07',
        sessionMinutes: 40,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 18,
        linesRemoved: 6,
        summary: 'Finish sidebar wiring',
      },
    ],
  },
  {
    filePath: 'packages/worker/src/dos/team/analytics.ts',
    projectLabel: 'chinmeister-api',
    edits: [
      {
        tool: 'claude-code',
        timestamp: '2026-04-05T10:30:00Z',
        sessionId: 's-c01',
        sessionMinutes: 58,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 84,
        linesRemoved: 12,
        summary: 'Add tool_handoffs query',
      },
      {
        tool: 'codex',
        timestamp: '2026-04-06T11:00:00Z',
        sessionId: 's-c02',
        sessionMinutes: 36,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 28,
        linesRemoved: 34,
        summary: 'Extract helper for research-to-edit ratio',
      },
      {
        tool: 'claude-code',
        timestamp: '2026-04-07T14:15:00Z',
        sessionId: 's-c03',
        sessionMinutes: 65,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 52,
        linesRemoved: 18,
        summary: 'Wire zod schema to worker output',
      },
      {
        tool: 'codex',
        timestamp: '2026-04-08T09:40:00Z',
        sessionId: 's-c04',
        sessionMinutes: 24,
        handle: 'mira',
        outcome: 'failed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 0,
        linesRemoved: 0,
        summary: 'Type error in handoff query',
      },
      {
        tool: 'claude-code',
        timestamp: '2026-04-08T12:30:00Z',
        sessionId: 's-c05',
        sessionMinutes: 44,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 22,
        linesRemoved: 8,
        summary: 'Fix type error, land query',
      },
    ],
  },
  {
    filePath: 'packages/mcp/lib/tools/memory.js',
    projectLabel: 'chinmeister-api',
    edits: [
      {
        tool: 'claude-code',
        timestamp: '2026-04-06T14:00:00Z',
        sessionId: 's-d01',
        sessionMinutes: 32,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 36,
        linesRemoved: 4,
        summary: 'Add delete_memories_batch tool',
      },
      {
        tool: 'cursor',
        timestamp: '2026-04-07T10:45:00Z',
        sessionId: 's-d02',
        sessionMinutes: 14,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 8,
        linesRemoved: 2,
        summary: 'Tighten arg validation',
      },
      {
        tool: 'claude-code',
        timestamp: '2026-04-09T09:15:00Z',
        sessionId: 's-d03',
        sessionMinutes: 42,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 26,
        linesRemoved: 14,
        summary: 'Freeform tags rewrite',
      },
    ],
  },
  {
    filePath: 'packages/web/src/views/OverviewView/OverviewView.tsx',
    projectLabel: 'chinmeister-web',
    edits: [
      {
        tool: 'cursor',
        timestamp: '2026-04-05T12:00:00Z',
        sessionId: 's-e01',
        sessionMinutes: 28,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 42,
        linesRemoved: 18,
        summary: 'Drag-and-drop grid',
      },
      {
        tool: 'claude-code',
        timestamp: '2026-04-06T10:15:00Z',
        sessionId: 's-e02',
        sessionMinutes: 56,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 68,
        linesRemoved: 24,
        summary: 'Widget catalog integration',
      },
      {
        tool: 'cursor',
        timestamp: '2026-04-07T16:40:00Z',
        sessionId: 's-e03',
        sessionMinutes: 21,
        handle: 'mira',
        outcome: 'abandoned',
        hadConflict: true,
        lockContested: true,
        linesAdded: 0,
        linesRemoved: 0,
        summary: 'Rolled back - lock held by claude',
      },
      {
        tool: 'claude-code',
        timestamp: '2026-04-08T14:10:00Z',
        sessionId: 's-e04',
        sessionMinutes: 48,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 38,
        linesRemoved: 16,
        summary: 'Finish widget rubric hooks',
      },
      {
        tool: 'cursor',
        timestamp: '2026-04-10T11:30:00Z',
        sessionId: 's-e05',
        sessionMinutes: 24,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 14,
        linesRemoved: 6,
        summary: 'CSS polish pass',
      },
    ],
  },
  {
    filePath: 'packages/cli/lib/dashboard.jsx',
    projectLabel: 'chinmeister-api',
    edits: [
      {
        tool: 'claude-code',
        timestamp: '2026-04-05T15:30:00Z',
        sessionId: 's-f01',
        sessionMinutes: 38,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 52,
        linesRemoved: 22,
        summary: 'New agent row component',
      },
      {
        tool: 'cursor',
        timestamp: '2026-04-07T11:20:00Z',
        sessionId: 's-f02',
        sessionMinutes: 12,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 6,
        linesRemoved: 3,
        summary: 'Color palette tweak',
      },
      {
        tool: 'claude-code',
        timestamp: '2026-04-10T09:00:00Z',
        sessionId: 's-f03',
        sessionMinutes: 45,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 22,
        linesRemoved: 8,
        summary: 'Adaptive polling fallback',
      },
    ],
  },
  {
    filePath: 'docs/ARCHITECTURE.md',
    projectLabel: 'chinmeister-api',
    edits: [
      {
        tool: 'claude-code',
        timestamp: '2026-04-04T16:00:00Z',
        sessionId: 's-g01',
        sessionMinutes: 72,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 124,
        linesRemoved: 42,
        summary: 'Code map rewrite',
      },
      {
        tool: 'cursor',
        timestamp: '2026-04-06T10:30:00Z',
        sessionId: 's-g02',
        sessionMinutes: 8,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 6,
        linesRemoved: 2,
        summary: 'Typo + link fix',
      },
    ],
  },
  {
    filePath: 'scripts/migrate.sh',
    projectLabel: 'chinmeister-api',
    edits: [
      {
        tool: 'codex',
        timestamp: '2026-04-05T09:00:00Z',
        sessionId: 's-h01',
        sessionMinutes: 18,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 24,
        linesRemoved: 8,
        summary: 'Add db migration runner',
      },
      {
        tool: 'claude-code',
        timestamp: '2026-04-06T13:40:00Z',
        sessionId: 's-h02',
        sessionMinutes: 32,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 16,
        linesRemoved: 12,
        summary: 'Wire env var checks',
      },
      {
        tool: 'codex',
        timestamp: '2026-04-08T15:20:00Z',
        sessionId: 's-h03',
        sessionMinutes: 14,
        handle: 'mira',
        outcome: 'failed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 0,
        linesRemoved: 0,
        summary: 'Bash syntax error - exit nonzero',
      },
      {
        tool: 'claude-code',
        timestamp: '2026-04-08T16:00:00Z',
        sessionId: 's-h04',
        sessionMinutes: 22,
        handle: 'mira',
        outcome: 'completed',
        hadConflict: false,
        lockContested: false,
        linesAdded: 8,
        linesRemoved: 4,
        summary: 'Fix bash quoting',
      },
    ],
  },
];

// ── Tool handoff pairs ──
// Computed deterministically from PREVIEW_SHARED_FILES using the same
// 24h-adjacency rule as the server query. Any change to the file mock
// automatically propagates - there are no hand-written numbers here.

const HANDOFF_WINDOW_MS = 24 * 60 * 60 * 1000;

interface TransitionSample {
  fromTool: string;
  toTool: string;
  file: string;
  gapMs: number;
  bTimestamp: string;
  bOutcome: FileEditOutcome;
  bSessionId: string;
}

function collectTransitions(files: SharedFile[]): TransitionSample[] {
  const out: TransitionSample[] = [];
  for (const f of files) {
    const edits = [...f.edits].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    for (let i = 0; i < edits.length; i++) {
      for (let j = i + 1; j < edits.length; j++) {
        const a = edits[i];
        const b = edits[j];
        if (normalizeToolId(a.tool) === normalizeToolId(b.tool)) continue;
        const gap = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        if (gap <= 0 || gap > HANDOFF_WINDOW_MS) continue;
        out.push({
          fromTool: normalizeToolId(a.tool),
          toTool: normalizeToolId(b.tool),
          file: f.filePath,
          gapMs: gap,
          bTimestamp: b.timestamp,
          bOutcome: b.outcome,
          bSessionId: b.sessionId,
        });
      }
    }
  }
  return out;
}

function derivePreviewHandoffs(files: SharedFile[]): ToolHandoff[] {
  const transitions = collectTransitions(files);
  const byPair = new Map<string, TransitionSample[]>();
  for (const t of transitions) {
    const key = `${t.fromTool}:${t.toTool}`;
    const list = byPair.get(key) ?? [];
    list.push(t);
    byPair.set(key, list);
  }

  const pairs: ToolHandoff[] = [];
  for (const [key, list] of byPair.entries()) {
    const [fromTool, toTool] = key.split(':');
    const distinctFiles = new Set(list.map((t) => t.file));
    const distinctSessions = new Set(list.map((t) => t.bSessionId));
    const completedSessions = new Set(
      list.filter((t) => t.bOutcome === 'completed').map((t) => t.bSessionId),
    );
    const avgGapMinutes =
      list.reduce((sum, t) => sum + t.gapMs / 60000, 0) / Math.max(list.length, 1);

    // Per-file rollup, newest first, capped at 20.
    const perFile = new Map<
      string,
      {
        file_path: string;
        last_transition_at: string;
        a_edits: number;
        b_edits: number;
        completed: boolean;
      }
    >();
    for (const t of list) {
      const existing = perFile.get(t.file) ?? {
        file_path: t.file,
        last_transition_at: t.bTimestamp,
        a_edits: 0,
        b_edits: 0,
        completed: false,
      };
      if (t.bTimestamp > existing.last_transition_at) {
        existing.last_transition_at = t.bTimestamp;
      }
      if (t.bOutcome === 'completed') existing.completed = true;
      perFile.set(t.file, existing);
    }
    // Count a_edits / b_edits from the original edit list.
    const touchedFiles = new Set(list.map((t) => t.file));
    for (const f of files) {
      if (!touchedFiles.has(f.filePath)) continue;
      const entry = perFile.get(f.filePath);
      if (!entry) continue;
      for (const edit of f.edits) {
        const norm = normalizeToolId(edit.tool);
        if (norm === fromTool) entry.a_edits++;
        else if (norm === toTool) entry.b_edits++;
      }
    }
    const recent = [...perFile.values()]
      .sort((a, b) => b.last_transition_at.localeCompare(a.last_transition_at))
      .slice(0, 20);

    pairs.push({
      from_tool: fromTool,
      to_tool: toTool,
      file_count: distinctFiles.size,
      handoff_completion_rate:
        Math.round((completedSessions.size / distinctSessions.size) * 1000) / 10,
      avg_gap_minutes: Math.round(avgGapMinutes),
      recent_files: recent,
    });
  }

  return pairs.sort((a, b) => b.file_count - a.file_count);
}

export const PREVIEW_TOOL_HANDOFFS: ToolHandoff[] = derivePreviewHandoffs(PREVIEW_SHARED_FILES);

// ── Stack evolution ──
// Synthesized 30-day daily session curve per tool, anchored to today so
// the preview always aligns with the chart's rolling window. Tells a
// shape-story: Claude Code is the steady workhorse, Cursor is a medium
// secondary, Codex ramps up partway through the window. No random - the
// curves are deterministic arrays so preview renders identically on
// every mount.

const PREVIEW_EVOLUTION_DAYS = 30;

// Per-tool fixed 30-day arrays, indexed from oldest (idx 0) → today (idx 29).
// Curves stay loose-realistic: weekend dips, occasional zero-days, Codex
// entering the stack partway through.
const PREVIEW_EVOLUTION_CURVE: Record<string, number[]> = {
  'claude-code': [
    4, 5, 3, 0, 2, 6, 5, 4, 7, 3, 5, 6, 2, 0, 4, 5, 8, 6, 3, 5, 4, 2, 6, 7, 5, 3, 4, 6, 5, 4,
  ],
  cursor: [
    1, 2, 0, 0, 1, 3, 2, 1, 2, 1, 0, 2, 3, 0, 1, 2, 2, 1, 0, 1, 3, 2, 1, 2, 1, 1, 2, 3, 1, 2,
  ],
  codex: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 2, 1, 0, 2, 1, 2, 1, 3, 2, 1, 2, 2, 1, 2],
};

function evolutionDayRange(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function derivePreviewToolDaily(): ToolDailyTrend[] {
  const days = evolutionDayRange(PREVIEW_EVOLUTION_DAYS);
  const out: ToolDailyTrend[] = [];
  for (const [toolId, curve] of Object.entries(PREVIEW_EVOLUTION_CURVE)) {
    for (let i = 0; i < days.length; i++) {
      const sessions = curve[i] ?? 0;
      if (sessions <= 0) continue;
      out.push({
        host_tool: toolId,
        day: days[i],
        sessions,
        edits: sessions * 8,
        lines_added: sessions * 36,
        lines_removed: sessions * 14,
        avg_duration_min: 22,
      });
    }
  }
  return out;
}

export const PREVIEW_TOOL_DAILY: ToolDailyTrend[] = derivePreviewToolDaily();

// ── Tool × Model effectiveness ──
// The join of host_tool and agent_model. DATA_MAP Tier 1 insight.
// Completion rate per (tool, model) cell. Only chinmeister can render this.
export interface ToolModelCell {
  toolId: string;
  model: string;
  sessions: number;
  completionRate: number;
}

export const PREVIEW_MODELS = ['claude-sonnet-4-5', 'claude-opus-4-6', 'gpt-5.1'] as const;

export const PREVIEW_TOOL_MODEL: ToolModelCell[] = [
  { toolId: 'claude-code', model: 'claude-sonnet-4-5', sessions: 68, completionRate: 84 },
  { toolId: 'claude-code', model: 'claude-opus-4-6', sessions: 49, completionRate: 91 },
  { toolId: 'claude-code', model: 'gpt-5.1', sessions: 12, completionRate: 58 },
  { toolId: 'cursor', model: 'claude-sonnet-4-5', sessions: 38, completionRate: 74 },
  { toolId: 'cursor', model: 'claude-opus-4-6', sessions: 8, completionRate: 62 },
  { toolId: 'cursor', model: 'gpt-5.1', sessions: 28, completionRate: 69 },
  { toolId: 'codex', model: 'claude-sonnet-4-5', sessions: 4, completionRate: 50 },
  { toolId: 'codex', model: 'claude-opus-4-6', sessions: 2, completionRate: 50 },
  { toolId: 'codex', model: 'gpt-5.1', sessions: 25, completionRate: 72 },
];

// ── Drill-in: internal tool usage ──
// What tools each coding agent invokes during a session.
// Row = an internal tool (Read, Edit, Bash, Grep, chinmeister_save_memory, etc.).
export interface InternalToolUsage {
  name: string;
  category: ToolCallCategory;
  calls: number;
  errorRate: number;
  avgMs: number;
}

export interface DrillInternalUsage {
  researchToEditRatio: number;
  topTools: InternalToolUsage[];
}

export const PREVIEW_INTERNAL_USAGE: Record<string, DrillInternalUsage> = {
  'claude-code': {
    researchToEditRatio: 4.2,
    topTools: [
      { name: 'Read', category: 'research', calls: 2143, errorRate: 1.2, avgMs: 42 },
      { name: 'Edit', category: 'edit', calls: 512, errorRate: 6.8, avgMs: 68 },
      { name: 'Grep', category: 'research', calls: 398, errorRate: 0.5, avgMs: 118 },
      { name: 'Bash', category: 'exec', calls: 287, errorRate: 11.4, avgMs: 1640 },
      { name: 'Glob', category: 'research', calls: 164, errorRate: 0.0, avgMs: 52 },
      { name: 'Write', category: 'edit', calls: 41, errorRate: 2.4, avgMs: 88 },
      { name: 'chinmeister_save_memory', category: 'memory', calls: 22, errorRate: 0.0, avgMs: 95 },
    ],
  },
  cursor: {
    researchToEditRatio: 1.8,
    topTools: [
      { name: 'Read', category: 'research', calls: 621, errorRate: 0.8, avgMs: 38 },
      { name: 'Edit', category: 'edit', calls: 344, errorRate: 4.2, avgMs: 72 },
      { name: 'Grep', category: 'research', calls: 142, errorRate: 0.0, avgMs: 105 },
      { name: 'Bash', category: 'exec', calls: 88, errorRate: 9.1, avgMs: 1320 },
    ],
  },
  codex: {
    researchToEditRatio: 2.9,
    topTools: [
      { name: 'Read', category: 'research', calls: 287, errorRate: 2.1, avgMs: 45 },
      { name: 'Edit', category: 'edit', calls: 98, errorRate: 5.1, avgMs: 81 },
      { name: 'Bash', category: 'exec', calls: 62, errorRate: 14.5, avgMs: 1780 },
      { name: 'Grep', category: 'research', calls: 45, errorRate: 0.0, avgMs: 125 },
    ],
  },
};

// ── Drill-in: session shape timeline ──
// A representative session's tool-call sequence. Used for visual replay.
export interface SessionEvent {
  tool: string;
  category: ToolCallCategory;
  offsetSec: number;
  durationMs: number;
  isError: boolean;
}

function buildSessionShape(seed: number): SessionEvent[] {
  const events: SessionEvent[] = [];
  const pattern: [string, SessionEvent['category'], number][] = [
    ['Read', 'research', 40],
    ['Read', 'research', 45],
    ['Grep', 'research', 110],
    ['Read', 'research', 38],
    ['Read', 'research', 44],
    ['Edit', 'edit', 72],
    ['Read', 'research', 42],
    ['Bash', 'exec', 1450],
    ['Read', 'research', 39],
    ['Edit', 'edit', 85],
    ['Read', 'research', 41],
    ['Grep', 'research', 98],
    ['Read', 'research', 37],
    ['Edit', 'edit', 64],
    ['Bash', 'exec', 1880],
    ['Read', 'research', 43],
    ['Edit', 'edit', 71],
    ['chinmeister_save_memory', 'memory', 92],
    ['Read', 'research', 38],
    ['Edit', 'edit', 76],
  ];
  let t = 0;
  for (let i = 0; i < pattern.length; i++) {
    const [tool, category, durationMs] = pattern[i];
    const gap = 2 + ((seed + i * 7) % 9);
    t += gap;
    events.push({
      tool,
      category,
      offsetSec: t,
      durationMs,
      isError: (seed + i) % 17 === 0,
    });
  }
  return events;
}

export const PREVIEW_SESSION_SHAPES: Record<string, SessionEvent[]> = {
  'claude-code': buildSessionShape(3),
  cursor: buildSessionShape(11),
  codex: buildSessionShape(23),
};

// ── Drill-in: scope complexity ──
// How many files a typical session on this tool touches.
export interface ScopeBucket {
  label: string;
  sessions: number;
  completionRate: number;
}

export const PREVIEW_SCOPE_COMPLEXITY: Record<string, ScopeBucket[]> = {
  'claude-code': [
    { label: '1 file', sessions: 22, completionRate: 95 },
    { label: '2–5 files', sessions: 61, completionRate: 88 },
    { label: '6–15 files', sessions: 34, completionRate: 71 },
    { label: '16+ files', sessions: 12, completionRate: 42 },
  ],
  cursor: [
    { label: '1 file', sessions: 38, completionRate: 89 },
    { label: '2–5 files', sessions: 26, completionRate: 73 },
    { label: '6–15 files', sessions: 8, completionRate: 50 },
    { label: '16+ files', sessions: 2, completionRate: 0 },
  ],
  codex: [
    { label: '1 file', sessions: 5, completionRate: 80 },
    { label: '2–5 files', sessions: 14, completionRate: 71 },
    { label: '6–15 files', sessions: 10, completionRate: 60 },
    { label: '16+ files', sessions: 2, completionRate: 50 },
  ],
};
