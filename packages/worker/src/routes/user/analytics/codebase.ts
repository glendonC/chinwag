// File- and directory-dimensioned analytics.
// Everything here bins by a filesystem path (file, directory, or derived
// path-shape metric). Grouping keeps the path-normalization assumptions
// in one place.
//
// Owns: file_heatmap, file_churn, file_rework, directory_heatmap,
// scope_complexity, file_overlap, audit_staleness.

import type {
  AuditStalenessEntry,
  DirectoryHeatmapEntry,
  FileChurnEntry,
  FileHeatmapEntry,
  FileOverlapStats,
  FileReworkEntry,
  FilesByWorkTypeEntry,
  FilesNewVsRevisited,
  ScopeComplexityBucket,
} from '@chinmeister/shared/contracts/analytics.js';
import type { TeamResult } from './types.js';

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const rate = (num: number, denom: number) =>
  denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;

// ── file_heatmap ─────────────────────────────────

interface HeatmapBucket {
  touch_count: number;
  work_type: string;
  outcome_sum: number;
  outcome_count: number;
  lines_added: number;
  lines_removed: number;
}

export type HeatmapAcc = Map<string, HeatmapBucket>;

export function createHeatmapAcc(): HeatmapAcc {
  return new Map();
}

export function mergeHeatmap(acc: HeatmapAcc, team: TeamResult): void {
  for (const f of team.file_heatmap ?? []) {
    const tc = f.touch_count;
    const existing = acc.get(f.file) ?? {
      touch_count: 0,
      work_type: f.work_type ?? 'other',
      outcome_sum: 0,
      outcome_count: 0,
      lines_added: 0,
      lines_removed: 0,
    };
    existing.touch_count += tc;
    const r = f.outcome_rate ?? 0;
    existing.outcome_sum += r * tc;
    existing.outcome_count += tc;
    existing.lines_added += f.total_lines_added ?? 0;
    existing.lines_removed += f.total_lines_removed ?? 0;
    acc.set(f.file, existing);
  }
}

export function projectHeatmap(acc: HeatmapAcc): FileHeatmapEntry[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b.touch_count - a.touch_count)
    .slice(0, 50)
    .map(([file, v]) => ({
      file,
      touch_count: v.touch_count,
      work_type: v.work_type,
      outcome_rate: v.outcome_count > 0 ? round1(v.outcome_sum / v.outcome_count) : 0,
      total_lines_added: v.lines_added,
      total_lines_removed: v.lines_removed,
    }));
}

// ── files_touched_total ──────────────────────────
//
// Each team's DO returns its own uncapped DISTINCT-file count. The
// user-scope sum treats every team as a separate repo with its own file
// tree, which matches chinmeister's one-team-per-project model. A user with
// matching paths across two teams (e.g., `src/index.ts` in each) sees the
// file counted once per team — semantically correct because they are
// different files in different projects.

export interface FilesTouchedTotalAcc {
  total: number;
}

export function createFilesTouchedTotalAcc(): FilesTouchedTotalAcc {
  return { total: 0 };
}

export function mergeFilesTouchedTotal(acc: FilesTouchedTotalAcc, team: TeamResult): void {
  acc.total += team.files_touched_total ?? 0;
}

export function projectFilesTouchedTotal(acc: FilesTouchedTotalAcc): number {
  return acc.total;
}

// ── file_churn ───────────────────────────────────

interface ChurnBucket {
  session_count: number;
  total_edits: number;
  total_lines: number;
}

export type FileChurnAcc = Map<string, ChurnBucket>;

export function createFileChurnAcc(): FileChurnAcc {
  return new Map();
}

export function mergeFileChurn(acc: FileChurnAcc, team: TeamResult): void {
  for (const fc of team.file_churn ?? []) {
    const existing = acc.get(fc.file) ?? { session_count: 0, total_edits: 0, total_lines: 0 };
    existing.session_count += fc.session_count;
    existing.total_edits += fc.total_edits;
    existing.total_lines += fc.total_lines;
    acc.set(fc.file, existing);
  }
}

export function projectFileChurn(acc: FileChurnAcc): FileChurnEntry[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b.session_count - a.session_count)
    .slice(0, 30)
    .map(([file, v]) => ({
      file,
      session_count: v.session_count,
      total_edits: v.total_edits,
      total_lines: v.total_lines,
    }));
}

// ── file_rework ──────────────────────────────────

interface ReworkBucket {
  total_edits: number;
  failed_edits: number;
}

export type FileReworkAcc = Map<string, ReworkBucket>;

export function createFileReworkAcc(): FileReworkAcc {
  return new Map();
}

export function mergeFileRework(acc: FileReworkAcc, team: TeamResult): void {
  for (const fr of team.file_rework ?? []) {
    const existing = acc.get(fr.file) ?? { total_edits: 0, failed_edits: 0 };
    existing.total_edits += fr.total_edits;
    existing.failed_edits += fr.failed_edits;
    acc.set(fr.file, existing);
  }
}

export function projectFileRework(acc: FileReworkAcc): FileReworkEntry[] {
  return [...acc.entries()]
    .sort(
      ([, a], [, b]) =>
        (b.total_edits > 0 ? b.failed_edits / b.total_edits : 0) -
        (a.total_edits > 0 ? a.failed_edits / a.total_edits : 0),
    )
    .slice(0, 20)
    .map(([file, v]) => ({
      file,
      total_edits: v.total_edits,
      failed_edits: v.failed_edits,
      rework_ratio: v.total_edits > 0 ? round2(v.failed_edits / v.total_edits) : 0,
    }));
}

// ── directory_heatmap ────────────────────────────

interface DirHeatmapBucket {
  touch_count: number;
  file_count: number;
  total_lines: number;
  rate_sum: number;
  rate_count: number;
}

export type DirHeatmapAcc = Map<string, DirHeatmapBucket>;

export function createDirHeatmapAcc(): DirHeatmapAcc {
  return new Map();
}

export function mergeDirHeatmap(acc: DirHeatmapAcc, team: TeamResult): void {
  for (const dh of team.directory_heatmap ?? []) {
    const tc = dh.touch_count;
    const existing = acc.get(dh.directory) ?? {
      touch_count: 0,
      file_count: 0,
      total_lines: 0,
      rate_sum: 0,
      rate_count: 0,
    };
    existing.touch_count += tc;
    existing.file_count += dh.file_count;
    existing.total_lines += dh.total_lines;
    existing.rate_sum += dh.completion_rate * tc;
    existing.rate_count += tc;
    acc.set(dh.directory, existing);
  }
}

export function projectDirHeatmap(acc: DirHeatmapAcc): DirectoryHeatmapEntry[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b.touch_count - a.touch_count)
    .slice(0, 20)
    .map(([directory, v]) => ({
      directory,
      touch_count: v.touch_count,
      file_count: v.file_count,
      total_lines: v.total_lines,
      completion_rate: v.rate_count > 0 ? round1(v.rate_sum / v.rate_count) : 0,
    }));
}

// ── scope_complexity ─────────────────────────────

interface ScopeBucket {
  sessions: number;
  edits_sum: number;
  duration_sum: number;
  completed: number;
}

export type ScopeComplexityAcc = Map<string, ScopeBucket>;

export function createScopeComplexityAcc(): ScopeComplexityAcc {
  return new Map();
}

export function mergeScopeComplexity(acc: ScopeComplexityAcc, team: TeamResult): void {
  for (const sc of team.scope_complexity ?? []) {
    const existing = acc.get(sc.bucket) ?? {
      sessions: 0,
      edits_sum: 0,
      duration_sum: 0,
      completed: 0,
    };
    existing.sessions += sc.sessions;
    existing.edits_sum += sc.avg_edits * sc.sessions;
    existing.duration_sum += sc.avg_duration_min * sc.sessions;
    existing.completed += Math.round((sc.completion_rate / 100) * sc.sessions);
    acc.set(sc.bucket, existing);
  }
}

export function projectScopeComplexity(acc: ScopeComplexityAcc): ScopeComplexityBucket[] {
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, v]) => ({
      bucket,
      sessions: v.sessions,
      avg_edits: v.sessions > 0 ? Math.round(v.edits_sum / v.sessions) : 0,
      avg_duration_min: v.sessions > 0 ? round1(v.duration_sum / v.sessions) : 0,
      completion_rate: rate(v.completed, v.sessions),
    }));
}

// ── file_overlap ─────────────────────────────────

export interface FileOverlapAcc {
  total_files: number;
  overlapping_files: number;
}

export function createFileOverlapAcc(): FileOverlapAcc {
  return { total_files: 0, overlapping_files: 0 };
}

export function mergeFileOverlap(acc: FileOverlapAcc, team: TeamResult): void {
  const fo = team.file_overlap;
  if (!fo) return;
  acc.total_files += fo.total_files;
  acc.overlapping_files += fo.overlapping_files;
}

export function projectFileOverlap(acc: FileOverlapAcc): FileOverlapStats {
  return {
    total_files: acc.total_files,
    overlapping_files: acc.overlapping_files,
  };
}

// ── audit_staleness ──────────────────────────────

interface AuditBucket {
  last_edit: string;
  days_since: number;
  prior_edit_count: number;
}

export type AuditStalenessAcc = Map<string, AuditBucket>;

export function createAuditStalenessAcc(): AuditStalenessAcc {
  return new Map();
}

export function mergeAuditStaleness(acc: AuditStalenessAcc, team: TeamResult): void {
  for (const as_ of team.audit_staleness ?? []) {
    const existing = acc.get(as_.directory);
    if (!existing || as_.days_since > existing.days_since) {
      acc.set(as_.directory, {
        last_edit: as_.last_edit,
        days_since: as_.days_since,
        prior_edit_count: (existing?.prior_edit_count ?? 0) + as_.prior_edit_count,
      });
    } else {
      existing.prior_edit_count += as_.prior_edit_count;
    }
  }
}

export function projectAuditStaleness(acc: AuditStalenessAcc): AuditStalenessEntry[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b.days_since - a.days_since)
    .slice(0, 20)
    .map(([directory, v]) => ({
      directory,
      last_edit: v.last_edit,
      days_since: v.days_since,
      prior_edit_count: v.prior_edit_count,
    }));
}

// ── files_by_work_type ───────────────────────────
//
// Per-team distinct-file counts per work_type, summed across teams. Same
// cross-team semantics as `files_touched_total`: a user with matching paths
// in two projects counts each separately (one file per repo), which is
// correct because they are different files in different trees.

export type FilesByWorkTypeAcc = Map<string, number>;

export function createFilesByWorkTypeAcc(): FilesByWorkTypeAcc {
  return new Map();
}

export function mergeFilesByWorkType(acc: FilesByWorkTypeAcc, team: TeamResult): void {
  for (const entry of team.files_by_work_type ?? []) {
    acc.set(entry.work_type, (acc.get(entry.work_type) ?? 0) + entry.file_count);
  }
}

export function projectFilesByWorkType(acc: FilesByWorkTypeAcc): FilesByWorkTypeEntry[] {
  return [...acc.entries()]
    .map(([work_type, file_count]) => ({ work_type, file_count }))
    .sort((a, b) => b.file_count - a.file_count);
}

// ── files_new_vs_revisited ───────────────────────
//
// Each team independently classifies its own files as new or revisited
// relative to the window. Summing across teams preserves the per-project
// judgement — a file that is "new" in project A and "revisited" in project B
// is one of each at user scope because the two file paths live in different
// repos and thus have independent first-seen timestamps.

export function createFilesNewVsRevisitedAcc(): FilesNewVsRevisited {
  return { new_files: 0, revisited_files: 0 };
}

export function mergeFilesNewVsRevisited(acc: FilesNewVsRevisited, team: TeamResult): void {
  const t = team.files_new_vs_revisited;
  if (!t) return;
  acc.new_files += t.new_files;
  acc.revisited_files += t.revisited_files;
}

export function projectFilesNewVsRevisited(acc: FilesNewVsRevisited): FilesNewVsRevisited {
  return { new_files: acc.new_files, revisited_files: acc.revisited_files };
}
