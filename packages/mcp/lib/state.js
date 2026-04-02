// Guarded agent state container for the MCP server.
//
// Prevents accidental writes to undeclared properties (typo protection) and
// makes the state shape explicit. All declared properties remain mutable —
// this is intentional for a single-process, single-threaded MCP server where
// serial tool execution is guaranteed by the stdio transport.

/**
 * @typedef {Object} AgentStateShape
 * @property {string|null}  teamId           - Current team ID (from .chinwag file)
 * @property {WebSocket|null} ws             - WebSocket to TeamDO (presence channel)
 * @property {string|null}  sessionId        - Active session ID
 * @property {string|null}  tty              - Parent TTY path for terminal title
 * @property {string|null}  reportedModel    - Model identifier last reported to server (null = not yet reported)
 * @property {number}       lastActivity     - Epoch ms of last tool invocation
 * @property {*}            heartbeatInterval - setInterval handle for team heartbeat
 * @property {boolean}      shuttingDown     - True once cleanup begins (prevents reconnect)
 */

/**
 * Creates a guarded agent state container.
 *
 * The returned object looks and acts like a plain object for reads
 * (`state.teamId`), but the Proxy layer rejects writes to any key
 * not present in the initial shape. This catches typos like
 * `state.temId = x` at the call site instead of letting them become
 * silent no-ops that surface as unreproducible bugs later.
 *
 * @param {AgentStateShape} initial
 * @returns {AgentStateShape}
 */
export function createAgentState(initial) {
  const data = { ...initial };
  const validKeys = new Set(Object.keys(data));

  return new Proxy(data, {
    set(target, prop, value) {
      const key = String(prop);
      if (!validKeys.has(key)) {
        throw new Error(
          `[chinwag] AgentState: unexpected property "${key}". ` +
            'Declare it in the createAgentState() initial object.',
        );
      }
      target[key] = value;
      return true;
    },
    deleteProperty(_target, prop) {
      throw new Error(`[chinwag] AgentState: cannot delete property "${String(prop)}".`);
    },
  });
}
