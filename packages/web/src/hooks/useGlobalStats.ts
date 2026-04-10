import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api.js';
import { useAuthStore } from '../lib/stores/auth.js';

export interface GlobalStats {
  online: number;
  chatUsers: number;
  activeRooms: number;
  countries: Record<string, number>;
}

const GLOBAL_STATS_POLL_MS = 60_000;
/** Avoids strict-mode double-mount race on initial render. */
const INITIAL_DELAY_MS = 500;
const EMPTY: GlobalStats = { online: 0, chatUsers: 0, activeRooms: 0, countries: {} };

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
        // Register this dashboard user in presence, then fetch stats
        await api('POST', '/presence/heartbeat', null, token, { signal: ac.signal });
        const data = await api<Record<string, unknown>>('GET', '/stats', null, null, {
          signal: ac.signal,
        });
        if (data && typeof data === 'object') {
          setStats({
            online: (data.online as number) || 0,
            chatUsers: (data.chatUsers as number) || 0,
            activeRooms: (data.activeRooms as number) || 0,
            countries: (data.countries as Record<string, number>) || {},
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
