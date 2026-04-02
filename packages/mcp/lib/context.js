// Shared context cache — serves as both preamble source and offline fallback.
// When the API is unreachable, tools return this cached state with an [offline] tag.

import { formatToolTag } from './utils/formatting.js';

let cachedContext = null;
let cachedContextAt = 0;
let cachedContextTeam = null;
let isOffline = false;
const CONTEXT_TTL_MS = 30_000;

let lastPreambleState = '';

export async function refreshContext(team, teamId) {
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
      console.error('[chinwag] Back online');
    }
    return cachedContext;
  } catch (err) {
    if (!isOffline) {
      isOffline = true;
      console.error('[chinwag] API unreachable — using cached context:', err?.message || 'unknown error');
    }
    return cachedContext; // may be null if never fetched
  }
}

export function offlinePrefix() {
  return isOffline ? '[offline — using cached data] ' : '';
}

export function getCachedContext() {
  return cachedContext;
}

export function clearContextCache() {
  cachedContext = null;
  cachedContextAt = 0;
  cachedContextTeam = null;
}

export async function teamPreamble(team, teamId) {
  const ctx = await refreshContext(team, teamId);
  if (!ctx) return isOffline ? '[offline] ' : '';
  const active = ctx.members?.filter(m => m.status === 'active') || [];
  if (active.length === 0) return offlinePrefix();

  const summary = active.map(m => {
    const toolTag = formatToolTag(m.tool);
    const files = m.activity?.files?.join(', ') || 'idle';
    return `${m.handle}${toolTag}: ${files}`;
  }).join(' | ');

  const lockCount = ctx.locks?.length || 0;
  const msgCount = ctx.messages?.length || 0;
  const extras = [];
  if (lockCount > 0) extras.push(`${lockCount} locked file${lockCount > 1 ? 's' : ''}`);
  if (msgCount > 0) extras.push(`${msgCount} message${msgCount > 1 ? 's' : ''}`);

  const currentState = `${summary}|${extras.join(',')}`;
  if (currentState === lastPreambleState) return offlinePrefix();
  lastPreambleState = currentState;

  const extraStr = extras.length > 0 ? ` (${extras.join(', ')})` : '';
  return `${offlinePrefix()}[Team: ${summary}${extraStr}]\n\n`;
}
