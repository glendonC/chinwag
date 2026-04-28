// Pure helpers for reading team presence from Hibernation WebSocket tags.
//
// Each helper takes the DurableObjectState directly so it can be unit-tested
// without standing up a whole DO. Semantics are unchanged from the inlined
// versions that used to live on TeamDO.

/** Agent IDs with an active `role:agent` WebSocket connection. */
export function getConnectedAgentIds(ctx: DurableObjectState): Set<string> {
  return new Set(
    ctx
      .getWebSockets('role:agent')
      .flatMap((ws) => ctx.getTags(ws))
      .filter((tag) => !tag.startsWith('role:') && !tag.startsWith('spawn:')),
  );
}

/**
 * All member IDs with any active WebSocket (agent, watcher, daemon).
 * Used by cleanup eviction protection - any connected socket keeps the
 * member row alive regardless of role.
 */
export function getAllConnectedMemberIds(ctx: DurableObjectState): Set<string> {
  return new Set(
    ctx
      .getWebSockets()
      .flatMap((ws) => ctx.getTags(ws))
      .filter((tag) => !tag.startsWith('role:') && !tag.startsWith('spawn:')),
  );
}

/** All connected sockets with spawn capability (identified by `spawn:*` tags). */
export function getExecutorSockets(ctx: DurableObjectState): WebSocket[] {
  const executors: WebSocket[] = [];
  for (const ws of ctx.getWebSockets()) {
    try {
      if (ctx.getTags(ws).some((t) => t.startsWith('spawn:'))) {
        executors.push(ws);
      }
    } catch {
      /* socket may be closing */
    }
  }
  return executors;
}

export function hasExecutorConnected(ctx: DurableObjectState): boolean {
  return getExecutorSockets(ctx).length > 0;
}

/** Collect available spawn tools from all connected daemon WebSocket tags. */
export function getAvailableSpawnTools(ctx: DurableObjectState): string[] {
  const tools = new Set<string>();
  for (const ws of getExecutorSockets(ctx)) {
    try {
      for (const tag of ctx.getTags(ws)) {
        if (tag.startsWith('spawn:')) tools.add(tag.slice(6));
      }
    } catch {
      /* socket may be closing */
    }
  }
  return [...tools];
}
