// Guarded agent state container for the MCP server.
//
// Prevents accidental writes to undeclared properties (typo protection) and
// makes the state shape explicit. All declared properties remain mutable —
// this is intentional for a single-process, single-threaded MCP server where
// serial tool execution is guaranteed by the stdio transport.

import type { McpState } from './lifecycle.js';

/**
 * Proxy handler that rejects writes to undeclared keys and prevents deletion.
 */
type GuardedHandler<T extends object> = ProxyHandler<T> & {
  set(target: T, prop: string | symbol, value: unknown): boolean;
  deleteProperty(target: T, prop: string | symbol): never;
};

/**
 * Creates a guarded agent state container.
 *
 * The returned object looks and acts like a plain object for reads
 * (`state.teamId`), but the Proxy layer rejects writes to any key
 * not present in the initial shape. This catches typos like
 * `state.temId = x` at the call site instead of letting them become
 * silent no-ops that surface as unreproducible bugs later.
 */
export function createAgentState(initial: McpState): McpState {
  const data: McpState = { ...initial };
  const validKeys = new Set<string>(Object.keys(data));

  const handler: GuardedHandler<McpState> = {
    set(target: McpState, prop: string | symbol, value: unknown): boolean {
      const key = String(prop);
      if (!validKeys.has(key)) {
        throw new Error(
          `[chinmeister] AgentState: unexpected property "${key}". ` +
            'Declare it in the createAgentState() initial object.',
        );
      }
      (target as unknown as Record<string, unknown>)[key] = value;
      return true;
    },
    deleteProperty(_target: McpState, prop: string | symbol): never {
      throw new Error(`[chinmeister] AgentState: cannot delete property "${String(prop)}".`);
    },
  };

  return new Proxy(data, handler);
}
