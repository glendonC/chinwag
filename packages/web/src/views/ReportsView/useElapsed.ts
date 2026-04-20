// Elapsed-time ticker. Counts ms since a given start (or mount if no
// startedAt is passed). Ticks once per second.
//
// Initial state is 0 rather than `Date.now() - startedAt` so the hook
// stays pure during render; useEffect settles the real elapsed value
// synchronously on the first layout pass.

import { useEffect, useState } from 'react';

export function useElapsed(startedAt?: number): number {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const start = startedAt ?? Date.now();
    const tick = (): void => setElapsedMs(Date.now() - start);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return elapsedMs;
}
