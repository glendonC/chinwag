// Shared context cache -- serves as both preamble source and offline fallback.
// When the API is unreachable, tools return this cached state with an [offline] tag.

import { formatToolTag } from './utils/formatting.js';
import type { TeamContext } from './utils/display.js';
import type { TeamHandlers } from './team.js';

let cachedContext: TeamContext | null = null;
let cachedContextAt = 0;
let cachedContextTeam: string | null = null;
let isOffline = false;
let consecutiveErrors = 0;
const CONTEXT_TTL_MS = 30_000;

let lastPreambleState = '';

export async function refreshContext(
  team: TeamHandlers,
  teamId: string,
): Promise<TeamContext | null> {
  if (!teamId) return null;
  const now = Date.now();
  if (cachedContext && cachedContextTeam === teamId && now - cachedContextAt < CONTEXT_TTL_MS) {
    return cachedContext;
  }
  try {
    cachedContext = await team.getTeamContext(teamId);
    cachedContextAt = Date.now();
    cachedContextTeam = teamId;
    if (isOffline) {
      isOffline = false;
      consecutiveErrors = 0;
      console.error('[chinwag] Back online');
    }
    return cachedContext;
  } catch (err: unknown) {
    consecutiveErrors++;
    const message = err instanceof Error ? err.message : 'unknown error';
    // Log on first failure and every 10th to avoid flooding stderr
    if (!isOffline || consecutiveErrors % 10 === 0) {
      const cacheAge = cachedContext
        ? `${Math.round((now - cachedContextAt) / 1000)}s old`
        : 'none';
      console.error(
        `[chinwag] API unreachable (${consecutiveErrors}x) -- cached context: ${cacheAge}:`,
        message,
      );
    }
    isOffline = true;
    return cachedContext; // null if never fetched — caller must handle
  }
}

export function offlinePrefix(): string {
  return isOffline ? '[offline -- using cached data] ' : '';
}

export function getCachedContext(): TeamContext | null {
  return cachedContext;
}

export function clearContextCache(): void {
  cachedContext = null;
  cachedContextAt = 0;
  cachedContextTeam = null;
}

export async function teamPreamble(team: TeamHandlers, teamId: string): Promise<string> {
  const ctx = await refreshContext(team, teamId);
  if (!ctx) return isOffline ? '[offline] ' : '';
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
  if (currentState === lastPreambleState) return offlinePrefix();
  lastPreambleState = currentState;

  const extraStr = extras.length > 0 ? ` (${extras.join(', ')})` : '';
  return `${offlinePrefix()}[Team: ${summary}${extraStr}]\n\n`;
}
