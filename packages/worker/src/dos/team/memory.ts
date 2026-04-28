// Shared project memory -- saveMemory, searchMemories, updateMemory, deleteMemory.
// Each function takes `sql` as the first parameter.

import type { DOResult, Memory } from '../../types.js';
import { createLogger } from '../../lib/logger.js';
import { row, rows } from '../../lib/row.js';
import { normalizeRuntimeMetadata } from './runtime.js';
import {
  MEMORY_MAX_COUNT,
  LAST_ACCESSED_THROTTLE_MS,
  METRIC_KEYS,
  MEMORY_DECAY_HALFLIFE_DAYS,
  MEMORY_DECAY_HALFLIFE_LONG_DAYS,
  MEMORY_DECAY_HALFLIFE_SHORT_DAYS,
  MEMORY_DECAY_TAGS_LONG,
  MEMORY_DECAY_TAGS_SHORT,
  MEMORY_DECAY_CANDIDATE_MULTIPLIER,
  MEMORY_HYBRID_RRF_K,
  MEMORY_HYBRID_VECTOR_TOP_N,
  MEMORY_MMR_LAMBDA,
} from '../../lib/constants.js';
import { sqlChanges, withTransaction } from '../../lib/validation.js';
import { recordTagUsage } from './categories.js';
import { bumpActiveTime } from './sessions.js';

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
    // Loop bound is a.length, so a[i] is always defined; b is asserted to match (caller contract).
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
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
      .exec(
        'SELECT id, text FROM memories WHERE text_hash = ? AND merged_into IS NULL AND invalid_at IS NULL',
        textHash,
      )
      .toArray();
    if (existing.length > 0) {
      const r = row(existing[0]);
      return {
        error: 'Duplicate memory exists',
        code: 'DUPLICATE',
        existingId: r.string('id'),
        existingText: r.string('text'),
      };
    }
  }

  // --- Near dedup: embedding similarity scan ---
  if (embedding) {
    const queryVec = new Float32Array(embedding);
    const candidateRows = sql
      .exec(
        'SELECT id, text, embedding FROM memories WHERE embedding IS NOT NULL AND merged_into IS NULL AND invalid_at IS NULL',
      )
      .toArray();

    for (const raw of candidateRows) {
      const r = row(raw);
      const storedBuf = r.raw('embedding') as ArrayBuffer | null;
      if (!storedBuf) continue;
      const storedVec = new Float32Array(storedBuf);
      const sim = cosineSimilarity(queryVec, storedVec);
      if (sim >= NEAR_DEDUP_THRESHOLD) {
        return {
          error: 'Near-duplicate memory exists',
          code: 'DUPLICATE',
          existingId: r.string('id'),
          existingText: r.string('text'),
          similarity: Math.round(sim * 1000) / 1000,
        };
      }
    }
  }

  // Inherit model + session_id from active session
  const sessionRows = sql
    .exec(
      'SELECT id, agent_model FROM sessions WHERE agent_id = ? AND ended_at IS NULL LIMIT 1',
      resolvedAgentId,
    )
    .toArray();
  const sessionData = row(sessionRows[0]);
  const model = sessionData.string('agent_model') || runtime.model || null;
  const sessionId = sessionData.string('id') || null;

  const id = crypto.randomUUID();
  const normalizedTags = tags || [];
  const normalizedCategories = categories || [];

  // Transaction ensures insert + pruning + tag stats + session update are atomic.
  let evicted = 0;
  withTransaction(transact, () => {
    // valid_at mirrors created_at at save time. Once bi-temporal supersession
    // flows (migration 023) land an `invalidate` proposal kind,
    // applyConsolidationProposal may set `invalid_at` on older rows - but
    // `valid_at` is always "when the fact was recorded" and stays immutable.
    sql.exec(
      `INSERT INTO memories (id, text, tags, categories, agent_id, handle, host_tool, agent_surface, agent_model, session_id, text_hash, embedding, created_at, updated_at, valid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`,
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

    // Record in active session. bumpActiveTime fires first so last_active_at
    // advances on memory saves too - otherwise a session of pure memory work
    // would never accrue active_min.
    bumpActiveTime(sql, resolvedAgentId);
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
  memories: Memory[] | CompactMemory[];
  format?: 'detail' | 'compact';
  /**
   * True when the route asked for hybrid retrieval but the query embedding
   * could not be generated (Workers AI failed) - results came from FTS5
   * alone. Lets callers retry with backoff or surface a quality warning.
   */
  degraded?: boolean;
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
  /**
   * Decay-aware ranking. 'on' (default) multiplies relevance by an
   * exponential decay factor based on age and a log-scale access boost,
   * with halflife determined by tags (long for decision/adr/architecture,
   * short for scratch/debug/wip). 'off' falls back to recency-only ordering
   * for "show me everything" queries.
   */
  decay?: 'on' | 'off';
  /**
   * Response shape. 'detail' (default) returns the full Memory object.
   * 'compact' returns {id, tags, preview, updated_at} for token-budgeted
   * use cases - agents can scan the result list without loading every full
   * text, then call back for detail on hits worth investigating.
   */
  format?: 'detail' | 'compact';
  /**
   * Pre-computed query embedding for hybrid retrieval. The route handler
   * generates this in parallel with the SQL fetch. Hybrid only activates
   * when an embedding is provided AND the query is non-literal (paths,
   * SHAs, identifiers stay FTS-only). On null, falls back to FTS-only.
   */
  queryEmbedding?: ArrayBuffer | null;
}

export interface CompactMemory {
  id: string;
  tags: string[];
  preview: string;
  updated_at: string;
}

/**
 * Heuristic preview for compact mode: prefer first sentence (split on .!?),
 * cap at 160 chars at a word boundary, ellipsis if truncated. Captures
 * enough signal for an agent to decide whether to fetch detail without
 * doubling round-trips on every hit.
 */
function buildPreview(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  const PREVIEW_MAX = 160;
  if (trimmed.length <= PREVIEW_MAX) return trimmed;

  // Try first sentence - most chinmeister memories lead with a one-line summary
  const sentenceMatch = trimmed.match(/^[^.!?]{20,200}[.!?]/);
  if (sentenceMatch && sentenceMatch[0].length <= PREVIEW_MAX) {
    return sentenceMatch[0].trim();
  }

  // Fall back to word-boundary truncation
  const slice = trimmed.slice(0, PREVIEW_MAX);
  const lastSpace = slice.lastIndexOf(' ');
  const cutoff = lastSpace > PREVIEW_MAX * 0.6 ? lastSpace : PREVIEW_MAX;
  return `${trimmed.slice(0, cutoff)}…`;
}

/**
 * Pick the appropriate decay halflife in days based on memory tags.
 * Tag conventions are agent-author authority; we read the tags they already
 * apply rather than introducing a new "memory type" concept.
 */
function halflifeForTags(tags: string[]): number {
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (MEMORY_DECAY_TAGS_LONG.includes(lower)) return MEMORY_DECAY_HALFLIFE_LONG_DAYS;
  }
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (MEMORY_DECAY_TAGS_SHORT.includes(lower)) return MEMORY_DECAY_HALFLIFE_SHORT_DAYS;
  }
  return MEMORY_DECAY_HALFLIFE_DAYS;
}

/**
 * Compute the decay-aware score for a memory.
 *   score = exp(-age_days / halflife) * (1 + log(1 + access_count))
 * The access boost rescues old-but-frequently-used memories (chinmeister's
 * answer to the "we use pnpm" stable-fact starvation case). Multiplier
 * with the existing relevance signal is left to the caller.
 */
function decayScore(createdAt: string, accessCount: number, tags: string[]): number {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = Math.max(0, ageMs / 86_400_000);
  const halflife = halflifeForTags(tags);
  const decay = Math.exp(-ageDays / halflife);
  const accessBoost = 1 + Math.log(1 + Math.max(0, accessCount));
  return decay * accessBoost;
}

/**
 * Detect literal-shaped queries (file paths, SHAs, identifiers, command
 * names, file extensions). For these, FTS5 is strictly better than vector
 * search - embeddings semantically conflate similar paths or hashes and
 * push the exact match down. The router falls back to FTS-only.
 *
 * Two consumers, single source of truth:
 *   1. routes/team/memory.ts: route-side optimization, skips the Workers
 *      AI embedding round-trip for literal queries (saves latency + cost).
 *   2. searchMemories below: defense-in-depth, gates `hybridEligible` so
 *      hybrid retrieval never activates for literals even if a caller
 *      passes an embedding for one.
 *
 * Both call sites import this same function, so the predicate cannot
 * drift. The duplication is intentional. Keep it.
 */
export function isLiteralQuery(q: string): boolean {
  if (!q) return false;
  const trimmed = q.trim();
  if (!trimmed) return false;
  if (trimmed.includes('/') || trimmed.includes('\\')) return true;
  if (trimmed.includes('::')) return true;
  if (/[A-Za-z_]\w*\(/.test(trimmed)) return true;
  if (/\b[a-f0-9]{12,}\b/i.test(trimmed)) return true;
  if (/\.[a-z]{2,5}\b/i.test(trimmed)) return true;
  if (/^[A-Z][A-Z0-9_]{3,}$/.test(trimmed)) return true;
  return false;
}

/**
 * Reciprocal Rank Fusion: combine two ranked lists into a single ranked
 * list. Each document's score is the sum over all rankings of 1/(k + rank).
 * k=60 is the industry default per Cormack et al. 2009; flattens the curve
 * so neither ranker dominates.
 */
export function rrfMerge(
  ftsRanked: string[],
  vectorRanked: string[],
  k: number = MEMORY_HYBRID_RRF_K,
): Map<string, number> {
  const scores = new Map<string, number>();
  ftsRanked.forEach((id, i) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
  });
  vectorRanked.forEach((id, i) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
  });
  return scores;
}

/**
 * MMR (Maximal Marginal Relevance) diversification. Iteratively picks the
 * candidate that maximises `lambda * relevance - (1 - lambda) * max_sim`,
 * where max_sim is the cosine to the most-similar already-picked memory.
 * Prevents one hot memory from starving diverse results.
 *
 * Skips diversification (returns input ordering) when any candidate is
 * missing an embedding - partial diversity is worse than none.
 */
export function mmrDiversify(
  ranked: { id: string; relevance: number; embedding: Float32Array | null }[],
  k: number,
  lambda: number = MEMORY_MMR_LAMBDA,
): string[] {
  if (ranked.length <= 1) return ranked.map((r) => r.id);
  if (ranked.some((r) => r.embedding === null)) return ranked.slice(0, k).map((r) => r.id);

  const selected: typeof ranked = [];
  const remaining = [...ranked];
  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]!;
      let maxSim = 0;
      for (const sel of selected) {
        const sim = cosineSimilarity(cand.embedding!, sel.embedding!);
        if (sim > maxSim) maxSim = sim;
      }
      const score = lambda * cand.relevance - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    selected.push(remaining[bestIdx]!);
    remaining.splice(bestIdx, 1);
  }
  return selected.map((s) => s.id);
}

export function searchMemories(sql: SqlStorage, filters: SearchFilters): SearchMemoriesResult {
  const { query, tags, categories, sessionId, agentId, handle, after, before } = filters;
  // `||` would coerce explicit `0` to the default of 20; use `??` so 0 (and
  // negatives) flow into the Math.max clamp and land at the floor of 1.
  const cappedLimit = Math.min(Math.max(1, filters.limit ?? 20), 50);
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Use FTS5 for text queries (BM25 ranked, prefix-aware).
  // Falls back to LIKE if FTS5 query fails (e.g., special characters).
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
    } catch {
      // FTS5 not available or query invalid - fall back to LIKE
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
  // Exclude soft-merged memories from search by default. Consolidation
  // marks the source memory's merged_into pointer; the target stays
  // canonical. Restored via unmergeMemory() in consolidation.ts.
  conditions.push('merged_into IS NULL AND invalid_at IS NULL');

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  // is_stale is computed in SQL so the throttle decision stays in SQLite's
  // time domain - no JS Date parsing of SQLite datetime strings.
  const throttleSeconds = Math.round(LAST_ACCESSED_THROTTLE_MS / 1000);

  // Decay-aware ranking: when enabled, fetch a wider candidate pool from SQL
  // (ordered by FTS rank or recency) and re-sort in JS by `position_signal *
  // decay_score`. This combines text relevance / recency with tag-aware
  // exponential decay and a log-scale access boost. `decay: 'off'` falls back
  // to pure recency for "show me everything" queries.
  const decayEnabled = filters.decay !== 'off';
  // Hybrid retrieval activates only when the route supplied a query
  // embedding AND the query is non-literal. Literal queries (paths, SHAs,
  // function names) are strictly better served by FTS5 alone - embeddings
  // semantically conflate similar paths and push the exact match down.
  const hybridEligible = !!filters.queryEmbedding && !!query && !isLiteralQuery(query);
  const fetchLimit =
    decayEnabled || hybridEligible ? cappedLimit * MEMORY_DECAY_CANDIDATE_MULTIPLIER : cappedLimit;
  const sqlStr = `SELECT m.id, m.text, m.tags, m.categories, m.handle, m.host_tool, m.agent_surface, m.agent_model, m.session_id, m.created_at, m.updated_at, m.last_accessed_at, m.access_count, m.embedding,
                   CASE
                     WHEN m.last_accessed_at IS NULL THEN 1
                     WHEN (julianday('now') - julianday(m.last_accessed_at)) * 86400 > ? THEN 1
                     ELSE 0
                   END AS is_stale
               FROM memories m ${where}
               ORDER BY m.updated_at DESC, m.created_at DESC LIMIT ?`;
  params.unshift(throttleSeconds);
  params.push(fetchLimit);

  const ftsRows = sql.exec(sqlStr, ...params).toArray();

  // Hybrid: also pull top-N vector candidates from anywhere in the corpus
  // that satisfies the same non-text filters. These will surface
  // semantically-close memories that FTS missed (paraphrased queries).
  // RRF then merges FTS rank with vector rank.
  let candidateRows: unknown[] = ftsRows;
  let vectorRanking: string[] = [];
  if (hybridEligible) {
    // Build the same WHERE minus the FTS clause (vector ignores text query)
    const nonFtsConditions: string[] = [];
    const nonFtsParams: unknown[] = [];
    if (tags && tags.length > 0) {
      const tagClauses = tags.map(() => "tags LIKE ? ESCAPE '\\'");
      nonFtsConditions.push(`(${tagClauses.join(' OR ')})`);
      for (const tag of tags) nonFtsParams.push(`%"${escapeLike(tag)}"%`);
    }
    if (categories && categories.length > 0) {
      const catClauses = categories.map(() => "categories LIKE ? ESCAPE '\\'");
      nonFtsConditions.push(`(${catClauses.join(' OR ')})`);
      for (const cat of categories) nonFtsParams.push(`%"${escapeLike(cat)}"%`);
    }
    if (sessionId) {
      nonFtsConditions.push('session_id = ?');
      nonFtsParams.push(sessionId);
    }
    if (agentId) {
      nonFtsConditions.push('agent_id = ?');
      nonFtsParams.push(agentId);
    }
    if (handle) {
      nonFtsConditions.push('handle = ?');
      nonFtsParams.push(handle);
    }
    if (after) {
      nonFtsConditions.push('created_at > ?');
      nonFtsParams.push(after);
    }
    if (before) {
      nonFtsConditions.push('created_at < ?');
      nonFtsParams.push(before);
    }
    nonFtsConditions.push('embedding IS NOT NULL');
    nonFtsConditions.push('merged_into IS NULL AND invalid_at IS NULL');
    const vecWhere = `WHERE ${nonFtsConditions.join(' AND ')}`;

    const vecRows = sql
      .exec(
        `SELECT m.id, m.text, m.tags, m.categories, m.handle, m.host_tool, m.agent_surface, m.agent_model, m.session_id, m.created_at, m.updated_at, m.last_accessed_at, m.access_count, m.embedding,
                CASE
                  WHEN m.last_accessed_at IS NULL THEN 1
                  WHEN (julianday('now') - julianday(m.last_accessed_at)) * 86400 > ? THEN 1
                  ELSE 0
                END AS is_stale
         FROM memories m ${vecWhere}`,
        throttleSeconds,
        ...nonFtsParams,
      )
      .toArray();

    const queryVec = new Float32Array(filters.queryEmbedding!);
    type VecScored = { raw: unknown; id: string; sim: number };
    const vecScored: VecScored[] = [];
    for (const raw of vecRows) {
      const r = row(raw);
      const buf = r.raw('embedding') as ArrayBuffer | null;
      if (!buf) continue;
      const stored = new Float32Array(buf);
      if (stored.length !== queryVec.length) continue;
      vecScored.push({ raw, id: r.string('id'), sim: cosineSimilarity(queryVec, stored) });
    }
    vecScored.sort((a, b) => b.sim - a.sim);
    const topVec = vecScored.slice(0, MEMORY_HYBRID_VECTOR_TOP_N);
    vectorRanking = topVec.map((v) => v.id);

    // Union FTS candidates with vector candidates (dedup by id)
    const ftsIds = new Set(ftsRows.map((raw) => row(raw).string('id')));
    const merged: unknown[] = [...ftsRows];
    for (const v of topVec) {
      if (!ftsIds.has(v.id)) merged.push(v.raw);
    }
    candidateRows = merged;
  }

  // Throttled last_accessed_at update - only touch rows flagged is_stale by SQL.
  // Writes cost 20x reads on DO SQLite, so we avoid updating on every search.
  const idsToTouch: string[] = [];
  type Scored = {
    id: string;
    memory: Memory;
    relevanceWeight: number;
    decayWeight: number;
    embedding: Float32Array | null;
  };
  // FTS rank order from the recency-sorted SQL result (position-based)
  const ftsRanking = rows(ftsRows, (r) => r.string('id'));
  const rrfScores = hybridEligible ? rrfMerge(ftsRanking, vectorRanking) : null;

  const scored: Scored[] = candidateRows.map((raw, idx) => {
    const r = row(raw);
    const id = r.string('id');
    const rawTags = r.raw('tags');
    const parsedTags = r.json<string[]>('tags', {
      default: rawTags ? [String(rawTags)] : [],
      context: `searchMemories memory=${id} tags`,
    });
    const parsedCategories = r.json<string[]>('categories', {
      default: [],
      context: `searchMemories memory=${id} categories`,
    });

    if (r.number('is_stale') === 1) {
      idsToTouch.push(id);
    }

    // Strip the SQL-only is_stale + access_count + embedding columns from
    // the returned row so callers see the same Memory shape as before.
    // access_count and embedding are used internally for scoring/MMR.
    const accessCount = r.number('access_count');
    const embedBlob = r.raw('embedding');
    const memory = {
      id,
      text: r.string('text'),
      tags: parsedTags,
      categories: parsedCategories,
      handle: r.string('handle'),
      host_tool: r.string('host_tool'),
      agent_surface: r.nullableString('agent_surface'),
      agent_model: r.nullableString('agent_model'),
      session_id: r.nullableString('session_id'),
      created_at: r.string('created_at'),
      updated_at: r.string('updated_at'),
      last_accessed_at: r.nullableString('last_accessed_at'),
    } as unknown as Memory;

    // Relevance: hybrid uses RRF score, FTS-only uses reciprocal of position.
    const relevanceWeight = rrfScores ? (rrfScores.get(id) ?? 1 / (idx + 1)) : 1 / (idx + 1);
    const decayWeight = decayEnabled
      ? decayScore(r.string('created_at') || new Date().toISOString(), accessCount, parsedTags)
      : 1;
    const embedding = embedBlob instanceof ArrayBuffer ? new Float32Array(embedBlob) : null;
    return { id, memory, relevanceWeight, decayWeight, embedding };
  });

  let memories: Memory[];
  if (decayEnabled || rrfScores) {
    scored.sort((a, b) => b.relevanceWeight * b.decayWeight - a.relevanceWeight * a.decayWeight);
  }
  if (hybridEligible) {
    // MMR diversification on the merged candidate set. Falls back to
    // ranked order if any candidate is missing an embedding.
    const ranked = scored.map((s) => ({
      id: s.id,
      relevance: s.relevanceWeight * s.decayWeight,
      embedding: s.embedding,
    }));
    const orderedIds = mmrDiversify(ranked, cappedLimit);
    const byId = new Map(scored.map((s) => [s.id, s.memory]));
    memories = orderedIds.map((id) => byId.get(id)!).filter(Boolean);
  } else {
    memories = scored.slice(0, cappedLimit).map((s) => s.memory);
  }

  // Compact format: shape down to {id, tags, preview, updated_at} for token-
  // budgeted callers. Only applied here so decay scoring still uses full text.
  if (filters.format === 'compact') {
    const compact: CompactMemory[] = memories.map((m) => ({
      id: m.id,
      tags: (m.tags as string[]) || [],
      preview: buildPreview(m.text),
      updated_at: m.updated_at,
    }));
    // Touch stale memories before returning the compact view (preserves
    // access tracking for later decay decisions).
    if (idsToTouch.length > 0) {
      const placeholders = idsToTouch.map(() => '?').join(',');
      try {
        sql.exec(
          `UPDATE memories SET last_accessed_at = datetime('now'), access_count = access_count + 1 WHERE id IN (${placeholders})`,
          ...idsToTouch,
        );
      } catch (e) {
        log.error('failed to update last_accessed_at (compact)', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { ok: true, memories: compact, format: 'compact' };
  }

  // Batch update last_accessed_at for stale entries
  if (idsToTouch.length > 0) {
    const placeholders = idsToTouch.map(() => '?').join(',');
    try {
      sql.exec(
        `UPDATE memories SET last_accessed_at = datetime('now'), access_count = access_count + 1 WHERE id IN (${placeholders})`,
        ...idsToTouch,
      );
    } catch (e) {
      // Non-critical - log and continue
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
