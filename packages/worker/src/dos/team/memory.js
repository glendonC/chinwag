// Shared project memory — saveMemory, searchMemories, updateMemory, deleteMemory.
// Each function takes `sql` as the first parameter.

import { normalizeRuntimeMetadata } from './runtime.js';

const MEMORY_MAX_COUNT = 500;

// Escape LIKE wildcards so user-supplied text is matched literally
function escapeLike(s) {
  return s.replace(/[%_]/g, ch => `\\${ch}`);
}

export function saveMemory(sql, resolvedAgentId, text, tags, handle, runtimeOrTool, recordMetric) {
  const runtime = normalizeRuntimeMetadata(runtimeOrTool, resolvedAgentId);

  // Inherit model from active session (session is the source of truth for model)
  const sessionRow = sql.exec(
    'SELECT agent_model FROM sessions WHERE agent_id = ? AND ended_at IS NULL LIMIT 1',
    resolvedAgentId
  ).toArray();
  const model = sessionRow[0]?.agent_model || runtime.model || null;

  const id = crypto.randomUUID();
  sql.exec(
    `INSERT INTO memories (id, text, tags, source_agent, source_handle, source_tool, source_host_tool, source_agent_surface, source_model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    id, text, JSON.stringify(tags || []), resolvedAgentId, handle || 'unknown', runtime.tool, runtime.hostTool, runtime.agentSurface, model
  );

  // Prune oldest beyond storage cap
  sql.exec(
    `DELETE FROM memories WHERE id NOT IN (
      SELECT id FROM memories ORDER BY updated_at DESC, created_at DESC LIMIT ?
    )`,
    MEMORY_MAX_COUNT
  );

  // Record in active session
  sql.exec(
    `UPDATE sessions SET memories_saved = memories_saved + 1
     WHERE agent_id = ? AND ended_at IS NULL`,
    resolvedAgentId
  );
  recordMetric('memories_saved');

  return { ok: true, id };
}

export function searchMemories(sql, query, tags, limit = 20) {
  const cappedLimit = Math.min(Math.max(1, limit), 50);
  const conditions = [];
  const params = [];

  if (query) {
    conditions.push("text LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(query)}%`);
  }
  if (tags && tags.length > 0) {
    // OR filter: match memories containing ANY of the listed tags
    const tagClauses = tags.map(() => "tags LIKE ? ESCAPE '\\'");
    conditions.push(`(${tagClauses.join(' OR ')})`);
    for (const tag of tags) params.push(`%"${escapeLike(tag)}"%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sqlStr = `SELECT id, text, tags, source_handle, source_tool, source_host_tool, source_agent_surface, source_model, created_at, updated_at
               FROM memories ${where}
               ORDER BY updated_at DESC, created_at DESC LIMIT ?`;
  params.push(cappedLimit);

  const rows = sql.exec(sqlStr, ...params).toArray();
  return {
    memories: rows.map(m => {
      let tags = [];
      try { tags = JSON.parse(m.tags || '[]'); } catch {}
      return { ...m, tags };
    }),
  };
}

export function updateMemory(sql, resolvedAgentId, memoryId, text, tags) {
  const existing = sql.exec('SELECT id FROM memories WHERE id = ?', memoryId).toArray();
  if (existing.length === 0) return { error: 'Memory not found' };

  // Any team member can update — memories are team knowledge
  const sets = [];
  const params = [];
  if (text !== undefined) { sets.push('text = ?'); params.push(typeof text === 'string' ? text.trim() : String(text)); }
  if (tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(tags)); }
  sets.push("updated_at = datetime('now')");
  params.push(memoryId);

  sql.exec(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return { ok: true };
}

export function deleteMemory(sql, memoryId) {
  // Any team member can delete — memories are team knowledge
  sql.exec('DELETE FROM memories WHERE id = ?', memoryId);
  const changed = sql.exec('SELECT changes() as c').toArray();
  if (changed[0].c === 0) return { error: 'Memory not found' };
  return { ok: true };
}
