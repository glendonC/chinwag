// Periodic HTTP reconciliation for the channel server.
// Fetches full team context to catch any events the WebSocket missed
// (reconnection gaps, drift). Replaces local state with server truth.
//
// When WebSocket is connected: polls every 60s (safety net).
// When WebSocket is disconnected: polls every 10s (graceful fallback).
//
// CRITICAL: Never console.log — stdio transport.

import { diffState } from './diff-state.js';
import type { TeamContext } from './utils/display.js';
import type { TeamHandlers } from './team.js';
import { getErrorMessage } from './utils/responses.js';

const RECONCILE_INTERVAL_MS = 60_000;
const FALLBACK_POLL_MS = 10_000;

interface Logger {
  info: (msg: string) => void;
  error: (msg: string) => void;
  warn: (msg: string) => void;
}

interface ReconcilerOptions {
  team: TeamHandlers;
  teamId: string;
  getLocalContext: () => TeamContext | null;
  replaceContext: (ctx: TeamContext) => void;
  onEvents: (events: string[]) => void;
  stucknessAlerted: Map<string, string>;
  isWsConnected: () => boolean;
  logger: Logger;
}

export interface Reconciler {
  start: () => void;
  stop: () => void;
  reconcile: () => Promise<void>;
}

export function createReconciler({
  team,
  teamId,
  getLocalContext,
  replaceContext,
  onEvents,
  stucknessAlerted,
  isWsConnected,
  logger,
}: ReconcilerOptions): Reconciler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let consecutiveFailures = 0;

  async function reconcile(): Promise<void> {
    try {
      const httpContext = await team.getTeamContext(teamId);
      if (consecutiveFailures > 0) {
        logger.info(`Reconciliation recovered after ${consecutiveFailures} failure(s)`);
      }
      consecutiveFailures = 0;

      const localContext = getLocalContext();
      if (localContext) {
        const events = diffState(localContext, httpContext, stucknessAlerted);
        if (events.length > 0) {
          logger.info(`Reconciliation found ${events.length} missed event(s)`);
          onEvents(events);
        }
      }

      // Replace local state with server truth
      replaceContext(httpContext);
    } catch (err: unknown) {
      consecutiveFailures++;
      logger.error(
        `Reconciliation failed (attempt ${consecutiveFailures}): ${getErrorMessage(err)}`,
      );
    }
  }

  function scheduleNext(): void {
    if (stopped) return;
    const delay = isWsConnected() ? RECONCILE_INTERVAL_MS : FALLBACK_POLL_MS;
    timer = setTimeout(async () => {
      await reconcile();
      scheduleNext();
    }, delay);
    if (timer.unref) timer.unref();
  }

  function start(): void {
    stopped = false;
    scheduleNext();
  }

  function stop(): void {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { start, stop, reconcile };
}
