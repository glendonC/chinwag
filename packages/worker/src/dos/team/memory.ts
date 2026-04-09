// Shared project memory -- saveMemory, searchMemories, updateMemory, deleteMemory.
// Each function takes `sql` as the first parameter.

import type { DOResult, Memory } from '../../types.js';
import { createLogger } from '../../lib/logger.js';
import { safeParse } from '../../lib/safe-parse.js';
import { normalizeRuntimeMetadata } from './runtime.js';
import { MEMORY_MAX_COUNT, LAST_ACCESSED_THROTTLE_MS, METRIC_KEYS } from '../../lib/constants.js';
import { sqlChanges, withTransaction } from '../../lib/validation.js';
import { recordTagUsage } from './categories.js';

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

interface DuplicateResult {
  error: string;
  code: 'DUPLICATE';
  existingId: string;
  existingText: string;
  similarity?: number;
}

/** Cosine similarity between two Float32Arrays. */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const NEAR_DEDUP_THRESHOLD = 0.93;

export function saveMemory(
  sql: SqlStorage,
  resolvedAgentId: string,
  text: string,
  tags: string[] | null | undefined,
  categories: string[] | null | undefined,
  handle: string,
  runtimeOrTool: string | Record<string, unknown> | null | undefined,
  recordMetric: (metric: string) => void,
  transact: <T>(fn: () => T) => T,
  textHash: string | null = null,
  embedding: ArrayBuffer | null = null,
): DOResult<SaveMemoryResult> | DuplicateResult {
  const runtime = normalizeRuntimeMetadata(runtimeOrTool, resolvedAgentId);

  // --- Exact dedup: hash lookup ---
  if (textHash) {
    const existing = sql
      .exec('SELECT id, text FROM memories WHERE text_hash = ?', textHash)
      .toArray();
    if (existing.length > 0) {
      const row = existing[0] as Record<string, unknown>;
      return {
        error: 'Duplicate memory exists',
        code: 'DUPLICATE',
        existingId: row.id as string,
        existingText: row.text as string,
      };
    }
  }

  // --- Near dedup: embedding similarity scan ---
  if (embedding) {
    const queryVec = new Float32Array(embedding);
    const rows = sql
      .exec('SELECT id, text, embedding FROM memories WHERE embedding IS NOT NULL')
      .toArray();

    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const storedBuf = r.embedding as ArrayBuffer;
      if (!storedBuf) continue;
      const storedVec = new Float32Array(storedBuf);
      const sim = cosineSimilarity(queryVec, storedVec);
      if (sim >= NEAR_DEDUP_THRESHOLD) {
        return {
          error: 'Near-duplicate memory exists',
          code: 'DUPLICATE',
          existingId: r.id as string,
          existingText: r.text as string,
          similarity: Math.round(sim * 1000) / 1000,
        };
      }
    }
  }

  // Inherit model + session_id from active session
  const sessionRow = sql
    .exec(
      'SELECT id, agent_model FROM sessions WHERE agent_id = ? AND ended_at IS NULL LIMIT 1',
      resolvedAgentId,
    )
    .toArray();
  const sessionData = sessionRow[0] as Record<string, unknown> | undefined;
  const model = (sessionData?.agent_model as string) || runtime.model || null;
  const sessionId = (sessionData?.id as string) || null;

  const id = crypto.randomUUID();
  const normalizedTags = tags || [];
  const normalizedCategories = categories || [];

  // Transaction ensures insert + pruning + tag stats + session update are atomic.
  let evicted = 0;
  withTransaction(transact, () => {
    sql.exec(
      `INSERT INTO memories (id, text, tags, categories, agent_id, handle, host_tool, agent_surface, agent_model, session_id, text_hash, embedding, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      id,
      text,
      JSON.stringify(normalizedTags),
      JSON.stringify(normalizedCategories),
      resolvedAgentId,
      handle || 'unknown',
      runtime.hostTool,
      runtime.agentSurface,
      model,
      sessionId,
      textHash,
      embedding,
    );

    // Prune oldest beyond storage cap (decay-aware: prefer evicting unaccessed memories)
    sql.exec(
      `DELETE FROM memories WHERE id NOT IN (
        SELECT id FROM memories ORDER BY
          COALESCE(last_accessed_at, '1970-01-01') DESC,
          updated_at DESC,
          created_at DESC
        LIMIT ?
      )`,
      MEMORY_MAX_COUNT,
    );
    evicted = sqlChanges(sql);

    // Track tag usage for promotion suggestions
    if (normalizedTags.length > 0) {
      recordTagUsage(sql, normalizedTags);
    }

    // Record in active session
    sql.exec(
      `UPDATE sessions SET memories_saved = memories_saved + 1
       WHERE agent_id = ? AND ended_at IS NULL`,
      resolvedAgentId,
    );
  });
  recordMetric(METRIC_KEYS.MEMORIES_SAVED);

  const result: SaveMemoryResult = { ok: true, id };
  if (evicted > 0) result.evicted = evicted;
  return result;
}

interface SearchMemoriesResult {
  ok: true;
  memories: Memory[];
}

export interface SearchFilters {
  query?: string | null;
  tags?: string[] | null;
  categories?: string[] | null;
  sessionId?: string | null;
  agentId?: string | null;
  handle?: string | null;
  after?: string | null;
  before?: string | null;
  limit?: number;
}

export function searchMemories(sql: SqlStorage, filters: SearchFilters): SearchMemoriesResult {
  const { query, tags, categories, sessionId, agentId, handle, after, before } = filters;
  const cappedLimit = Math.min(Math.max(1, filters.limit || 20), 50);
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Use FTS5 for text queries (BM25 ranked, prefix-aware).
  // Falls back to LIKE if FTS5 query fails (e.g., special characters).
  let _useFts = false;
  if (query) {
    try {
      // Sanitize query for FTS5: escape quotes, add prefix matching
      const ftsQuery = query
        .replace(/"/g, '""')
        .split(/\s+/)
        .filter(Boolean)
        .map((term) => `"${term}"*`)
        .join(' ');
      // Test that the FTS5 table exists and query is valid
      sql.exec('SELECT 1 FROM memories_fts LIMIT 0');
      conditions.push('m.rowid IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?)');
      params.push(ftsQuery);
      _useFts = true;
    } catch {
      // FTS5 not available or query invalid — fall back to LIKE
      conditions.push("text LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(query)}%`);
    }
  }
  if (tags && tags.length > 0) {
    const tagClauses = tags.map(() => "tags LIKE ? ESCAPE '\\'");
    conditions.push(`(${tagClauses.join(' OR ')})`);
    for (const tag of tags) params.push(`%"${escapeLike(tag)}"%`);
  }
  if (categories && categories.length > 0) {
    const catClauses = categories.map(() => "categories LIKE ? ESCAPE '\\'");
    conditions.push(`(${catClauses.join(' OR ')})`);
    for (const cat of categories) params.push(`%"${escapeLike(cat)}"%`);
  }
  if (sessionId) {
    conditions.push('session_id = ?');
    params.push(sessionId);
  }
  if (agentId) {
    conditions.push('agent_id = ?');
    params.push(agentId);
  }
  if (handle) {
    conditions.push('handle = ?');
    params.push(handle);
  }
  if (after) {
    conditions.push('created_at > ?');
    params.push(after);
  }
  if (before) {
    conditions.push('created_at < ?');
    params.push(before);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sqlStr = `SELECT m.id, m.text, m.tags, m.categories, m.handle, m.host_tool, m.agent_surface, m.agent_model, m.session_id, m.created_at, m.updated_at, m.last_accessed_at
               FROM memories m ${where}
               ORDER BY m.updated_at DESC, m.created_at DESC LIMIT ?`;
  params.push(cappedLimit);

  const rows = sql.exec(sqlStr, ...params).toArray();
  const now = Date.now();

  // Throttled last_accessed_at update — only touch rows not accessed within the throttle window.
  // Writes cost 20x reads on DO SQLite, so we avoid updating on every search.
  const idsToTouch: string[] = [];
  const memories = rows.map((m) => {
    const row = m as Record<string, unknown>;
    const parsedTags = safeParse(
      (row.tags as string) || '[]',
      `searchMemories memory=${row.id} tags`,
      row.tags ? [String(row.tags)] : [],
      log,
    );
    const parsedCategories = safeParse(
      (row.categories as string) || '[]',
      `searchMemories memory=${row.id} categories`,
      [],
      log,
    );

    // Check if last_accessed_at needs updating
    const lastAccessed = row.last_accessed_at as string | null;
    if (!lastAccessed || now - new Date(lastAccessed + 'Z').getTime() > LAST_ACCESSED_THROTTLE_MS) {
      idsToTouch.push(row.id as string);
    }

    return { ...row, tags: parsedTags, categories: parsedCategories } as unknown as Memory;
  });

  // Batch update last_accessed_at for stale entries
  if (idsToTouch.length > 0) {
    const placeholders = idsToTouch.map(() => '?').join(',');
    try {
      sql.exec(
        `UPDATE memories SET last_accessed_at = datetime('now') WHERE id IN (${placeholders})`,
        ...idsToTouch,
      );
    } catch (e) {
      // Non-critical — log and continue
      log.error('failed to update last_accessed_at', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { ok: true, memories };
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

export interface BatchDeleteFilter {
  ids?: string[];
  tags?: string[];
  before?: string;
}

export function deleteMemoriesBatch(
  sql: SqlStorage,
  filter: BatchDeleteFilter,
  transact: <T>(fn: () => T) => T,
): DOResult<{ ok: true; deleted: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.ids && filter.ids.length > 0) {
    const placeholders = filter.ids.map(() => '?').join(',');
    conditions.push(`id IN (${placeholders})`);
    params.push(...filter.ids);
  }
  if (filter.tags && filter.tags.length > 0) {
    const tagClauses = filter.tags.map(() => "tags LIKE ? ESCAPE '\\'");
    conditions.push(`(${tagClauses.join(' OR ')})`);
    for (const tag of filter.tags) params.push(`%"${escapeLike(tag)}"%`);
  }
  if (filter.before) {
    conditions.push('created_at < ?');
    params.push(filter.before);
  }

  if (conditions.length === 0) {
    return { error: 'At least one filter required (ids, tags, or before)', code: 'VALIDATION' };
  }

  let deleted = 0;
  withTransaction(transact, () => {
    sql.exec(`DELETE FROM memories WHERE ${conditions.join(' AND ')}`, ...params);
    deleted = sqlChanges(sql);
  });

  return { ok: true, deleted };
}
