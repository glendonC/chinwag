// Codebase analytics: file churn, concurrent edits, heatmaps, rework, staleness.

import { createLogger } from '../../../lib/logger.js';
import { classifyWorkType } from './outcomes.js';
import { HEATMAP_LIMIT } from './core.js';
import type {
  FileChurnEntry,
  ConcurrentEditEntry,
  FileHeatmapEntry,
  FileReworkEntry,
  DirectoryHeatmapEntry,
  AuditStalenessEntry,
} from '@chinwag/shared/contracts/analytics.js';

const log = createLogger('TeamDO.analytics');

/**
 * Threshold constants for the codebase analytics queries. Extracted from
 * inline SQL so each magic number has a name, a rationale, and a single
 * point-of-change when we learn from real production distributions. Keep
 * the comments close to the constants — callers should understand *why*
 * a number is what it is before changing it.
 *
 * Tuning approach: start conservative (higher thresholds), widen if the
 * widgets stay sparse at team scale. Never go lower than the documented
 * minimums — the widgets assume "meaningful activity" and below these
 * floors they surface noise, not signal.
 */

/** File-churn floor: a file must appear in this many distinct sessions before
 *  it ranks. `>= 2` is the minimum meaningful definition — a single-session
 *  touch isn't churn. Raise if the list feels noisy at scale. */
const FILE_CHURN_MIN_SESSIONS = 2;

/** Concurrent-edits floor: how many distinct agents must have touched a file
 *  for it to count as a collision. `>= 2` is structural — you cannot have a
 *  "collision" with one agent. Not tunable beyond this floor. */
const CONCURRENT_EDITS_MIN_AGENTS = 2;

/** File-rework floors: both thresholds must pass. `total_edits >= 3` filters
 *  out files with one-off failures that carry no pattern signal; `failed_edits
 *  >= 1` is the definitional floor (a file with zero failures isn't rework).
 *  Raising total_edits reduces noise from trivial files; raising failed_edits
 *  would hide early warning signs, so keep that at 1. */
const FILE_REWORK_MIN_TOTAL_EDITS = 3;
const FILE_REWORK_MIN_FAILED_EDITS = 1;

/** Cold-directory floors: a directory must have had `prior_edit_count` real
 *  activity before it qualifies as "cold" (prevents random test files from
 *  cluttering the list), and must be `stale_days` past its last touch. Both
 *  are ripe for tuning once we have real team-scale data — the 14-day
 *  staleness window is a reasonable working-week * 2 heuristic, and the
 *  edit-count floor is set to filter out fire-and-forget files. */
const COLD_DIR_STALE_DAYS = 14;
const COLD_DIR_MIN_PRIOR_EDITS = 5;

/** Minimum SQL-level file-edit count for the cold-directories inner query
 *  before directory roll-up. Filters out files with trivially few edits so
 *  the dir-level prior_edit_count isn't contaminated by noise files. Lower
 *  than COLD_DIR_MIN_PRIOR_EDITS because this is per-file, not per-dir. */
const COLD_DIR_MIN_FILE_EDITS = 3;

/** Extract directory from a file path (up to 3 segments deep). */
function extractDirectory(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  // Keep up to 3 directory segments for meaningful grouping
  const dirParts = parts.slice(0, Math.min(parts.length - 1, 3));
  return dirParts.length > 0 ? dirParts.join('/') : '.';
}

/**
 * File churn — operation-level measurement from the `edits` table, uncapped.
 *
 * Intentional dual data path with `queryFileHeatmapEnhanced`: that query reads
 * the per-session `files_touched` JSON (capped at 50 entries per session,
 * presence-based), while this query reads the raw `edits` table (uncapped,
 * one row per edit operation). The two widgets measure related but distinct
 * signals — do not unify them without a conscious decision to collapse the
 * distinction. See `file-churn` vs `files` widget verdicts in the codebase
 * rubric pass (2026-04-21).
 */
export function queryFileChurn(sql: SqlStorage, days: number): FileChurnEntry[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           file_path AS file,
           COUNT(DISTINCT session_id) AS session_count,
           COUNT(*) AS total_edits,
           COALESCE(SUM(lines_added + lines_removed), 0) AS total_lines
         FROM edits
         WHERE created_at > datetime('now', '-' || ? || ' days')
         GROUP BY file_path
         HAVING session_count >= ?
         ORDER BY session_count DESC
         LIMIT 30`,
        days,
        FILE_CHURN_MIN_SESSIONS,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        file: row.file as string,
        session_count: (row.session_count as number) || 0,
        total_edits: (row.total_edits as number) || 0,
        total_lines: (row.total_lines as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`fileChurn query failed: ${err}`);
    return [];
  }
}

// Groups by agent_id (per-session agent instance), NOT handle (per-user). The
// primary chinwag use case is one user running multiple agents across tools
// (Claude Code + Cursor + Windsurf) — those agents share a handle but have
// distinct agent_ids. Grouping by handle would silently return zero in exactly
// the scenario this widget exists to surface. Grouping by agent_id catches
// both the solo-multi-tool case and the team case (different users → different
// agent_ids by construction).
export function queryConcurrentEdits(sql: SqlStorage, days: number): ConcurrentEditEntry[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           file_path AS file,
           COUNT(DISTINCT agent_id) AS agents,
           COUNT(*) AS edit_count
         FROM edits
         WHERE created_at > datetime('now', '-' || ? || ' days')
         GROUP BY file_path
         HAVING agents >= ?
         ORDER BY agents DESC, edit_count DESC
         LIMIT 20`,
        days,
        CONCURRENT_EDITS_MIN_AGENTS,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        file: row.file as string,
        agents: (row.agents as number) || 0,
        edit_count: (row.edit_count as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`concurrentEdits query failed: ${err}`);
    return [];
  }
}

/**
 * File heatmap — presence-based measurement from `sessions.files_touched`,
 * capped at 50 files per session by recordEdit.
 *
 * Intentional dual data path with `queryFileChurn`: this query reads the
 * per-session JSON array (presence-based; one row per distinct file in a
 * session's touched list), while queryFileChurn reads the raw `edits` table
 * (uncapped, operation-based). The two widgets surface different signals —
 * "most worked-on files in this period" (this one) vs "files with the widest
 * session spread" (churn). Do not unify without collapsing that distinction.
 */
export function queryFileHeatmapEnhanced(sql: SqlStorage, days: number): FileHeatmapEntry[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           value AS file,
           COUNT(*) AS touch_count,
           ROUND(CAST(SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS outcome_rate,
           COALESCE(SUM(lines_added), 0) AS total_lines_added,
           COALESCE(SUM(lines_removed), 0) AS total_lines_removed
         FROM sessions, json_each(sessions.files_touched)
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND files_touched != '[]'
         GROUP BY value
         ORDER BY touch_count DESC
         LIMIT ?`,
        days,
        HEATMAP_LIMIT,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        file: row.file as string,
        touch_count: (row.touch_count as number) || 0,
        work_type: classifyWorkType(row.file as string),
        outcome_rate: (row.outcome_rate as number) || 0,
        total_lines_added: (row.total_lines_added as number) || 0,
        total_lines_removed: (row.total_lines_removed as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`fileHeatmapEnhanced query failed: ${err}`);
    return [];
  }
}

export function queryFileRework(sql: SqlStorage, days: number): FileReworkEntry[] {
  try {
    const rows = sql
      .exec(
        `SELECT
           e.file_path AS file,
           COUNT(*) AS total_edits,
           SUM(CASE WHEN s.outcome IN ('abandoned', 'failed') THEN 1 ELSE 0 END) AS failed_edits,
           ROUND(CAST(SUM(CASE WHEN s.outcome IN ('abandoned', 'failed') THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS rework_ratio
         FROM edits e
         JOIN sessions s ON s.id = e.session_id
         WHERE e.created_at > datetime('now', '-' || ? || ' days')
         GROUP BY e.file_path
         HAVING total_edits >= ? AND failed_edits >= ?
         ORDER BY rework_ratio DESC
         LIMIT 30`,
        days,
        FILE_REWORK_MIN_TOTAL_EDITS,
        FILE_REWORK_MIN_FAILED_EDITS,
      )
      .toArray();

    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        file: row.file as string,
        total_edits: (row.total_edits as number) || 0,
        failed_edits: (row.failed_edits as number) || 0,
        rework_ratio: (row.rework_ratio as number) || 0,
      };
    });
  } catch (err) {
    log.warn(`fileRework query failed: ${err}`);
    return [];
  }
}

export function queryDirectoryHeatmap(sql: SqlStorage, days: number): DirectoryHeatmapEntry[] {
  try {
    // Query file-level data and roll up to directories in JS
    // (SQLite lacks a clean dirname function)
    const rows = sql
      .exec(
        `SELECT
           value AS file,
           COUNT(*) AS touch_count,
           COALESCE(SUM(lines_added + lines_removed), 0) AS total_lines,
           ROUND(CAST(SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) AS REAL)
             / NULLIF(COUNT(*), 0) * 100, 1) AS completion_rate
         FROM sessions, json_each(sessions.files_touched)
         WHERE started_at > datetime('now', '-' || ? || ' days')
           AND files_touched != '[]'
         GROUP BY value`,
        days,
      )
      .toArray();

    const dirMap = new Map<
      string,
      {
        touch_count: number;
        file_count: number;
        total_lines: number;
        completed_sum: number;
        total_sum: number;
      }
    >();

    for (const r of rows) {
      const row = r as Record<string, unknown>;
      const dir = extractDirectory(row.file as string);
      const existing = dirMap.get(dir) || {
        touch_count: 0,
        file_count: 0,
        total_lines: 0,
        completed_sum: 0,
        total_sum: 0,
      };
      const touches = (row.touch_count as number) || 0;
      existing.touch_count += touches;
      existing.file_count += 1;
      existing.total_lines += (row.total_lines as number) || 0;
      existing.completed_sum += ((row.completion_rate as number) || 0) * touches;
      existing.total_sum += touches;
      dirMap.set(dir, existing);
    }

    return [...dirMap.entries()]
      .map(([directory, v]) => ({
        directory,
        touch_count: v.touch_count,
        file_count: v.file_count,
        total_lines: v.total_lines,
        completion_rate:
          v.total_sum > 0 ? Math.round((v.completed_sum / v.total_sum) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.touch_count - a.touch_count)
      .slice(0, 30);
  } catch (err) {
    log.warn(`directoryHeatmap query failed: ${err}`);
    return [];
  }
}

// All-time scope by design: "cold directories" asks "did this dir have real
// activity historically but nothing in the last 14 days?" Filtering the inner
// query by the period window would make the widget structurally empty on
// short-period views (a 7-day window cannot contain a 14-day-stale edit), so
// the catalog declares timeScope: 'all-time' and the query reads the full
// edits history. The period picker correctly does not apply to this widget.
export function queryAuditStaleness(sql: SqlStorage): AuditStalenessEntry[] {
  try {
    // Find directories with significant past activity that haven't been touched recently
    const rows = sql
      .exec(
        `SELECT
           file_path,
           MAX(created_at) AS last_edit,
           COUNT(*) AS edit_count
         FROM edits
         GROUP BY file_path
         HAVING edit_count >= ?`,
        COLD_DIR_MIN_FILE_EDITS,
      )
      .toArray();

    // Roll up to directory level and filter for stale ones
    const dirMap = new Map<string, { last_edit: string; edit_count: number }>();

    for (const r of rows) {
      const row = r as Record<string, unknown>;
      const dir = extractDirectory(row.file_path as string);
      const existing = dirMap.get(dir);
      const lastEdit = row.last_edit as string;
      const editCount = (row.edit_count as number) || 0;

      if (!existing || lastEdit > existing.last_edit) {
        dirMap.set(dir, {
          last_edit: lastEdit,
          edit_count: (existing?.edit_count || 0) + editCount,
        });
      } else {
        existing.edit_count += editCount;
      }
    }

    const now = Date.now();
    return [...dirMap.entries()]
      .map(([directory, v]) => {
        const daysSince = Math.round((now - new Date(v.last_edit + 'Z').getTime()) / 86400000);
        return {
          directory,
          last_edit: v.last_edit,
          days_since: daysSince,
          prior_edit_count: v.edit_count,
        };
      })
      .filter(
        (e) =>
          e.days_since >= COLD_DIR_STALE_DAYS && e.prior_edit_count >= COLD_DIR_MIN_PRIOR_EDITS,
      )
      .sort((a, b) => b.days_since - a.days_since)
      .slice(0, 20);
  } catch (err) {
    log.warn(`auditStaleness query failed: ${err}`);
    return [];
  }
}
