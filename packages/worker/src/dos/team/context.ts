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
import { row, rows } from '../../lib/row.js';
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
  const telemetryRows = sql
    .exec('SELECT metric, count FROM telemetry ORDER BY count DESC LIMIT 10000')
    .toArray();

  const hosts_configured: Array<{ host_tool: string; joins: number }> = [];
  const surfaces_seen: Array<{ agent_surface: string; joins: number }> = [];
  const models_seen: Array<{ agent_model: string; count: number }> = [];
  const usage: Record<string, number> = {};

  for (const raw of telemetryRows) {
    const r = row(raw);
    const m = r.string('metric');
    const count = r.number('count');
    usage[m] = count;

    if (m.startsWith(METRIC_KEYS.HOST_PREFIX)) {
      if (hosts_configured.length < 10) {
        hosts_configured.push({
          host_tool: m.slice(METRIC_KEYS.HOST_PREFIX.length),
          joins: count,
        });
      }
    } else if (m.startsWith(METRIC_KEYS.SURFACE_PREFIX)) {
      if (surfaces_seen.length < 10) {
        surfaces_seen.push({
          agent_surface: m.slice(METRIC_KEYS.SURFACE_PREFIX.length),
          joins: count,
        });
      }
    } else if (m.startsWith(METRIC_KEYS.MODEL_PREFIX)) {
      if (models_seen.length < 10) {
        models_seen.push({
          agent_model: m.slice(METRIC_KEYS.MODEL_PREFIX.length),
          count: count,
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
      const raw = m as Record<string, unknown>;
      const r = row(m);
      const id = r.string('id');
      return {
        ...raw,
        tags: r.json<string[]>('tags', {
          default: [],
          context: `queryTeamContext memory=${id} tags`,
        }),
        categories: r.json<string[]>('categories', {
          default: [],
          context: `queryTeamContext memory=${id} categories`,
        }),
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
    const r = row(m);
    const agentId = r.string('agent_id');
    const wsConnected = connectedIds.has(agentId);
    const heartbeatActive = r.bool('heartbeat_active');
    const status: 'active' | 'offline' = wsConnected
      ? 'active'
      : heartbeatActive
        ? 'active'
        : 'offline';
    const filesRaw = r.raw('files');
    return {
      agent_id: agentId,
      handle: r.string('handle'),
      tool: r.string('host_tool') || 'unknown',
      host_tool: r.string('host_tool') || 'unknown',
      agent_surface: r.string('agent_surface') || null,
      transport: r.string('transport') || null,
      agent_model: r.string('agent_model') || null,
      status,
      framework: r.string('framework') || null,
      session_minutes: r.number('session_minutes') || null,
      seconds_since_update: r.nullableNumber('seconds_since_update'),
      minutes_since_update: r.nullableNumber('minutes_since_update'),
      signal_tier: wsConnected ? 'websocket' : heartbeatActive ? 'http' : 'none',
      activity: filesRaw
        ? {
            files: r.json<string[]>('files', {
              default: [],
              context: `queryTeamContext agent=${agentId} member files`,
            }),
            summary: r.string('summary'),
            updated_at: r.string('updated_at'),
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
  const locks = rows<ContextLockEntry>(
    sql
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
      .toArray(),
    (r) => ({
      file_path: r.string('file_path'),
      owner_handle: r.string('owner_handle'),
      tool: r.string('tool'),
      host_tool: r.string('host_tool'),
      agent_surface: r.nullableString('agent_surface'),
      minutes_held: r.number('minutes_held'),
    }),
  );

  const telemetry = getTelemetryBreakdown(sql);

  const memoryCategories: MemoryCategory[] = rows<MemoryCategory>(
    sql
      .exec(
        `SELECT id, name, description, color, created_at
       FROM memory_categories ORDER BY name ASC`,
      )
      .toArray(),
    (r) => ({
      id: r.string('id'),
      name: r.string('name'),
      description: r.string('description'),
      color: r.nullableString('color'),
      created_at: r.string('created_at'),
    }),
  );

  return {
    ok: true,
    members: memberList,
    conflicts,
    locks,
    memories,
    memory_categories: memoryCategories,
    ...telemetry,
    recentSessions: recentSessions.map((s) => {
      const raw = s as Record<string, unknown>;
      const r = row(s);
      const agentId = r.string('agent_id');
      const storedTool = r.string('host_tool');
      const toolFromAgent = storedTool || inferHostToolFromAgentId(agentId);
      return {
        ...raw,
        tool: toolFromAgent && toolFromAgent !== 'unknown' ? toolFromAgent : null,
        host_tool: storedTool || toolFromAgent || 'unknown',
        agent_surface: r.string('agent_surface') || null,
        transport: r.string('transport') || null,
        agent_model: r.string('agent_model') || null,
        files_touched: r.json<string[]>('files_touched', {
          default: [],
          context: `queryTeamContext session agent=${agentId} files_touched`,
        }),
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
  for (const raw of activities) {
    const r = row(raw);
    if (!r.nullableString('files')) continue;
    const parsedFiles = r.json<string[]>('files', {
      default: [],
      context: 'queryTeamSummary activity files',
    });
    for (const f of parsedFiles) {
      fileCounts.set(f, (fileCounts.get(f) || 0) + 1);
    }
  }
  const conflictCount = [...fileCounts.values()].filter((c) => c > 1).length;

  const memoriesCount = sql.exec('SELECT COUNT(*) as c FROM memories').toArray();
  // Memory count as of 7 days ago — pairs with current count for the projects
  // widget growth delta (current − previous). created_at default is UTC.
  const memoryCountPrev = sql
    .exec("SELECT COUNT(*) as c FROM memories WHERE created_at <= datetime('now', '-7 days')")
    .toArray();
  const live = sql.exec('SELECT COUNT(*) as c FROM sessions WHERE ended_at IS NULL').toArray();
  const recent = sql
    .exec("SELECT COUNT(*) as c FROM sessions WHERE started_at > datetime('now', '-24 hours')")
    .toArray();

  // Daily session counts for last 7 days. Worker runtime + SQLite both UTC,
  // so YYYY-MM-DD keys align across the two domains. Buckets are filled
  // oldest → newest so the sparkline renders left-to-right with time.
  const dailyRows = sql
    .exec(
      `SELECT date(started_at) AS d, COUNT(*) AS c
       FROM sessions
       WHERE date(started_at) >= date('now', '-6 days')
       GROUP BY date(started_at)`,
    )
    .toArray();
  const dailyMap = new Map<string, number>();
  for (const raw of dailyRows) {
    const r = row(raw);
    dailyMap.set(r.string('d'), r.number('c'));
  }
  const daily_sessions_7d: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    daily_sessions_7d.push(dailyMap.get(d.toISOString().slice(0, 10)) || 0);
  }

  // Conflicts hit over the last 7 days, plus the immediately-prior 7-day
  // window. Sourced from sessions.conflicts_hit (per-session counter), not
  // the live activity-overlap snapshot in `conflictCount` above — those are
  // different concepts (live contention vs. cumulative friction).
  const conflicts7d = sql
    .exec(
      `SELECT COALESCE(SUM(conflicts_hit), 0) AS c FROM sessions
       WHERE started_at > datetime('now', '-7 days')`,
    )
    .toArray();
  const conflicts7dPrev = sql
    .exec(
      `SELECT COALESCE(SUM(conflicts_hit), 0) AS c FROM sessions
       WHERE started_at > datetime('now', '-14 days')
         AND started_at <= datetime('now', '-7 days')`,
    )
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

  const active_members: ActiveMemberSummary[] = activeMembers.map((raw) => {
    const r = row(raw);
    const agentId = r.string('agent_id');
    const storedTool = r.nullableString('host_tool');
    const inferredTool = inferHostToolFromAgentId(agentId);
    const hostTool = storedTool && storedTool !== 'unknown' ? storedTool : inferredTool;
    return {
      agent_id: agentId,
      handle: r.string('handle') || 'unknown',
      host_tool: hostTool,
      agent_surface: r.string('agent_surface') || null,
      files: r.json<string[]>('files', {
        default: [],
        context: 'queryTeamSummary active_members files',
      }),
      summary: r.string('summary') || null,
      session_minutes: r.nullableNumber('session_minutes'),
      seconds_since_update: r.nullableNumber('seconds_since_update'),
    };
  });

  const activeAgentsCount = row(active[0]).number('c');

  // Canary for PR2 (web): the dashboard widget currently derives its "N live"
  // label by filtering active_members.length (phantom-filtered, LIMIT 20).
  // active_agents is a raw COUNT without those filters. They diverge when
  // phantom rows exist. Before the widget switches to binding active_agents
  // directly, collect 48h of production signal on how often divergence fires.
  // active_members.length < 20 avoids false positives from LIMIT truncation.
  if (activeAgentsCount > active_members.length && active_members.length < 20) {
    log.warn('phantom agents present in team summary', {
      active_agents: activeAgentsCount,
      active_members_length: active_members.length,
      delta: activeAgentsCount - active_members.length,
    });
  }

  return {
    ok: true,
    active_agents: activeAgentsCount,
    total_members: row(total[0]).number('c'),
    conflict_count: conflictCount,
    memory_count: row(memoriesCount[0]).number('c'),
    memory_count_previous: row(memoryCountPrev[0]).number('c'),
    live_sessions: row(live[0]).number('c'),
    recent_sessions_24h: row(recent[0]).number('c'),
    daily_sessions_7d,
    conflicts_7d: row(conflicts7d[0]).number('c'),
    conflicts_7d_previous: row(conflicts7dPrev[0]).number('c'),
    active_members,
    ...getTelemetryBreakdown(sql),
  };
}
