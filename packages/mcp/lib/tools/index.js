// MCP tool and resource registration orchestrator.
// Wires together all tool modules and registers them on the MCP server.

import { teamPreamble } from '../context.js';
import { noTeam, errorResult } from '../utils/responses.js';
import { registerTeamTool } from './team.js';
import { registerActivityTool } from './activity.js';
import { registerConflictsTool } from './conflicts.js';
import { registerContextTool } from './context.js';
import { registerMemoryTools } from './memory.js';
import { registerLockTools } from './locks.js';
import { registerMessagingTool } from './messaging.js';
import { registerIntegrationTools } from './integrations.js';

/**
 * Wraps addTool to track last activity time.
 * Presence is handled by the WebSocket connection in index.js —
 * this wrapper just keeps `state.lastActivity` current.
 */
function wrapWithActivity(addTool, { state }) {
  return (name, schema, handler) => {
    const wrappedHandler = async (...args) => {
      state.lastActivity = Date.now();
      return handler(...args);
    };
    return addTool(name, schema, wrappedHandler);
  };
}

/**
 * Creates a tool handler that requires team membership and catches errors.
 * Eliminates the repeated noTeam() guard and try/catch pattern from every tool.
 *
 * @param {object} deps - Tool dependencies containing { team, state }
 * @param {(args: object, ctx: { preamble: string }) => Promise<object>} handler
 *   Business logic function. Receives the tool args and a context object with
 *   the team preamble string. Should return an MCP content result.
 * @param {object} [options]
 * @param {boolean} [options.skipPreamble=false] - If true, preamble is empty string
 * @returns {(args: object) => Promise<object>} MCP tool handler
 */
export function withTeam(deps, handler, options = {}) {
  const { team, state } = deps;
  return async (args) => {
    if (!state.teamId) return noTeam();
    try {
      const preamble = options.skipPreamble ? '' : await teamPreamble(team, state.teamId);
      return await handler(args, { preamble });
    } catch (err) {
      return errorResult(err);
    }
  };
}

export function registerTools(server, deps) {
  const addTool = server.registerTool?.bind(server) || server.tool?.bind(server);
  if (!addTool) {
    throw new TypeError('MCP server does not support tool registration');
  }

  const wrappedAddTool = wrapWithActivity(addTool, deps);

  registerTeamTool(wrappedAddTool, deps);
  registerActivityTool(wrappedAddTool, deps);
  registerConflictsTool(wrappedAddTool, deps);
  registerContextTool(wrappedAddTool, deps);
  registerMemoryTools(wrappedAddTool, deps);
  registerLockTools(wrappedAddTool, deps);
  registerMessagingTool(wrappedAddTool, deps);
  registerIntegrationTools(wrappedAddTool, deps);
}

export function registerResources(server, profile) {
  server.resource(
    'profile',
    'chinwag://profile',
    {
      description:
        'Your agent profile — languages, frameworks, tools detected from your environment.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'chinwag://profile',
          mimeType: 'application/json',
          text: JSON.stringify(profile, null, 2),
        },
      ],
    }),
  );
}
