// Shared context cache -- serves as both preamble source and offline fallback.
// When the API is unreachable, tools return this cached state with an [offline] tag.

import { formatToolTag } from './utils/formatting.js';
import { createLogger } from './utils/logger.js';
import { getErrorMessage } from './utils/responses.js';
import type { TeamContext } from './utils/display.js';
import type { TeamHandlers } from './team.js';

const log = createLogger('context');

const CONTEXT_TTL_MS = 30_000;

/** All mutable state for the context cache. */
export interface ContextCacheState {
  cachedContext: TeamContext | null;
  cachedContextAt: number;
  cachedContextTeam: string | null;
  isOffline: boolean;
  consecutiveErrors: number;
  lastPreambleState: string;
  inflightRefresh: Promise<TeamContext | null> | null;
}

/** Returns a fresh default state — useful for testing isolated instances. */
export function createContextCache(): ContextCacheState {
  return {
    cachedContext: null,
    cachedContextAt: 0,
    cachedContextTeam: null,
    isOffline: false,
    consecutiveErrors: 0,
    lastPreambleState: '',
    inflightRefresh: null,
  };
}

/** Module-level singleton — all exported functions operate on this. */
const cache: ContextCacheState = createContextCache();

export async function refreshContext(
  team: TeamHandlers,
  teamId: string,
): Promise<TeamContext | null> {
  if (!teamId) return null;
  const now = Date.now();
  if (
    cache.cachedContext &&
    cache.cachedContextTeam === teamId &&
    now - cache.cachedContextAt < CONTEXT_TTL_MS
  ) {
    return cache.cachedContext;
  }
  if (cache.inflightRefresh) return cache.inflightRefresh;
  cache.inflightRefresh = doRefresh(team, teamId, now);
  try {
    return await cache.inflightRefresh;
  } finally {
    cache.inflightRefresh = null;
  }
}

async function doRefresh(
  team: TeamHandlers,
  teamId: string,
  now: number,
): Promise<TeamContext | null> {
  try {
    cache.cachedContext = await team.getTeamContext(teamId);
    cache.cachedContextAt = Date.now();
    cache.cachedContextTeam = teamId;
    if (cache.isOffline) {
      cache.isOffline = false;
      cache.consecutiveErrors = 0;
      log.info('Back online');
    }
    return cache.cachedContext;
  } catch (err: unknown) {
    cache.consecutiveErrors++;
    const message = getErrorMessage(err);
    // Log on first failure and every 10th to avoid flooding stderr
    if (!cache.isOffline || cache.consecutiveErrors % 10 === 0) {
      const cacheAge = cache.cachedContext
        ? `${Math.round((now - cache.cachedContextAt) / 1000)}s old`
        : 'none';
      log.warn(
        `API unreachable (${cache.consecutiveErrors}x) -- cached context: ${cacheAge}: ${message}`,
        {
          consecutiveErrors: cache.consecutiveErrors,
          cacheAge,
        },
      );
    }
    cache.isOffline = true;
    return cache.cachedContext; // null if never fetched — caller must handle
  }
}

export function offlinePrefix(): string {
  return cache.isOffline ? '[offline -- using cached data] ' : '';
}

export function getCachedContext(): TeamContext | null {
  return cache.cachedContext;
}

export function clearContextCache(): void {
  Object.assign(cache, createContextCache());
}

export async function teamPreamble(team: TeamHandlers, teamId: string): Promise<string> {
  const ctx = await refreshContext(team, teamId);
  if (!ctx) return cache.isOffline ? '[offline] ' : '';
  const active = ctx.members?.filter((m) => m.status === 'active') || [];
  if (active.length === 0) return offlinePrefix();

  const summary = active
    .map((m) => {
      const toolTag = formatToolTag(m.tool);
      const files = m.activity?.files?.join(', ') || 'idle';
      return `${m.handle}${toolTag}: ${files}`;
    })
    .join(' | ');

  const lockCount = ctx.locks?.length || 0;
  const msgCount = ctx.messages?.length || 0;
  const extras: string[] = [];
  if (lockCount > 0) extras.push(`${lockCount} locked file${lockCount > 1 ? 's' : ''}`);
  if (msgCount > 0) extras.push(`${msgCount} message${msgCount > 1 ? 's' : ''}`);

  const currentState = `${summary}|${extras.join(',')}`;
  if (currentState === cache.lastPreambleState) return offlinePrefix();
  cache.lastPreambleState = currentState;

  const extraStr = extras.length > 0 ? ` (${extras.join(', ')})` : '';
  return `${offlinePrefix()}[Team: ${summary}${extraStr}]\n\n`;
}
