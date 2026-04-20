// Composite read queries that span all TeamDO tables.
// These are the two "wide" reads: getContext (full state for agents/dashboards)
// and getSummary (lightweight counts for cross-project overview).

import type {
  TeamMember,
  TeamContext,
  TeamSummary,
  ActiveMemberSummary,
  ContextLockEntry,
  Memory,
  MemoryCategory,
  SessionInfo,
} from '../../types.js';
import {
  HEARTBEAT_ACTIVE_WINDOW_S,
  CONTEXT_MEMBERS_LIMIT,
  CONTEXT_LOCKS_LIMIT,
  METRIC_KEYS,
} from '../../lib/constants.js';
import { createLogger } from '../../lib/logger.js';
import { safeParse } from '../../lib/safe-parse.js';
import { inferHostToolFromAgentId } from './runtime.js';

const log = createLogger('TeamDO.context');

interface TelemetryBreakdown {
  hosts_configured: Array<{ host_tool: string; joins: number }>;
  surfaces_seen: Array<{ agent_surface: string; joins: number }>;
  models_seen: Array<{ agent_model: string; count: number }>;
  usage: Record<string, number>;
}

/** Read all telemetry metrics in one scan, then partition by prefix in JS. */
export function getTelemetryBreakdown(sql: SqlStorage): TelemetryBreakdown {
  const rows = sql
    .exec('SELECT metric, count FROM telemetry ORDER BY count DESC LIMIT 10000')
    .toArray();

  const hosts_configured: Array<{ host_tool: string; joins: number }> = [];
  const surfaces_seen: Array<{ agent_surface: string; joins: number }> = [];
  const models_seen: Array<{ agent_model: string; count: number }> = [];
  const usage: Record<string, number> = {};

  for (const row of rows) {
    const r = row as { metric: string; count: number };
    const m = r.metric;
    usage[m] = r.count;

    if (m.startsWith(METRIC_KEYS.HOST_PREFIX)) {
      if (hosts_configured.length < 10) {
        hosts_configured.push({
          host_tool: m.slice(METRIC_KEYS.HOST_PREFIX.length),
          joins: r.count,
        });
      }
    } else if (m.startsWith(METRIC_KEYS.SURFACE_PREFIX)) {
      if (surfaces_seen.length < 10) {
        surfaces_seen.push({
          agent_surface: m.slice(METRIC_KEYS.SURFACE_PREFIX.length),
          joins: r.count,
        });
      }
    } else if (m.startsWith(METRIC_KEYS.MODEL_PREFIX)) {
      if (models_seen.length < 10) {
        models_seen.push({
          agent_model: m.slice(METRIC_KEYS.MODEL_PREFIX.length),
          count: r.count,
        });
      }
    }
  }

  return { hosts_configured, surfaces_seen, models_seen, usage };
}

/**
 * Full team context -- members, activities, conflicts, locks, memories, sessions, telemetry.
 */
export function queryTeamContext(
  sql: SqlStorage,
  connectedIds: Set<string>,
): TeamContext & { ok: true } {
  const members = sql
    .exec(
      `SELECT m.agent_id, m.handle, m.host_tool, m.agent_surface, m.transport, m.agent_model,
            m.last_tool_use, a.files, a.summary, a.updated_at,
            s.framework, s.started_at as session_started,
            ROUND((julianday('now') - julianday(s.started_at)) * 24 * 60) as session_minutes,
            ROUND((julianday('now') - julianday(a.updated_at)) * 86400) as seconds_since_update,
            ROUND((julianday('now') - julianday(a.updated_at)) * 1440) as minutes_since_update,
            CASE WHEN m.last_heartbeat > datetime('now', '-' || ? || ' seconds')
              THEN 1 ELSE 0 END as heartbeat_active
     FROM members m
     LEFT JOIN activities a ON a.agent_id = m.agent_id
     LEFT JOIN sessions s ON s.agent_id = m.agent_id AND s.ended_at IS NULL
     LIMIT ?`,
      HEARTBEAT_ACTIVE_WINDOW_S,
      CONTEXT_MEMBERS_LIMIT,
    )
    .toArray();

  const memories: Memory[] = sql
    .exec(
      `SELECT id, text, tags, categories, handle, host_tool, agent_surface, agent_model, session_id, created_at, updated_at, last_accessed_at
     FROM memories
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 20`,
    )
    .toArray()
    .map((m) => {
      const row = m as Record<string, unknown>;
      return {
        ...row,
        tags: safeParse(
          (row.tags as string) || '[]',
          `queryTeamContext memory=${row.id} tags`,
          [] as string[],
          log,
        ),
        categories: safeParse(
          (row.categories as string) || '[]',
          `queryTeamContext memory=${row.id} categories`,
          [] as string[],
          log,
        ),
      } as unknown as Memory;
    });

  const recentSessions = sql
    .exec(
      `
    SELECT agent_id, handle AS owner_handle, framework, host_tool, agent_surface, transport, agent_model, started_at, ended_at,
           edit_count, files_touched, conflicts_hit, memories_saved,
           outcome, outcome_summary, lines_added, lines_removed,
           ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60) as duration_minutes
    FROM sessions
    WHERE started_at > datetime('now', '-24 hours')
    ORDER BY started_at DESC
    LIMIT 20
  `,
    )
    .toArray();

  // Build member list with status resolution
  const memberList: TeamMember[] = members.map((m) => {
    const row = m as Record<string, unknown>;
    const wsConnected = connectedIds.has(row.agent_id as string);
    const status: 'active' | 'offline' = wsConnected
      ? 'active'
      : row.heartbeat_active
        ? 'active'
        : 'offline';
    return {
      agent_id: row.agent_id as string,
      handle: row.handle as string,
      tool: (row.host_tool as string) || 'unknown',
      host_tool: (row.host_tool as string) || 'unknown',
      agent_surface: (row.agent_surface as string) || null,
      transport: (row.transport as string) || null,
      agent_model: (row.agent_model as string) || null,
      status,
      framework: (row.framework as string) || null,
      session_minutes: (row.session_minutes as number) || null,
      seconds_since_update:
        row.seconds_since_update != null ? (row.seconds_since_update as number) : null,
      minutes_since_update:
        row.minutes_since_update != null ? (row.minutes_since_update as number) : null,
      signal_tier: wsConnected ? 'websocket' : row.heartbeat_active ? 'http' : 'none',
      activity: row.files
        ? {
            files: safeParse(
              row.files as string,
              `queryTeamContext agent=${row.agent_id} member files`,
              [] as string[],
              log,
            ),
            summary: row.summary as string,
            updated_at: row.updated_at as string,
          }
        : null,
    };
  });

  // Server-side conflict detection -- single source of truth
  const conflicts: Array<{ file: string; agents: string[] }> = [];
  const fileOwners = new Map<string, Array<{ handle: string; tool: string }>>();
  for (const m of memberList) {
    if (m.status !== 'active' || !m.activity?.files) continue;
    for (const f of m.activity.files) {
      if (!fileOwners.has(f)) fileOwners.set(f, []);
      fileOwners.get(f)!.push({ handle: m.handle, tool: m.tool || 'unknown' });
    }
  }
  for (const [file, owners] of fileOwners) {
    if (owners.length > 1) {
      conflicts.push({
        file,
        agents: owners.map((o) => (o.tool !== 'unknown' ? `${o.handle} (${o.tool})` : o.handle)),
      });
    }
  }

  // Active file locks
  const locks = sql
    .exec(
      `SELECT l.file_path, l.handle AS owner_handle, l.host_tool AS tool, l.host_tool, l.agent_surface,
            ROUND((julianday('now') - julianday(l.claimed_at)) * 1440) as minutes_held
     FROM locks l
     JOIN members m ON m.agent_id = l.agent_id
     WHERE m.last_heartbeat > datetime('now', '-' || ? || ' seconds')
     LIMIT ?`,
      HEARTBEAT_ACTIVE_WINDOW_S,
      CONTEXT_LOCKS_LIMIT,
    )
    .toArray() as unknown as ContextLockEntry[];

  const telemetry = getTelemetryBreakdown(sql);

  const memoryCategories: MemoryCategory[] = sql
    .exec(
      `SELECT id, name, description, color, created_at
       FROM memory_categories ORDER BY name ASC`,
    )
    .toArray() as unknown as MemoryCategory[];

  return {
    ok: true,
    members: memberList,
    conflicts,
    locks,
    memories,
    memory_categories: memoryCategories,
    ...telemetry,
    recentSessions: recentSessions.map((s) => {
      const row = s as Record<string, unknown>;
      const toolFromAgent =
        (row.host_tool as string) || inferHostToolFromAgentId(row.agent_id as string);
      return {
        ...row,
        tool: toolFromAgent && toolFromAgent !== 'unknown' ? toolFromAgent : null,
        host_tool: (row.host_tool as string) || toolFromAgent || 'unknown',
        agent_surface: (row.agent_surface as string) || null,
        transport: (row.transport as string) || null,
        agent_model: (row.agent_model as string) || null,
        files_touched: safeParse(
          (row.files_touched as string) || '[]',
          `queryTeamContext session agent=${row.agent_id} files_touched`,
          [] as string[],
          log,
        ),
      } as unknown as SessionInfo;
    }),
  };
}

/**
 * Lightweight team summary -- counts only, for cross-project dashboard.
 */
export function queryTeamSummary(sql: SqlStorage): TeamSummary & TelemetryBreakdown & { ok: true } {
  const active = sql
    .exec(
      `SELECT COUNT(*) as c FROM members
     WHERE last_heartbeat > datetime('now', '-' || ? || ' seconds')`,
      HEARTBEAT_ACTIVE_WINDOW_S,
    )
    .toArray();

  const total = sql.exec('SELECT COUNT(*) as c FROM members').toArray();

  // Conflict count: files claimed by 2+ active agents
  const activities = sql
    .exec(
      `SELECT a.files FROM activities a
     JOIN members m ON m.agent_id = a.agent_id
     WHERE m.last_heartbeat > datetime('now', '-' || ? || ' seconds')
     LIMIT ?`,
      HEARTBEAT_ACTIVE_WINDOW_S,
      CONTEXT_MEMBERS_LIMIT,
    )
    .toArray();

  const fileCounts = new Map<string, number>();
  for (const row of activities) {
    const r = row as Record<string, unknown>;
    if (!r.files) continue;
    const parsedFiles = safeParse(
      r.files as string,
      'queryTeamSummary activity files',
      [] as string[],
      log,
    );
    for (const f of parsedFiles) {
      fileCounts.set(f, (fileCounts.get(f) || 0) + 1);
    }
  }
  const conflictCount = [...fileCounts.values()].filter((c) => c > 1).length;

  const memoriesCount = sql.exec('SELECT COUNT(*) as c FROM memories').toArray();
  const live = sql.exec('SELECT COUNT(*) as c FROM sessions WHERE ended_at IS NULL').toArray();
  const recent = sql
    .exec("SELECT COUNT(*) as c FROM sessions WHERE started_at > datetime('now', '-24 hours')")
    .toArray();

  // Active member details for the overview agents panel.
  // Phantom filter: a row is phantom when BOTH the stored host_tool is
  // missing/unknown AND the agent_id prefix is missing/unknown. Rows where
  // detection failed but the agent_id prefix is meaningful (e.g.
  // 'claude-code:abc:def' with host_tool='unknown') used to be dropped here,
  // which hid legitimate CC instances whose MCP handshake hadn't populated
  // host_tool by join time. The mapper below recovers host_tool from the
  // agent_id prefix in that case. ORDER BY last_heartbeat DESC so the
  // LIMIT 20 truncation is deterministic.
  const activeMembers = sql
    .exec(
      `SELECT m.agent_id, m.handle, m.host_tool, m.agent_surface,
              a.files, a.summary,
              ROUND((julianday('now') - julianday(s.started_at)) * 24 * 60) as session_minutes,
              ROUND((julianday('now') - julianday(m.last_heartbeat)) * 86400) as seconds_since_update
       FROM members m
       LEFT JOIN activities a ON a.agent_id = m.agent_id
       LEFT JOIN sessions s ON s.agent_id = m.agent_id AND s.ended_at IS NULL
       WHERE m.last_heartbeat > datetime('now', '-' || ? || ' seconds')
         AND (
           (m.host_tool IS NOT NULL AND m.host_tool != 'unknown')
           OR (instr(m.agent_id, ':') > 0
               AND substr(m.agent_id, 1, instr(m.agent_id, ':') - 1) != 'unknown')
         )
       ORDER BY m.last_heartbeat DESC
       LIMIT 20`,
      HEARTBEAT_ACTIVE_WINDOW_S,
    )
    .toArray();

  const active_members: ActiveMemberSummary[] = activeMembers.map((row) => {
    const r = row as Record<string, unknown>;
    const storedTool = r.host_tool as string | null;
    const inferredTool = inferHostToolFromAgentId(r.agent_id as string);
    const hostTool = storedTool && storedTool !== 'unknown' ? storedTool : inferredTool;
    return {
      agent_id: r.agent_id as string,
      handle: (r.handle as string) || 'unknown',
      host_tool: hostTool,
      agent_surface: (r.agent_surface as string) || null,
      files: safeParse(
        (r.files as string) || '[]',
        'queryTeamSummary active_members files',
        [] as string[],
        log,
      ),
      summary: (r.summary as string) || null,
      session_minutes: r.session_minutes != null ? (r.session_minutes as number) : null,
      seconds_since_update:
        r.seconds_since_update != null ? (r.seconds_since_update as number) : null,
    };
  });

  return {
    ok: true,
    active_agents: ((active[0] as Record<string, unknown>)?.c as number) || 0,
    total_members: ((total[0] as Record<string, unknown>)?.c as number) || 0,
    conflict_count: conflictCount,
    memory_count: ((memoriesCount[0] as Record<string, unknown>)?.c as number) || 0,
    live_sessions: ((live[0] as Record<string, unknown>)?.c as number) || 0,
    recent_sessions_24h: ((recent[0] as Record<string, unknown>)?.c as number) || 0,
    active_members,
    ...getTelemetryBreakdown(sql),
  };
}
