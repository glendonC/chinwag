import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api.js';
import { useAuthStore } from '../lib/stores/auth.js';

export interface ToolStat {
  tool: string;
  users: number;
}

export interface ModelStat {
  model: string;
  users: number;
}

export interface GlobalAverages {
  completion_rate: number;
  edit_velocity: number;
  stuck_rate: number;
  first_edit_s: number;
  lines_per_session: number;
  focus_hours: number;
  total_edits: number;
  total_sessions: number;
  total_lines_added: number;
  total_tokens: number;
  total_memories: number;
}

export interface ToolEffectiveness {
  tool: string;
  users: number;
  completionRate: number;
  editVelocity: number;
  firstEditS: number;
}

export interface ModelEffectiveness {
  model: string;
  users: number;
  completionRate: number;
  editVelocity: number;
}

export interface ToolCombination {
  toolA: string;
  toolB: string;
  users: number;
}

export interface BracketEntry {
  bracket: string;
  users: number;
}

export interface ToolCountEntry {
  count: number;
  users: number;
}

export interface GlobalStats {
  online: number;
  totalUsers: number;
  totalSessions: number;
  totalEdits: number;
  topTools: ToolStat[];
  topModels: ModelStat[];
  countries: Record<string, number>;
  globalAverages: GlobalAverages;
  toolEffectiveness: ToolEffectiveness[];
  modelEffectiveness: ModelEffectiveness[];
  toolCombinations: ToolCombination[];
  completionDistribution: BracketEntry[];
  toolCountDistribution: ToolCountEntry[];
}

const EMPTY_AVERAGES: GlobalAverages = {
  completion_rate: 0,
  edit_velocity: 0,
  stuck_rate: 0,
  first_edit_s: 0,
  lines_per_session: 0,
  focus_hours: 0,
  total_edits: 0,
  total_sessions: 0,
  total_lines_added: 0,
  total_tokens: 0,
  total_memories: 0,
};

const GLOBAL_STATS_POLL_MS = 60_000;
const INITIAL_DELAY_MS = 500;
const EMPTY: GlobalStats = {
  online: 0,
  totalUsers: 0,
  totalSessions: 0,
  totalEdits: 0,
  topTools: [],
  topModels: [],
  countries: {},
  globalAverages: EMPTY_AVERAGES,
  toolEffectiveness: [],
  modelEffectiveness: [],
  toolCombinations: [],
  completionDistribution: [],
  toolCountDistribution: [],
};

function parseArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  return [];
}

export function useGlobalStats(): GlobalStats {
  const [stats, setStats] = useState<GlobalStats>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!token) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        await api('POST', '/presence/heartbeat', null, token, { signal: ac.signal });
        const data = await api<Record<string, unknown>>('GET', '/stats', null, null, {
          signal: ac.signal,
        });
        if (data && typeof data === 'object') {
          const avg = (data.globalAverages as Record<string, number>) || {};
          setStats({
            online: (data.online as number) || 0,
            totalUsers: (data.totalUsers as number) || 0,
            totalSessions: (data.totalSessions as number) || 0,
            totalEdits: (data.totalEdits as number) || 0,
            topTools: typeof data.topTools === 'string' ? JSON.parse(data.topTools) : [],
            topModels: typeof data.topModels === 'string' ? JSON.parse(data.topModels) : [],
            countries: (data.countries as Record<string, number>) || {},
            globalAverages: {
              completion_rate: avg.completion_rate || 0,
              edit_velocity: avg.edit_velocity || 0,
              stuck_rate: avg.stuck_rate || 0,
              first_edit_s: avg.first_edit_s || 0,
              lines_per_session: avg.lines_per_session || 0,
              focus_hours: avg.focus_hours || 0,
              total_edits: avg.total_edits || 0,
              total_sessions: avg.total_sessions || 0,
              total_lines_added: avg.total_lines_added || 0,
              total_tokens: avg.total_tokens || 0,
              total_memories: avg.total_memories || 0,
            },
            toolEffectiveness: parseArray<ToolEffectiveness>(data.toolEffectiveness),
            modelEffectiveness: parseArray<ModelEffectiveness>(data.modelEffectiveness),
            toolCombinations: parseArray<ToolCombination>(data.toolCombinations),
            completionDistribution: parseArray<BracketEntry>(data.completionDistribution),
            toolCountDistribution: parseArray<ToolCountEntry>(data.toolCountDistribution),
          });
        }
      } catch {
        // Silently ignore
      }
    }

    const initialDelay = setTimeout(tick, INITIAL_DELAY_MS);
    timer = setInterval(tick, GLOBAL_STATS_POLL_MS);

    return () => {
      clearTimeout(initialDelay);
      if (timer) clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [token]);

  return stats;
}
