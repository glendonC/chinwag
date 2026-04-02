// Composite read queries that span all TeamDO tables.
// These are the two "wide" reads: getContext (full state for agents/dashboards)
// and getSummary (lightweight counts for cross-project overview).

import { HEARTBEAT_ACTIVE_WINDOW_S } from '../../lib/constants.js';
import { inferHostToolFromAgentId } from './runtime.js';

/** Read all telemetry metrics, grouped by type. */
export function getTelemetryBreakdown(sql) {
  const toolMetrics = sql.exec(
    "SELECT metric, count FROM telemetry WHERE metric LIKE 'tool:%' ORDER BY count DESC LIMIT 10"
  ).toArray();
  const tools_configured = toolMetrics.map(t => ({
    tool: t.metric.replace('tool:', ''),
    joins: t.count,
  }));

  const hostMetrics = sql.exec(
    "SELECT metric, count FROM telemetry WHERE metric LIKE 'host:%' ORDER BY count DESC LIMIT 10"
  ).toArray();
  const hosts_configured = hostMetrics.map(t => ({
    host_tool: t.metric.replace('host:', ''),
    joins: t.count,
  }));

  const surfaceMetrics = sql.exec(
    "SELECT metric, count FROM telemetry WHERE metric LIKE 'surface:%' ORDER BY count DESC LIMIT 10"
  ).toArray();
  const surfaces_seen = surfaceMetrics.map(t => ({
    agent_surface: t.metric.replace('surface:', ''),
    joins: t.count,
  }));

  const modelMetrics = sql.exec(
    "SELECT metric, count FROM telemetry WHERE metric LIKE 'model:%' ORDER BY count DESC LIMIT 10"
  ).toArray();
  const models_seen = modelMetrics.map(t => ({
    model: t.metric.replace('model:', ''),
    count: t.count,
  }));

  const keyMetrics = sql.exec(
    "SELECT metric, count FROM telemetry WHERE metric NOT LIKE 'tool:%'"
  ).toArray();
  const usage = {};
  for (const m of keyMetrics) usage[m.metric] = m.count;

  return { tools_configured, hosts_configured, surfaces_seen, models_seen, usage };
}

/**
 * Full team context — members, activities, conflicts, locks, memories, sessions, telemetry.
 * @param {object} sql - DO SQL handle
 * @param {Set<string>} connectedIds - agent IDs with active WebSocket connections
 * @returns {object} Team-wide context (everything except per-agent messages)
 */
export function queryTeamContext(sql, connectedIds) {
  const members = sql.exec(
    `SELECT m.agent_id, m.owner_handle, m.tool, m.host_tool, m.agent_surface, m.transport, m.agent_model,
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
    HEARTBEAT_ACTIVE_WINDOW_S
  ).toArray();

  const memories = sql.exec(
    `SELECT id, text, tags, source_handle, source_tool, source_host_tool, source_agent_surface, source_model, created_at, updated_at
     FROM memories
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 20`
  ).toArray().map(m => {
    let tags = [];
    try { tags = JSON.parse(m.tags || '[]'); } catch {}
    return { ...m, tags };
  });

  const recentSessions = sql.exec(`
    SELECT agent_id, owner_handle, framework, host_tool, agent_surface, transport, agent_model, started_at, ended_at,
           edit_count, files_touched, conflicts_hit, memories_saved,
           ROUND((julianday(COALESCE(ended_at, datetime('now'))) - julianday(started_at)) * 24 * 60) as duration_minutes
    FROM sessions
    WHERE started_at > datetime('now', '-24 hours')
    ORDER BY started_at DESC
    LIMIT 20
  `).toArray();

  // Build member list with status resolution
  const memberList = members.map(m => {
    const wsConnected = connectedIds.has(m.agent_id);
    const status = wsConnected ? 'active'
      : m.heartbeat_active ? 'active' : 'offline';
    return {
      agent_id: m.agent_id,
      handle: m.owner_handle,
      tool: m.tool || m.host_tool || 'unknown',
      host_tool: m.host_tool || m.tool || 'unknown',
      agent_surface: m.agent_surface || null,
      transport: m.transport || null,
      agent_model: m.agent_model || null,
      status,
      framework: m.framework || null,
      session_minutes: m.session_minutes || null,
      seconds_since_update: m.seconds_since_update ?? null,
      minutes_since_update: m.minutes_since_update ?? null,
      signal_tier: wsConnected ? 'websocket' : m.heartbeat_active ? 'http' : 'none',
      activity: m.files ? {
        files: (() => { try { return JSON.parse(m.files); } catch { return []; } })(),
        summary: m.summary,
        updated_at: m.updated_at,
      } : null,
    };
  });

  // Server-side conflict detection — single source of truth
  const conflicts = [];
  const fileOwners = new Map();
  for (const m of memberList) {
    if (m.status !== 'active' || !m.activity?.files) continue;
    for (const f of m.activity.files) {
      if (!fileOwners.has(f)) fileOwners.set(f, []);
      fileOwners.get(f).push({ handle: m.handle, tool: m.tool });
    }
  }
  for (const [file, owners] of fileOwners) {
    if (owners.length > 1) {
      conflicts.push({
        file,
        agents: owners.map(o => o.tool !== 'unknown' ? `${o.handle} (${o.tool})` : o.handle),
      });
    }
  }

  // Active file locks
  const locks = sql.exec(
    `SELECT l.file_path, l.owner_handle, l.tool, l.host_tool, l.agent_surface,
            ROUND((julianday('now') - julianday(l.claimed_at)) * 1440) as minutes_held
     FROM locks l
     JOIN members m ON m.agent_id = l.agent_id
     WHERE m.last_heartbeat > datetime('now', '-' || ? || ' seconds')`,
    HEARTBEAT_ACTIVE_WINDOW_S
  ).toArray();

  const telemetry = getTelemetryBreakdown(sql);

  return {
    members: memberList,
    conflicts,
    locks,
    memories,
    ...telemetry,
    recentSessions: recentSessions.map(s => {
      const toolFromAgent = s.host_tool || inferHostToolFromAgentId(s.agent_id);
      return {
        ...s,
        tool: toolFromAgent && toolFromAgent !== 'unknown' ? toolFromAgent : null,
        host_tool: s.host_tool || toolFromAgent || 'unknown',
        agent_surface: s.agent_surface || null,
        transport: s.transport || null,
        agent_model: s.agent_model || null,
        files_touched: (() => { try { return JSON.parse(s.files_touched || '[]'); } catch { return []; } })(),
      };
    }),
  };
}

/**
 * Lightweight team summary — counts only, for cross-project dashboard.
 * @param {object} sql - DO SQL handle
 * @returns {object} Summary with counts and telemetry
 */
export function queryTeamSummary(sql) {
  const active = sql.exec(
    `SELECT COUNT(*) as c FROM members
     WHERE last_heartbeat > datetime('now', '-' || ? || ' seconds')`,
    HEARTBEAT_ACTIVE_WINDOW_S
  ).toArray();

  const total = sql.exec('SELECT COUNT(*) as c FROM members').toArray();

  // Conflict count: files claimed by 2+ active agents
  const activities = sql.exec(
    `SELECT a.files FROM activities a
     JOIN members m ON m.agent_id = a.agent_id
     WHERE m.last_heartbeat > datetime('now', '-' || ? || ' seconds')`,
    HEARTBEAT_ACTIVE_WINDOW_S
  ).toArray();

  const fileCounts = new Map();
  for (const row of activities) {
    if (!row.files) continue;
    let parsedFiles = [];
    try { parsedFiles = JSON.parse(row.files); } catch {}
    for (const f of parsedFiles) {
      fileCounts.set(f, (fileCounts.get(f) || 0) + 1);
    }
  }
  const conflictCount = [...fileCounts.values()].filter(c => c > 1).length;

  const memoriesCount = sql.exec('SELECT COUNT(*) as c FROM memories').toArray();
  const live = sql.exec('SELECT COUNT(*) as c FROM sessions WHERE ended_at IS NULL').toArray();
  const recent = sql.exec(
    "SELECT COUNT(*) as c FROM sessions WHERE started_at > datetime('now', '-24 hours')"
  ).toArray();

  return {
    active_agents: active[0]?.c || 0,
    total_members: total[0]?.c || 0,
    conflict_count: conflictCount,
    memory_count: memoriesCount[0]?.c || 0,
    live_sessions: live[0]?.c || 0,
    recent_sessions_24h: recent[0]?.c || 0,
    ...getTelemetryBreakdown(sql),
  };
}
