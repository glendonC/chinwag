// Conversation + memory-driven analytics.
// These all relate activity around the conversation log / memory system to
// session outcomes, so their accumulators and sort rules share structure.
//
// Owns: conversation_edit_correlation, memory_outcome_correlation,
// top_memories, memory_usage.

import type {
  ConversationEditCorrelation,
  MemoryAccessEntry,
  MemoryOutcomeCorrelation,
  MemoryUsageStats,
} from '@chinwag/shared/contracts/analytics.js';
import type { TeamResult } from './types.js';

const round1 = (n: number) => Math.round(n * 10) / 10;
const rate = (num: number, denom: number) =>
  denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;

// ── conversation_edit_correlation ────────────────

interface ConvEditBucket {
  sessions: number;
  total_edits: number;
  total_lines: number;
  completed: number;
}

export type ConvEditAcc = Map<string, ConvEditBucket>;

export function createConvEditAcc(): ConvEditAcc {
  return new Map();
}

export function mergeConvEdit(acc: ConvEditAcc, team: TeamResult): void {
  for (const ce of team.conversation_edit_correlation ?? []) {
    const existing = acc.get(ce.bucket) ?? {
      sessions: 0,
      total_edits: 0,
      total_lines: 0,
      completed: 0,
    };
    existing.sessions += ce.sessions;
    existing.total_edits += ce.avg_edits * ce.sessions;
    existing.total_lines += ce.avg_lines * ce.sessions;
    existing.completed += Math.round((ce.completion_rate / 100) * ce.sessions);
    acc.set(ce.bucket, existing);
  }
}

export function projectConvEdit(acc: ConvEditAcc): ConversationEditCorrelation[] {
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, v]) => ({
      bucket,
      sessions: v.sessions,
      avg_edits: v.sessions > 0 ? Math.round(v.total_edits / v.sessions) : 0,
      avg_lines: v.sessions > 0 ? Math.round(v.total_lines / v.sessions) : 0,
      completion_rate: rate(v.completed, v.sessions),
    }));
}

// ── memory_outcome_correlation ───────────────────

interface MemOutcomeBucket {
  sessions: number;
  completed: number;
}

export type MemOutcomeAcc = Map<string, MemOutcomeBucket>;

export function createMemOutcomeAcc(): MemOutcomeAcc {
  return new Map();
}

export function mergeMemOutcome(acc: MemOutcomeAcc, team: TeamResult): void {
  for (const mo of team.memory_outcome_correlation ?? []) {
    const existing = acc.get(mo.bucket) ?? { sessions: 0, completed: 0 };
    existing.sessions += mo.sessions;
    existing.completed += mo.completed;
    acc.set(mo.bucket, existing);
  }
}

export function projectMemOutcome(acc: MemOutcomeAcc): MemoryOutcomeCorrelation[] {
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, v]) => ({
      bucket,
      sessions: v.sessions,
      completed: v.completed,
      completion_rate: rate(v.completed, v.sessions),
    }));
}

// ── top_memories ────────────────────────────────

interface TopMemoryBucket {
  text_preview: string;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
}

export type TopMemoriesAcc = Map<string, TopMemoryBucket>;

export function createTopMemoriesAcc(): TopMemoriesAcc {
  return new Map();
}

export function mergeTopMemories(acc: TopMemoriesAcc, team: TeamResult): void {
  for (const tm of team.top_memories ?? []) {
    const existing = acc.get(tm.id);
    if (!existing) {
      acc.set(tm.id, {
        text_preview: tm.text_preview,
        access_count: tm.access_count,
        last_accessed_at: tm.last_accessed_at,
        created_at: tm.created_at,
      });
    } else {
      existing.access_count += tm.access_count;
    }
  }
}

export function projectTopMemories(acc: TopMemoriesAcc): MemoryAccessEntry[] {
  return [...acc.entries()]
    .sort(([, a], [, b]) => b.access_count - a.access_count)
    .slice(0, 20)
    .map(([id, v]) => ({
      id,
      text_preview: v.text_preview,
      access_count: v.access_count,
      last_accessed_at: v.last_accessed_at,
      created_at: v.created_at,
    }));
}

// ── memory_usage ─────────────────────────────────

export interface MemoryUsageAcc {
  total_memories: number;
  searches: number;
  searches_with_results: number;
  memories_created_period: number;
  memories_updated_period: number;
  stale_memories: number;
  age_sum: number;
  age_count: number;
  merged_memories: number;
  pending_consolidation_proposals: number;
  formation_keep: number;
  formation_merge: number;
  formation_evolve: number;
  formation_discard: number;
  secrets_blocked_period: number;
}

export function createMemoryUsageAcc(): MemoryUsageAcc {
  return {
    total_memories: 0,
    searches: 0,
    searches_with_results: 0,
    memories_created_period: 0,
    memories_updated_period: 0,
    stale_memories: 0,
    age_sum: 0,
    age_count: 0,
    merged_memories: 0,
    pending_consolidation_proposals: 0,
    formation_keep: 0,
    formation_merge: 0,
    formation_evolve: 0,
    formation_discard: 0,
    secrets_blocked_period: 0,
  };
}

export function mergeMemoryUsage(acc: MemoryUsageAcc, team: TeamResult): void {
  const mu = team.memory_usage;
  if (!mu) return;
  acc.total_memories += mu.total_memories;
  acc.searches += mu.searches;
  acc.searches_with_results += mu.searches_with_results;
  acc.memories_created_period += mu.memories_created_period;
  acc.memories_updated_period += mu.memories_updated_period;
  acc.stale_memories += mu.stale_memories;
  if (mu.total_memories > 0) {
    acc.age_sum += mu.avg_memory_age_days * mu.total_memories;
    acc.age_count += mu.total_memories;
  }
  acc.merged_memories += mu.merged_memories ?? 0;
  acc.pending_consolidation_proposals += mu.pending_consolidation_proposals ?? 0;
  const f = mu.formation_observations_by_recommendation;
  if (f) {
    acc.formation_keep += f.keep ?? 0;
    acc.formation_merge += f.merge ?? 0;
    acc.formation_evolve += f.evolve ?? 0;
    acc.formation_discard += f.discard ?? 0;
  }
  acc.secrets_blocked_period += mu.secrets_blocked_period ?? 0;
}

export function projectMemoryUsage(acc: MemoryUsageAcc): MemoryUsageStats {
  return {
    total_memories: acc.total_memories,
    searches: acc.searches,
    searches_with_results: acc.searches_with_results,
    search_hit_rate: rate(acc.searches_with_results, acc.searches),
    memories_created_period: acc.memories_created_period,
    memories_updated_period: acc.memories_updated_period,
    stale_memories: acc.stale_memories,
    avg_memory_age_days: acc.age_count > 0 ? round1(acc.age_sum / acc.age_count) : 0,
    merged_memories: acc.merged_memories,
    pending_consolidation_proposals: acc.pending_consolidation_proposals,
    formation_observations_by_recommendation: {
      keep: acc.formation_keep,
      merge: acc.formation_merge,
      evolve: acc.formation_evolve,
      discard: acc.formation_discard,
    },
    secrets_blocked_period: acc.secrets_blocked_period,
  };
}
