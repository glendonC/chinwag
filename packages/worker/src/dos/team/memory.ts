// Shared project memory -- saveMemory, searchMemories, updateMemory, deleteMemory.
// Each function takes `sql` as the first parameter.

import type { DOResult, Memory } from '../../types.js';
import { createLogger } from '../../lib/logger.js';
import { safeParse } from '../../lib/safe-parse.js';
import { normalizeRuntimeMetadata } from './runtime.js';
import { MEMORY_MAX_COUNT } from '../../lib/constants.js';
import { sqlChanges, withTransaction } from '../../lib/validation.js';

const log = createLogger('TeamDO.memory');

// Escape LIKE wildcards so user-supplied text is matched literally
function escapeLike(s: string): string {
  return s.replace(/[%_]/g, (ch) => `\\${ch}`);
}

interface SaveMemoryResult {
  ok: true;
  id: string;
  evicted?: number;
}

export function saveMemory(
  sql: SqlStorage,
  resolvedAgentId: string,
  text: string,
  tags: string[] | null | undefined,
  handle: string,
  runtimeOrTool: string | Record<string, unknown> | null | undefined,
  recordMetric: (metric: string) => void,
  transact: <T>(fn: () => T) => T,
): DOResult<SaveMemoryResult> {
  const runtime = normalizeRuntimeMetadata(runtimeOrTool, resolvedAgentId);

  // Inherit model from active session (session is the source of truth for model)
  const sessionRow = sql
    .exec(
      'SELECT agent_model FROM sessions WHERE agent_id = ? AND ended_at IS NULL LIMIT 1',
      resolvedAgentId,
    )
    .toArray();
  const model =
    ((sessionRow[0] as Record<string, unknown> | undefined)?.agent_model as string) ||
    runtime.model ||
    null;

  const id = crypto.randomUUID();

  // Transaction ensures insert + pruning + session update are atomic.
  // Without this, a crash after insert but before pruning could exceed
  // the memory cap, or a failed session update would lose the counter.
  let evicted = 0;
  withTransaction(transact, () => {
    sql.exec(
      `INSERT INTO memories (id, text, tags, agent_id, handle, host_tool, agent_surface, agent_model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      id,
      text,
      JSON.stringify(tags || []),
      resolvedAgentId,
      handle || 'unknown',
      runtime.hostTool,
      runtime.agentSurface,
      model,
    );

    // Prune oldest beyond storage cap
    sql.exec(
      `DELETE FROM memories WHERE id NOT IN (
        SELECT id FROM memories ORDER BY updated_at DESC, created_at DESC LIMIT ?
      )`,
      MEMORY_MAX_COUNT,
    );
    evicted = sqlChanges(sql);

    // Record in active session
    sql.exec(
      `UPDATE sessions SET memories_saved = memories_saved + 1
       WHERE agent_id = ? AND ended_at IS NULL`,
      resolvedAgentId,
    );
  });
  recordMetric('memories_saved');

  const result: SaveMemoryResult = { ok: true, id };
  if (evicted > 0) result.evicted = evicted;
  return result;
}

interface SearchMemoriesResult {
  ok: true;
  memories: Memory[];
}

export function searchMemories(
  sql: SqlStorage,
  query: string | null | undefined,
  tags: string[] | null | undefined,
  limit = 20,
): SearchMemoriesResult {
  const cappedLimit = Math.min(Math.max(1, limit), 50);
  const conditions: string[] = [];
  const params: unknown[] = [];

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
  const sqlStr = `SELECT id, text, tags, handle, host_tool, agent_surface, agent_model, created_at, updated_at
               FROM memories ${where}
               ORDER BY updated_at DESC, created_at DESC LIMIT ?`;
  params.push(cappedLimit);

  const rows = sql.exec(sqlStr, ...params).toArray();
  return {
    ok: true,
    memories: rows.map((m) => {
      const row = m as Record<string, unknown>;
      const parsedTags = safeParse(
        (row.tags as string) || '[]',
        `searchMemories memory=${row.id} tags`,
        row.tags ? [String(row.tags)] : [],
        log,
      );
      return { ...row, tags: parsedTags } as unknown as Memory;
    }),
  };
}

export function updateMemory(
  sql: SqlStorage,
  _resolvedAgentId: string,
  memoryId: string,
  text: string | undefined,
  tags: string[] | undefined,
): DOResult<{ ok: true }> {
  const existing = sql.exec('SELECT id FROM memories WHERE id = ?', memoryId).toArray();
  if (existing.length === 0) return { error: 'Memory not found', code: 'NOT_FOUND' };

  // Any team member can update -- memories are team knowledge
  const sets: string[] = [];
  const params: unknown[] = [];
  if (text !== undefined) {
    sets.push('text = ?');
    params.push(typeof text === 'string' ? text.trim() : String(text));
  }
  if (tags !== undefined) {
    sets.push('tags = ?');
    params.push(JSON.stringify(tags));
  }
  sets.push("updated_at = datetime('now')");
  params.push(memoryId);

  sql.exec(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return { ok: true };
}

export function deleteMemory(sql: SqlStorage, memoryId: string): DOResult<{ ok: true }> {
  // Any team member can delete -- memories are team knowledge
  sql.exec('DELETE FROM memories WHERE id = ?', memoryId);
  if (sqlChanges(sql) === 0) return { error: 'Memory not found', code: 'NOT_FOUND' };
  return { ok: true };
}
