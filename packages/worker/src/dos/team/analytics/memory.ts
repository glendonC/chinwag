// Memory analytics: usage stats, outcome correlation, top memories.

import { createLogger } from '../../../lib/logger.js';
import type {
  MemoryUsageStats,
  MemoryOutcomeCorrelation,
  MemoryAccessEntry,
  FormationRecommendationCounts,
} from '@chinwag/shared/contracts/analytics.js';

const log = createLogger('TeamDO.analytics');

// Days since last access (or since creation, for never-accessed memories)
// before a memory counts as stale. Feeds memory-health's `stale` stat.
// Named constant so the threshold lives in one place — a future stale-list
// widget or a tunable setting can read from here instead of re-hardcoding.
const STALE_MEMORY_DAYS = 30;

export function queryMemoryUsage(sql: SqlStorage, days: number): MemoryUsageStats {
  try {
    // Total memories — exclude soft-merged rows so the count reflects what
    // search would actually return. The merged rows stay in the table for
    // unmerge recourse but are not "live" memory.
    const totalRow = sql
      .exec('SELECT COUNT(*) AS cnt FROM memories WHERE merged_into IS NULL AND invalid_at IS NULL')
      .one() as Record<string, unknown>;
    const total = (totalRow?.cnt as number) || 0;

    // Memories created in period (excluding soft-merged)
    const periodRow = sql
      .exec(
        `SELECT
           SUM(CASE WHEN created_at > datetime('now', '-' || ? || ' days') THEN 1 ELSE 0 END) AS created
         FROM memories
         WHERE merged_into IS NULL AND invalid_at IS NULL`,
        days,
      )
      .one() as Record<string, unknown>;

    // Stale memories: last access (or creation, for never-accessed rows) is
    // older than STALE_MEMORY_DAYS. Excludes soft-merged. Thresholded, not
    // period-windowed — age is absolute, so this field is 'all-time' scope.
    const staleRow = sql
      .exec(
        `SELECT COUNT(*) AS cnt FROM memories
         WHERE merged_into IS NULL AND invalid_at IS NULL
           AND ((last_accessed_at IS NULL AND created_at < datetime('now', '-' || ? || ' days'))
                OR (last_accessed_at IS NOT NULL AND last_accessed_at < datetime('now', '-' || ? || ' days')))`,
        STALE_MEMORY_DAYS,
        STALE_MEMORY_DAYS,
      )
      .one() as Record<string, unknown>;

    // Average memory age (excluding soft-merged)
    const ageRow = sql
      .exec(
        `SELECT ROUND(AVG(julianday('now') - julianday(created_at)), 1) AS avg_age
         FROM memories WHERE merged_into IS NULL AND invalid_at IS NULL`,
      )
      .one() as Record<string, unknown>;

    // Search telemetry from daily_metrics (period-scoped, not lifetime)
    const searchRow = sql
      .exec(
        `SELECT COALESCE(SUM(CASE WHEN metric = 'memories_searched' THEN count ELSE 0 END), 0) AS searches,
                COALESCE(SUM(CASE WHEN metric = 'memories_search_hits' THEN count ELSE 0 END), 0) AS hits
         FROM daily_metrics
         WHERE date > date('now', '-' || ? || ' days')
           AND metric IN ('memories_searched', 'memories_search_hits')`,
        days,
      )
      .one() as Record<string, unknown>;

    const searches = (searchRow?.searches as number) || 0;
    const hits = (searchRow?.hits as number) || 0;

    // Live count of consolidation proposals awaiting review.
    const pendingRow = safeOne(
      sql,
      "SELECT COUNT(*) AS cnt FROM consolidation_proposals WHERE status = 'pending'",
    );

    // Unaddressed formation observations by recommendation (live).
    // `status = 'observed'` means the auditor flagged it but no reviewer has
    // acted yet — that is the live review-queue signal the memory-safety
    // widget surfaces. Age does not gate the queue; a year-old unaddressed
    // flag still needs a decision.
    const formationRows = safeAll(
      sql,
      `SELECT recommendation, COUNT(*) AS cnt
       FROM formation_observations
       WHERE status = 'observed'
       GROUP BY recommendation`,
    );
    const formationCounts: FormationRecommendationCounts = {
      keep: 0,
      merge: 0,
      evolve: 0,
      discard: 0,
    };
    for (const r of formationRows) {
      const rec = String(r.recommendation as string);
      if (rec === 'keep' || rec === 'merge' || rec === 'evolve' || rec === 'discard') {
        formationCounts[rec] = (r.cnt as number) || 0;
      }
    }

    // Live count of secret-detector blocks in the last 24h. Fixed window
    // (not the global date picker) because the memory-safety widget is a
    // live review surface — a recent block is actionable, an old block is
    // audit history that lives elsewhere.
    const secretsRow = sql
      .exec(
        `SELECT COALESCE(SUM(count), 0) AS cnt
         FROM daily_metrics
         WHERE metric = 'secrets_blocked'
           AND date > date('now', '-1 day')`,
      )
      .one() as Record<string, unknown>;

    return {
      total_memories: total,
      searches,
      searches_with_results: hits,
      search_hit_rate: searches > 0 ? Math.round((hits / searches) * 1000) / 10 : 0,
      memories_created_period: (periodRow?.created as number) || 0,
      stale_memories: (staleRow?.cnt as number) || 0,
      avg_memory_age_days: (ageRow?.avg_age as number) || 0,
      pending_consolidation_proposals: (pendingRow?.cnt as number) || 0,
      formation_observations_by_recommendation: formationCounts,
      secrets_blocked_24h: (secretsRow?.cnt as number) || 0,
    };
  } catch (err) {
    log.warn(`memoryUsage query failed: ${err}`);
    return {
      total_memories: 0,
      searches: 0,
      searches_with_results: 0,
      search_hit_rate: 0,
      memories_created_period: 0,
      stale_memories: 0,
      avg_memory_age_days: 0,
      pending_consolidation_proposals: 0,
      formation_observations_by_recommendation: { keep: 0, merge: 0, evolve: 0, discard: 0 },
      secrets_blocked_24h: 0,
    };
  }
}

/**
 * Tolerant wrappers around sql.exec for queries that may target tables
 * not yet present (e.g. consolidation_proposals if migration 020 hasn't
 * run, formation_observations if 021 hasn't). Returns sentinel values
 * instead of throwing so the analytics endpoint stays alive on a freshly
 * upgraded team where one migration is pending.
 */
function safeOne(sql: SqlStorage, query: string, ...params: unknown[]): Record<string, unknown> {
  try {
    return sql.exec(query, ...params).one() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function safeAll(sql: SqlStorage, query: string, ...params: unknown[]): Record<string, unknown>[] {
  try {
    return sql.exec(query, ...params).toArray() as Record<string, unknown>[];
  } catch {
    return [];
  }
}

export function queryMemoryOutcomeCorrelation(
  sql: SqlStorage,
  days: number,
): MemoryOutcomeCorrelation[] {
  try {
    // Three-bucket split:
    //   hit memory          — at least one search call returned results
    //   searched, no results — searched but every call came back empty
    //   no search           — did not search memory at all
    // Bucketing on hits (not raw search count) keeps the correlation honest
    // under hybrid + MMR retrieval: a session that searches and gets noise
    // is materially different from one that searches and finds relevant
    // context. Pre-MMR the two collapsed to 'used memory', which is the
    // A2 semantic failure this query fixes. Label reads plainly so a
    // first-time user knows "searched, no results" means the agent looked
    // but came up empty (not "searched and was wrong").
    const rows = sql
      .exec(
        `SELECT
           CASE
             WHEN memories_search_hits > 0 THEN 'hit memory'
             WHEN memories_searched > 0 THEN 'searched, no results'
             ELSE 'no search'
           END AS bucket,
           COUNT(*) AS sessions,
           SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS completed,
           ROUND(CAST(SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS completion_rate
         FROM sessions
         WHERE started_at > datetime('now', '-' || ? || ' days')
         GROUP BY bucket
         ORDER BY
           CASE bucket
             WHEN 'hit memory' THEN 0
             WHEN 'searched, no results' THEN 1
             ELSE 2
           END`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        bucket: row.bucket as string,
        sessions: (row.sessions as number) || 0,
        completed: (row.completed as number) || 0,
        completion_rate: (row.completion_rate as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`memoryOutcomeCorrelation query failed: ${err}`);
    return [];
  }
}

export function queryTopMemories(sql: SqlStorage, days: number): MemoryAccessEntry[] {
  try {
    const rows = sql
      .exec(
        `SELECT id, text, access_count, last_accessed_at
         FROM memories
         WHERE merged_into IS NULL AND invalid_at IS NULL
           AND access_count > 0
           AND (last_accessed_at IS NOT NULL AND last_accessed_at > datetime('now', '-' || ? || ' days'))
         ORDER BY access_count DESC
         LIMIT 20`,
        days,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      const text = row.text as string;
      return {
        id: row.id as string,
        text_preview: text.length > 120 ? text.slice(0, 120) + '...' : text,
        access_count: (row.access_count as number) || 0,
        last_accessed_at: (row.last_accessed_at as string) || null,
      };
    });
  } catch (err) {
    log.warn(`topMemories query failed: ${err}`);
    return [];
  }
}
