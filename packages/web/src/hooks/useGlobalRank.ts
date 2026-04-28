import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api.js';
import { useAuthStore } from '../lib/stores/auth.js';
import { getDemoData } from '../lib/demo/index.js';
import { useDemoScenario } from './useDemoScenario.js';

export interface MetricRank {
  value: number;
  percentile: number;
  unit: string;
}

export interface PersonalTotals {
  totalSessions: number;
  completedSessions: number;
  abandonedSessions: number;
  failedSessions: number;
  totalEdits: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  totalDurationMin: number;
  totalStuck: number;
  totalMemoriesSaved: number;
  totalMemoriesSearched: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface GlobalRank {
  metrics: Record<string, MetricRank>;
  totals: PersonalTotals;
  totalDevelopers: number;
}

const EMPTY_TOTALS: PersonalTotals = {
  totalSessions: 0,
  completedSessions: 0,
  abandonedSessions: 0,
  failedSessions: 0,
  totalEdits: 0,
  totalLinesAdded: 0,
  totalLinesRemoved: 0,
  totalDurationMin: 0,
  totalStuck: 0,
  totalMemoriesSaved: 0,
  totalMemoriesSearched: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
};

const EMPTY: GlobalRank = {
  metrics: {},
  totals: EMPTY_TOTALS,
  totalDevelopers: 0,
};

export function useGlobalRank(): GlobalRank {
  const demo = useDemoScenario();
  const [rank, setRank] = useState<GlobalRank>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    // Demo: read from the scenario, skip the API. The render-time fall-
    // through below returns the scenario's payload, so no setState here.
    if (demo.active) return;
    if (!token) return;

    async function fetch() {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const data = await api<Record<string, unknown>>('GET', '/me/global-rank', null, token, {
          signal: ac.signal,
        });
        if (!data || typeof data !== 'object') return;

        const raw = data.rank as Record<string, unknown> | null;
        const totalDevelopers = (data.total_developers as number) || 0;

        if (!raw) {
          setRank({ metrics: {}, totals: EMPTY_TOTALS, totalDevelopers });
          return;
        }

        const metrics: Record<string, MetricRank> = {
          completion_rate: {
            value: Math.round((raw.completion_rate as number) || 0),
            percentile: (raw.completion_rate_pct as number) || 0,
            unit: '%',
          },
          first_edit_latency: {
            value: Math.round((raw.avg_first_edit_s as number) || 0),
            percentile: (raw.first_edit_pct as number) || 0,
            unit: 's',
          },
          stuck_rate: {
            value: Math.round((raw.stuck_rate as number) || 0),
            percentile: (raw.stuck_rate_pct as number) || 0,
            unit: '%',
          },
          edit_velocity: {
            value: Math.round(((raw.edit_velocity as number) || 0) * 10) / 10,
            percentile: (raw.edit_velocity_pct as number) || 0,
            unit: 'edits / min',
          },
          lines_per_session: {
            value: Math.round((raw.lines_per_session as number) || 0),
            percentile: (raw.lines_per_session_pct as number) || 0,
            unit: 'lines',
          },
          total_lines: {
            value: (raw.total_lines as number) || 0,
            percentile: (raw.total_lines_pct as number) || 0,
            unit: 'lines',
          },
          focus_hours: {
            value: (raw.focus_hours as number) || 0,
            percentile: (raw.focus_hours_pct as number) || 0,
            unit: 'hours',
          },
          tool_diversity: {
            value: (raw.tool_count as number) || 0,
            percentile: (raw.tool_diversity_pct as number) || 0,
            unit: 'tools',
          },
        };

        const totals: PersonalTotals = {
          totalSessions: (raw.total_sessions as number) || 0,
          completedSessions: (raw.completed_sessions as number) || 0,
          abandonedSessions: (raw.abandoned_sessions as number) || 0,
          failedSessions: (raw.failed_sessions as number) || 0,
          totalEdits: (raw.total_edits as number) || 0,
          totalLinesAdded: (raw.total_lines_added as number) || 0,
          totalLinesRemoved: (raw.total_lines_removed as number) || 0,
          totalDurationMin: (raw.total_duration_min as number) || 0,
          totalStuck: (raw.total_stuck as number) || 0,
          totalMemoriesSaved: (raw.total_memories_saved as number) || 0,
          totalMemoriesSearched: (raw.total_memories_searched as number) || 0,
          totalInputTokens: (raw.total_input_tokens as number) || 0,
          totalOutputTokens: (raw.total_output_tokens as number) || 0,
        };

        setRank({ metrics, totals, totalDevelopers });
      } catch {
        // Silently ignore - page works with mock data
      }
    }

    const delay = setTimeout(fetch, 300);
    return () => {
      clearTimeout(delay);
      abortRef.current?.abort();
    };
  }, [token, demo.active, demo.scenarioId]);

  return demo.active ? getDemoData(demo.scenarioId).globalRank : rank;
}
