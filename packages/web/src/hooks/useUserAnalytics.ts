// Fetches cross-project user analytics on demand (not polled).
// Used by Workflow and Performance tabs in the Overview.

import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api.js';
import { authActions } from '../lib/stores/auth.js';
import { createDemoAnalytics } from '../lib/demoAnalytics.js';
import { type UserAnalytics, userAnalyticsSchema, validateResponse } from '../lib/apiSchemas.js';

interface UseUserAnalyticsReturn {
  analytics: UserAnalytics;
  isLoading: boolean;
  error: string | null;
}

export function useUserAnalytics(
  days = 30,
  enabled = true,
  teamIds?: string[],
): UseUserAnalyticsReturn {
  const [analytics, setAnalytics] = useState<UserAnalytics>(createDemoAnalytics);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Stable dep key so effect doesn't re-fire on array reference changes
  const teamKey = teamIds?.slice().sort().join(',') ?? '';

  useEffect(() => {
    if (!enabled) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let cancelled = false;

    async function fetchAnalytics() {
      setIsLoading(true);
      setError(null);
      try {
        const token = authActions.getState().token;
        // Date.prototype.getTimezoneOffset returns minutes WEST of UTC, i.e.
        // PST is +480. The worker's SQL modifier expects the SIGNED offset
        // FROM UTC (PST = -480), so we negate. DST is handled by recomputing
        // per request. Older workers that don't read the param default to
        // UTC — same behavior as before.
        const tzOffsetMinutes = -new Date().getTimezoneOffset();
        let url = `/me/analytics?days=${days}&tz_offset_minutes=${tzOffsetMinutes}`;
        if (teamKey) url += `&team_ids=${teamKey}`;
        const raw = await api('GET', url, null, token, {
          signal: controller.signal,
        });
        if (cancelled) return;
        const parsed = validateResponse(userAnalyticsSchema, raw, 'user-analytics', {
          fallback: createDemoAnalytics,
        });
        // Keep demo seed when backend returns a valid-but-empty shape so dev
        // dashboards aren't wiped by a logged-in-but-quiet team.
        const hasRealData =
          parsed.period_comparison.current.total_sessions > 0 ||
          parsed.daily_trends.some((d) => d.sessions > 0);
        if (hasRealData) setAnalytics(parsed);
      } catch (err) {
        if (cancelled) return;
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message || 'Failed to load analytics');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchAnalytics();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [days, enabled, teamKey]);

  return { analytics, isLoading, error };
}
