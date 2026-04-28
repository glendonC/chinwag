// Context RPC bodies extracted from TeamDO.
//
// getContext is the highest-traffic RPC - it pulls the team-wide composite
// payload, layers per-agent messages and live daemon status on top, and
// caches the team-wide chunk via ContextCache. getSummary is a lighter
// owner-scoped variant for cross-project dashboards.

import type { DOError } from '../../types.js';
import { queryTeamContext, queryTeamSummary } from './context.js';
import type { RpcCtx } from './rpc-ctx.js';

export async function rpcGetContext(
  ctx: RpcCtx,
  agentId: string,
  ownerId: string | null = null,
): Promise<Record<string, unknown> | DOError> {
  return ctx.withMember(agentId, ownerId, (resolved) => {
    // Always bump calling agent's heartbeat
    ctx.sql.exec(
      "UPDATE members SET last_heartbeat = datetime('now') WHERE agent_id = ?",
      resolved,
    );

    // Per-agent messages (always fresh -- has target_agent filter, can't be cached team-wide)
    const messages = ctx.sql
      .exec(
        `SELECT handle AS from_handle, host_tool AS from_tool, host_tool AS from_host_tool, agent_surface AS from_agent_surface, text, created_at
         FROM messages
         WHERE created_at > datetime('now', '-1 hour')
           AND (target_agent IS NULL OR target_agent = ?)
         ORDER BY created_at DESC LIMIT 10`,
        resolved,
      )
      .toArray();

    // Daemon status - always fresh (computed from live WebSocket connections)
    const daemon = {
      connected: ctx.hasExecutorConnected(),
      available_tools: ctx.getAvailableSpawnTools(),
    };

    // Return cached team-wide context if fresh
    const cached = ctx.contextCache.get();
    if (cached) {
      return { ...cached, messages, daemon };
    }

    ctx.maybeCleanup();

    const connectedIds = ctx.getConnectedAgentIds();
    const teamContext = queryTeamContext(ctx.sql, connectedIds);

    ctx.contextCache.set(teamContext);

    return { ...teamContext, messages, daemon };
  });
}

export async function rpcGetSummary(
  ctx: RpcCtx,
  ownerId: string,
): Promise<ReturnType<typeof queryTeamSummary> | DOError> {
  return ctx.withOwner(ownerId, () => {
    ctx.maybeCleanup();
    return queryTeamSummary(ctx.sql);
  });
}
