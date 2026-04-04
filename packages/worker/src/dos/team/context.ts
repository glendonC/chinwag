// Composite read queries that span all TeamDO tables.
// These are the two "wide" reads: getContext (full state for agents/dashboards)
// and getSummary (lightweight counts for cross-project overview).

import type {
  TeamMember,
  TeamContext,
  TeamSummary,
  ContextLockEntry,
  Memory,
  SessionInfo,
} from '../../types.js';
import { HEARTBEAT_ACTIVE_WINDOW_S } from '../../lib/constants.js';
import { createLogger } from '../../lib/logger.js';
import { safeParse } from '../../lib/safe-parse.js';
import { inferHostToolFromAgentId } from './runtime.js';

const log = createLogger('TeamDO.context');

interface TelemetryBreakdown {
  tools_configured: Array<{ tool: string; joins: number }>;
  hosts_configured: Array<{ host_tool: string; joins: number }>;
  surfaces_seen: Array<{ agent_surface: string; joins: number }>;
  models_seen: Array<{ agent_model: string; count: number }>;
  usage: Record<string, number>;
}

/** Read all telemetry metrics in one scan, then partition by prefix in JS. */
export function getTelemetryBreakdown(sql: SqlStorage): TelemetryBreakdown {
  const rows = sql.exec('SELECT metric, count FROM telemetry ORDER BY count DESC').toArray();

  const tools_configured: Array<{ tool: string; joins: number }> = [];
  const hosts_configured: Array<{ host_tool: string; joins: number }> = [];
  const surfaces_seen: Array<{ agent_surface: string; joins: number }> = [];
  const models_seen: Array<{ agent_model: string; count: number }> = [];
  const usage: Record<string, number> = {};

  for (const row of rows) {
    const r = row as { metric: string; count: number };
    const m = r.metric;
    if (m.startsWith('tool:')) {
      if (tools_configured.length < 10) {
        tools_configured.push({ tool: m.slice(5), joins: r.count });
      }
    } else {
      // All non-tool metrics go into the usage map
      usage[m] = r.count;

      if (m.startsWith('host:')) {
        if (hosts_configured.length < 10) {
          hosts_configured.push({ host_tool: m.slice(5), joins: r.count });
        }
      } else if (m.startsWith('surface:')) {
        if (surfaces_seen.length < 10) {
          surfaces_seen.push({ agent_surface: m.slice(8), joins: r.count });
        }
      } else if (m.startsWith('model:')) {
        if (models_seen.length < 10) {
          models_seen.push({ agent_model: m.slice(6), count: r.count });
        }
      }
    }
  }

  return { tools_configured, hosts_configured, surfaces_seen, models_seen, usage };
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
     LEFT JOIN sessions s ON s.agent_id = m.agent_id AND s.ended_at IS NULL`,
      HEARTBEAT_ACTIVE_WINDOW_S,
    )
    .toArray();

  const memories: Memory[] = sql
    .exec(
      `SELECT id, text, tags, handle, host_tool, agent_surface, agent_model, created_at, updated_at
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
      } as unknown as Memory;
    });

  const recentSessions = sql
    .exec(
      `
    SELECT agent_id, handle AS owner_handle, framework, host_tool, agent_surface, transport, agent_model, started_at, ended_at,
           edit_count, files_touched, conflicts_hit, memories_saved,
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
     WHERE m.last_heartbeat > datetime('now', '-' || ? || ' seconds')`,
      HEARTBEAT_ACTIVE_WINDOW_S,
    )
    .toArray() as unknown as ContextLockEntry[];

  const telemetry = getTelemetryBreakdown(sql);

  return {
    ok: true,
    members: memberList,
    conflicts,
    locks,
    memories,
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
     WHERE m.last_heartbeat > datetime('now', '-' || ? || ' seconds')`,
      HEARTBEAT_ACTIVE_WINDOW_S,
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

  return {
    ok: true,
    active_agents: ((active[0] as Record<string, unknown>)?.c as number) || 0,
    total_members: ((total[0] as Record<string, unknown>)?.c as number) || 0,
    conflict_count: conflictCount,
    memory_count: ((memoriesCount[0] as Record<string, unknown>)?.c as number) || 0,
    live_sessions: ((live[0] as Record<string, unknown>)?.c as number) || 0,
    recent_sessions_24h: ((recent[0] as Record<string, unknown>)?.c as number) || 0,
    ...getTelemetryBreakdown(sql),
  };
}
