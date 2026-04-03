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
function withTeam({ state, team }, handler, options = {}) {
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
function wrapWithActivity(addTool, { state }) {
  return (name, schema, handler) => {
    const wrappedHandler = async (...args) => {
      state.lastActivity = Date.now();
      return handler(...args);
    };
    return addTool(name, schema, wrappedHandler);
  };
}
function registerTools(server, deps) {
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
function registerResources(server, profile) {
  server.resource(
    'profile',
    'chinwag://profile',
    {
      description:
        'Your agent profile -- languages, frameworks, tools detected from your environment.',
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
export { registerResources, registerTools, withTeam };
