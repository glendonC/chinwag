import { useRef } from 'react';

export interface TimerRegistry {
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout> | null) => void;
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (id: ReturnType<typeof setInterval> | null) => void;
  clearAll: () => void;
}

/**
 * Tracks all timers created during a connection lifecycle
 * and clears them on cleanup. Prevents leaked timers when
 * the component unmounts or the effect re-runs.
 */
export function useTimerRegistry(): TimerRegistry {
  const ref = useRef<TimerRegistry | null>(null);
  if (!ref.current) {
    const active = new Set<ReturnType<typeof setTimeout>>();
    ref.current = {
      setTimeout(fn, ms) {
        const id = globalThis.setTimeout(fn, ms);
        active.add(id);
        return id;
      },
      clearTimeout(id) {
        if (id != null) {
          globalThis.clearTimeout(id);
          active.delete(id);
        }
      },
      setInterval(fn, ms) {
        const id = globalThis.setInterval(fn, ms);
        active.add(id);
        return id;
      },
      clearInterval(id) {
        if (id != null) {
          globalThis.clearInterval(id);
          active.delete(id);
        }
      },
      clearAll() {
        for (const id of active) {
          globalThis.clearTimeout(id);
          globalThis.clearInterval(id);
        }
        active.clear();
      },
    };
  }
  return ref.current;
}
