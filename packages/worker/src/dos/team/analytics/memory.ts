// Memory analytics: usage stats, outcome correlation, top memories.

import { createLogger } from '../../../lib/logger.js';
import type {
  MemoryUsageStats,
  MemoryOutcomeCorrelation,
  MemoryAccessEntry,
  FormationRecommendationCounts,
  CrossToolMemoryFlowEntry,
  MemoryAgingComposition,
  MemoryCategoryEntry,
  MemorySingleAuthorDirectoryEntry,
  MemorySupersessionStats,
  MemorySecretsShieldStats,
} from '@chinmeister/shared/contracts/analytics.js';
import { type AnalyticsScope, buildScopeFilter, withScope } from './scope.js';

const log = createLogger('TeamDO.analytics');

// Days since last access (or since creation, for never-accessed memories)
// before a memory counts as stale. Feeds memory-health's `stale` stat.
// Named constant so the threshold lives in one place — a future stale-list
// widget or a tunable setting can read from here instead of re-hardcoding.
const STALE_MEMORY_DAYS = 30;

export function queryMemoryUsage(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): MemoryUsageStats {
  try {
    // Memories table carries `handle` as the author. Scoping filters to
    // memories the caller authored (per ANALYTICS_SPEC.md §10, per-user
    // memory access tracking is deferred).

    // Total memories — exclude soft-merged rows so the count reflects what
    // search would actually return. The merged rows stay in the table for
    // unmerge recourse but are not "live" memory.
    const { sql: totalQ, params: totalParams } = withScope(
      `SELECT COUNT(*) AS cnt FROM memories WHERE merged_into IS NULL AND invalid_at IS NULL`,
      [],
      scope,
    );
    const totalRow = sql.exec(totalQ, ...totalParams).one() as Record<string, unknown>;
    const total = (totalRow?.cnt as number) || 0;

    // Memories created in period (excluding soft-merged)
    const { sql: periodQ, params: periodParams } = withScope(
      `SELECT
           SUM(CASE WHEN created_at > datetime('now', '-' || ? || ' days') THEN 1 ELSE 0 END) AS created
         FROM memories
         WHERE merged_into IS NULL AND invalid_at IS NULL`,
      [days],
      scope,
    );
    const periodRow = sql.exec(periodQ, ...periodParams).one() as Record<string, unknown>;

    // Stale memories: last access (or creation, for never-accessed rows) is
    // older than STALE_MEMORY_DAYS. Excludes soft-merged. Thresholded, not
    // period-windowed — age is absolute, so this field is 'all-time' scope.
    const { sql: staleQ, params: staleParams } = withScope(
      `SELECT COUNT(*) AS cnt FROM memories
         WHERE merged_into IS NULL AND invalid_at IS NULL
           AND ((last_accessed_at IS NULL AND created_at < datetime('now', '-' || ? || ' days'))
                OR (last_accessed_at IS NOT NULL AND last_accessed_at < datetime('now', '-' || ? || ' days')))`,
      [STALE_MEMORY_DAYS, STALE_MEMORY_DAYS],
      scope,
    );
    const staleRow = sql.exec(staleQ, ...staleParams).one() as Record<string, unknown>;

    // Average memory age (excluding soft-merged)
    const { sql: ageQ, params: ageParams } = withScope(
      `SELECT ROUND(AVG(julianday('now') - julianday(created_at)), 1) AS avg_age
         FROM memories WHERE merged_into IS NULL AND invalid_at IS NULL`,
      [],
      scope,
    );
    const ageRow = sql.exec(ageQ, ...ageParams).one() as Record<string, unknown>;

    // Search telemetry from daily_metrics (period-scoped, not lifetime).
    // Scope not applied: daily_metrics has no handle column (team-wide rollup).
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
    // Scope not applied: consolidation_proposals has no handle column.
    const pendingRow = safeOne(
      sql,
      "SELECT COUNT(*) AS cnt FROM consolidation_proposals WHERE status = 'pending'",
    );

    // Unaddressed formation observations by recommendation (live).
    // `status = 'observed'` means the auditor flagged it but no reviewer has
    // acted yet — that is the live review-queue signal the memory-safety
    // widget surfaces. Age does not gate the queue; a year-old unaddressed
    // flag still needs a decision.
    // Scope not applied: formation_observations has no handle column.
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
    // Scope not applied: daily_metrics has no handle column.
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
  scope: AnalyticsScope,
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
    const { sql: q, params } = withScope(
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
         WHERE started_at > datetime('now', '-' || ? || ' days')`,
      [days],
      scope,
    );
    const rows = sql
      .exec(
        `${q}
         GROUP BY bucket
         ORDER BY
           CASE bucket
             WHEN 'hit memory' THEN 0
             WHEN 'searched, no results' THEN 1
             ELSE 2
           END`,
        ...params,
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

export function queryTopMemories(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): MemoryAccessEntry[] {
  try {
    const { sql: q, params } = withScope(
      `SELECT id, text, access_count, last_accessed_at
         FROM memories
         WHERE merged_into IS NULL AND invalid_at IS NULL
           AND access_count > 0
           AND (last_accessed_at IS NOT NULL AND last_accessed_at > datetime('now', '-' || ? || ' days'))`,
      [days],
      scope,
    );
    const rows = sql
      .exec(
        `${q}
         ORDER BY access_count DESC
         LIMIT 20`,
        ...params,
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

// Cross-tool memory flow: pairs of (author_tool, consumer_tool) where the
// consumer_tool ran sessions in the period that COULD have read memories
// authored by author_tool. Honest framing: this measures co-presence
// (consumer_tool had sessions while author_tool's memories existed) and
// the AVAILABLE memory pool — not exact read attribution. The per-memory
// `memory_search_results` join table is unbuilt (ANALYTICS_SPEC §10), so
// we cannot say which sessions read which memories. The renderer labels
// each row "available to" not "read by" to keep the framing honest.
//
// Detail-view English questions this anchors:
//   1. Which tools share memory most? (this widget)
//   2. What categories cross tools? (memory.categories × pair)
//   3. Does cross-tool memory help completion? (sessions in pairs vs not)
//   4. How fresh is shared knowledge? (created_at distribution per pair)
//   5. Which sessions ran alongside other-tool memory? (drill list)
const CROSS_TOOL_FLOW_LIMIT = 20;

export function queryCrossToolMemoryFlow(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): CrossToolMemoryFlowEntry[] {
  try {
    const { sql: head, params } = withScope(
      `WITH active_authors AS (
           SELECT host_tool, COUNT(*) AS memory_count
           FROM memories
           WHERE merged_into IS NULL AND invalid_at IS NULL
             AND host_tool IS NOT NULL AND host_tool != 'unknown'
           GROUP BY host_tool
           HAVING memory_count > 0
         ),
         active_consumers AS (
           SELECT host_tool, COUNT(*) AS session_count
           FROM sessions
           WHERE started_at > datetime('now', '-' || ? || ' days')
             AND host_tool IS NOT NULL AND host_tool != 'unknown'`,
      [days],
      scope,
    );
    const rows = sql
      .exec(
        `${head}
           GROUP BY host_tool
           HAVING session_count > 0
         )
         SELECT
           a.host_tool AS author_tool,
           c.host_tool AS consumer_tool,
           a.memory_count AS memories,
           c.session_count AS consumer_sessions
         FROM active_authors a
         CROSS JOIN active_consumers c
         WHERE a.host_tool != c.host_tool
         ORDER BY (a.memory_count * c.session_count) DESC
         LIMIT ?`,
        ...params,
        CROSS_TOOL_FLOW_LIMIT,
      )
      .toArray();
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        author_tool: row.author_tool as string,
        consumer_tool: row.consumer_tool as string,
        memories: (row.memories as number) || 0,
        consumer_sessions: (row.consumer_sessions as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`crossToolMemoryFlow query failed: ${err}`);
    return [];
  }
}

// Memory aging composition. Currently-live memories bucketed by age. Lifetime
// scope by design — picker doesn't apply (catalog timeScope='all-time').
//
// Detail-view English questions this anchors:
//   1. Is knowledge fresh? (this widget — composition bar)
//   2. Which categories age fastest? (categories × age bucket)
//   3. Are we accumulating or replacing? (created vs invalidated trend)
//   4. Which directories have fresh knowledge? (memory.tags or path heuristic)
//   5. Who keeps memory current? (handle-aggregate × recent creation)
export function queryMemoryAging(sql: SqlStorage): MemoryAgingComposition {
  try {
    const row = sql
      .exec(
        `SELECT
           SUM(CASE WHEN created_at > datetime('now', '-7 days') THEN 1 ELSE 0 END) AS recent_7d,
           SUM(CASE WHEN created_at > datetime('now', '-30 days')
                     AND created_at <= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS recent_30d,
           SUM(CASE WHEN created_at > datetime('now', '-90 days')
                     AND created_at <= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS recent_90d,
           SUM(CASE WHEN created_at <= datetime('now', '-90 days') THEN 1 ELSE 0 END) AS older
         FROM memories
         WHERE merged_into IS NULL AND invalid_at IS NULL`,
      )
      .one() as Record<string, unknown>;
    return {
      recent_7d: (row.recent_7d as number) || 0,
      recent_30d: (row.recent_30d as number) || 0,
      recent_90d: (row.recent_90d as number) || 0,
      older: (row.older as number) || 0,
    };
  } catch (err) {
    log.warn(`memoryAging query failed: ${err}`);
    return { recent_7d: 0, recent_30d: 0, recent_90d: 0, older: 0 };
  }
}

// Memory categories: top agent-assigned categories on currently-live
// memories, with last-touch hint per row. The `categories` column on
// memories is a JSON array of category names assigned at save time. Coverage
// depends on agent adoption of the category-aware save pattern; the empty
// state names the gate.
//
// Detail-view English questions this anchors:
//   1. Top categories? (this widget — ranked list)
//   2. Which categories help completion? (category × outcome correlation)
//   3. Which directories have which categories? (heatmap)
//   4. Who authors which categories? (handle-blind handle counts × category)
//   5. How has the mix shifted? (category trend over time)
const MEMORY_CATEGORIES_LIMIT = 12;

export function queryMemoryCategories(
  sql: SqlStorage,
  scope: AnalyticsScope,
): MemoryCategoryEntry[] {
  try {
    const { sql: head, params } = withScope(
      `SELECT
           value AS category,
           COUNT(*) AS count,
           MAX(COALESCE(last_accessed_at, updated_at, created_at)) AS last_used_at
         FROM memories, json_each(memories.categories)
         WHERE merged_into IS NULL AND invalid_at IS NULL
           AND value IS NOT NULL AND value != ''`,
      [],
      scope,
    );
    const rows = sql
      .exec(
        `${head}
         GROUP BY value
         ORDER BY count DESC, last_used_at DESC
         LIMIT ?`,
        ...params,
        MEMORY_CATEGORIES_LIMIT,
      )
      .toArray();
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        category: row.category as string,
        count: (row.count as number) || 0,
        last_used_at: (row.last_used_at as string) || null,
      };
    });
  } catch (err) {
    log.warn(`memoryCategories query failed: ${err}`);
    return [];
  }
}

// Single-author directory concentration. Per directory, count of memories
// authored by exactly one handle vs total. Surface is directory-axis,
// never names handles - sidesteps Privacy + §10 #4 surveillance ranking.
// Uses the path heuristic from `tags` JSON (file paths often live there)
// or falls back to the memory's first tag when path-shaped tags absent.
const SINGLE_AUTHOR_DIRS_LIMIT = 12;
const SINGLE_AUTHOR_DIRS_MIN_TOTAL = 2;

export function queryMemorySingleAuthorDirectories(
  sql: SqlStorage,
  scope: AnalyticsScope,
): MemorySingleAuthorDirectoryEntry[] {
  try {
    const f = buildScopeFilter(scope);
    // Group memories by tag (proxy for directory) and count distinct handles.
    // A directory with single_author_count > 0 has one or more memories that
    // only one author has touched. Filter to dirs with >= MIN_TOTAL memories
    // so single-memory dirs don't dominate the list.
    const rows = sql
      .exec(
        `SELECT
           value AS directory,
           COUNT(*) AS total_count,
           SUM(CASE WHEN handle_count = 1 THEN 1 ELSE 0 END) AS single_author_count
         FROM (
           SELECT
             je.value,
             m.id,
             COUNT(DISTINCT m.handle) OVER (PARTITION BY je.value, m.id) AS handle_count
           FROM memories m, json_each(m.tags) je
           WHERE m.merged_into IS NULL AND m.invalid_at IS NULL
             AND je.value IS NOT NULL AND je.value != ''
             AND je.value LIKE '%/%'${f.sql ? f.sql.replace(/^\s*AND/, ' AND m.') : ''}
         )
         GROUP BY value
         HAVING total_count >= ?
         ORDER BY single_author_count DESC, total_count DESC
         LIMIT ?`,
        ...f.params,
        SINGLE_AUTHOR_DIRS_MIN_TOTAL,
        SINGLE_AUTHOR_DIRS_LIMIT,
      )
      .toArray();
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        directory: row.directory as string,
        single_author_count: (row.single_author_count as number) || 0,
        total_count: (row.total_count as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`memorySingleAuthorDirectories query failed: ${err}`);
    return [];
  }
}

// Memory supersession flow: live counters for the consolidation pipeline.
// invalidated_period and merged_period count events whose mark-time is in
// the period. pending_proposals is current-state, picker doesn't apply
// to it. The widget renders all three together (live snapshot).
export function queryMemorySupersession(
  sql: SqlStorage,
  scope: AnalyticsScope,
  days: number,
): MemorySupersessionStats {
  try {
    const periodFilter = `datetime('now', '-' || ? || ' days')`;
    const { sql: invalidatedQ, params: invalidatedParams } = withScope(
      `SELECT COUNT(*) AS count
         FROM memories
         WHERE invalid_at IS NOT NULL AND invalid_at > ${periodFilter}`,
      [days],
      scope,
    );
    const invalidated = sql.exec(invalidatedQ, ...invalidatedParams).one() as Record<
      string,
      unknown
    >;
    const { sql: mergedQ, params: mergedParams } = withScope(
      `SELECT COUNT(*) AS count
         FROM memories
         WHERE merged_into IS NOT NULL AND merged_at IS NOT NULL
           AND merged_at > ${periodFilter}`,
      [days],
      scope,
    );
    const merged = sql.exec(mergedQ, ...mergedParams).one() as Record<string, unknown>;
    const pending = sql
      .exec(
        `SELECT COUNT(*) AS count
         FROM consolidation_proposals
         WHERE status = 'pending'`,
      )
      .one() as Record<string, unknown>;
    return {
      invalidated_period: (invalidated.count as number) || 0,
      merged_period: (merged.count as number) || 0,
      pending_proposals: (pending.count as number) || 0,
    };
  } catch (err) {
    log.warn(`memorySupersession query failed: ${err}`);
    return { invalidated_period: 0, merged_period: 0, pending_proposals: 0 };
  }
}

// Secrets shield stats. blocked_period rolls up daily_metrics over the
// picker window; blocked_24h is the live counter (matches the previously
// cut memory-safety widget's last-24h read).
export function queryMemorySecretsShield(sql: SqlStorage, days: number): MemorySecretsShieldStats {
  try {
    const period = sql
      .exec(
        `SELECT COALESCE(SUM(value), 0) AS total
         FROM daily_metrics
         WHERE metric = 'secrets_blocked'
           AND date > date('now', '-' || ? || ' days')`,
        days,
      )
      .one() as Record<string, unknown>;
    const last24 = sql
      .exec(
        `SELECT COALESCE(SUM(value), 0) AS total
         FROM daily_metrics
         WHERE metric = 'secrets_blocked'
           AND date > date('now', '-1 day')`,
      )
      .one() as Record<string, unknown>;
    return {
      blocked_period: (period.total as number) || 0,
      blocked_24h: (last24.total as number) || 0,
    };
  } catch (err) {
    log.warn(`memorySecretsShield query failed: ${err}`);
    return { blocked_period: 0, blocked_24h: 0 };
  }
}
