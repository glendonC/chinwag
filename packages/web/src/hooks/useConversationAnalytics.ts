// Fetches conversation analytics across all user teams and merges client-side.
// Per-team endpoint: GET /teams/:id/conversations/analytics?days=N

import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api.js';
import { authActions } from '../lib/stores/auth.js';
import { useTeamStore } from '../lib/stores/teams.js';
import { getDemoData } from '../lib/demo/index.js';
import { useDemoScenario } from './useDemoScenario.js';
import {
  type ConversationAnalytics,
  conversationAnalyticsSchema,
  validateResponse,
  createEmptyConversationAnalytics,
} from '../lib/apiSchemas.js';

interface UseConversationAnalyticsReturn {
  data: ConversationAnalytics;
  isLoading: boolean;
}

export function useConversationAnalytics(
  days = 30,
  enabled = true,
  teamIds?: string[],
): UseConversationAnalyticsReturn {
  const demo = useDemoScenario();
  const [data, setData] = useState<ConversationAnalytics>(() =>
    demo.active ? getDemoData(demo.scenarioId).conversation : createEmptyConversationAnalytics(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const teams = useTeamStore((s) => s.teams);
  const abortRef = useRef<AbortController | null>(null);

  // Stable dep key so effect doesn't re-fire on array reference changes
  const teamKey = teamIds?.slice().sort().join(',') ?? '';

  useEffect(() => {
    if (demo.active) {
      setData(getDemoData(demo.scenarioId).conversation);
      setIsLoading(false);
      return;
    }
    if (!enabled || teams.length === 0) return;

    // Filter to requested subset (or all teams if no filter)
    const filterSet = teamKey ? new Set(teamKey.split(',')) : null;
    const targetTeams = filterSet ? teams.filter((t) => filterSet.has(t.team_id)) : teams;
    if (targetTeams.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    async function fetchAll() {
      setIsLoading(true);
      try {
        const token = authActions.getState().token;
        const results = await Promise.allSettled(
          targetTeams.map((t) =>
            api('GET', `/teams/${t.team_id}/conversations/analytics?days=${days}`, null, token, {
              signal: controller.signal,
            }),
          ),
        );
        if (cancelled) return;

        const merged = createEmptyConversationAnalytics();
        merged.period_days = days;
        const allSupported = new Set<string>();
        const allUnsupported = new Set<string>();

        for (const r of results) {
          if (r.status !== 'fulfilled') continue;
          const parsed = validateResponse(
            conversationAnalyticsSchema,
            r.value,
            'conversation-analytics',
            {
              fallback: createEmptyConversationAnalytics,
            },
          );

          merged.total_messages += parsed.total_messages;
          merged.user_messages += parsed.user_messages;
          merged.assistant_messages += parsed.assistant_messages;
          merged.sessions_with_conversations += parsed.sessions_with_conversations;

          // Merge sentiment distribution
          for (const s of parsed.sentiment_distribution) {
            const existing = merged.sentiment_distribution.find((e) => e.sentiment === s.sentiment);
            if (existing) existing.count += s.count;
            else merged.sentiment_distribution.push({ ...s });
          }

          // Merge topic distribution
          for (const t of parsed.topic_distribution) {
            const existing = merged.topic_distribution.find((e) => e.topic === t.topic);
            if (existing) existing.count += t.count;
            else merged.topic_distribution.push({ ...t });
          }

          // Merge sentiment-outcome correlation
          for (const sc of parsed.sentiment_outcome_correlation) {
            const existing = merged.sentiment_outcome_correlation.find(
              (e) => e.dominant_sentiment === sc.dominant_sentiment,
            );
            if (existing) {
              existing.sessions += sc.sessions;
              existing.completed += sc.completed;
              existing.abandoned += sc.abandoned;
              existing.failed += sc.failed;
              existing.completion_rate =
                existing.sessions > 0
                  ? Math.round((existing.completed / existing.sessions) * 1000) / 10
                  : 0;
            } else {
              merged.sentiment_outcome_correlation.push({ ...sc });
            }
          }

          // Merge tool coverage
          for (const t of parsed.tool_coverage.supported_tools) allSupported.add(t);
          for (const t of parsed.tool_coverage.unsupported_tools) allUnsupported.add(t);
        }

        merged.sentiment_distribution.sort((a, b) => b.count - a.count);
        merged.topic_distribution.sort((a, b) => b.count - a.count);
        merged.tool_coverage = {
          supported_tools: [...allSupported],
          unsupported_tools: [...allUnsupported].filter((t) => !allSupported.has(t)),
        };

        if (!cancelled) setData(merged);
      } catch {
        // Non-critical - keep empty state
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchAll();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [days, enabled, teams, teamKey, demo.active, demo.scenarioId]);

  return { data, isLoading };
}
