// MCP tool and resource registration orchestrator.
// Wires together all tool modules and registers them on the MCP server.

import { registerTeamTool } from './team.js';
import { registerActivityTool } from './activity.js';
import { registerConflictsTool } from './conflicts.js';
import { registerContextTool } from './context.js';
import { registerMemoryTools } from './memory.js';
import { registerLockTools } from './locks.js';
import { registerMessagingTool } from './messaging.js';
import { registerOutcomeTool } from './outcome.js';
import { registerCommitsTool } from './commits.js';
import { registerIntegrationTools } from './integrations.js';
import { registerTelemetryTools } from './telemetry.js';
import { registerBudgetTool } from './budget.js';
import type { ToolDeps, AddToolFn } from './types.js';
import type { EnvironmentProfile } from '../profile.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Re-export withTeam for any external consumers.
export { withTeam } from './middleware.js';

/**
 * Wraps addTool to track last activity time.
 * Presence is handled by the WebSocket connection in index.js --
 * this wrapper just keeps `state.lastActivity` current.
 */
function wrapWithActivity(addTool: AddToolFn, { state }: Pick<ToolDeps, 'state'>): AddToolFn {
  return (name, schema, handler) => {
    const wrappedHandler = async (args: Record<string, unknown>) => {
      const now = Date.now();
      state.lastActivity = now;
      state.toolCalls.push({ tool: name, at: now });
      return handler(args);
    };
    return addTool(name, schema, wrappedHandler);
  };
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const addTool: AddToolFn = (server.registerTool?.bind(server) ||
    server.tool?.bind(server)) as AddToolFn;
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
  registerOutcomeTool(wrappedAddTool, deps);
  registerCommitsTool(wrappedAddTool, deps);
  registerIntegrationTools(wrappedAddTool, deps);
  registerTelemetryTools(wrappedAddTool, deps);
  registerBudgetTool(wrappedAddTool, deps);
}

export function registerResources(server: McpServer, profile: EnvironmentProfile): void {
  server.resource(
    'profile',
    'chinmeister://profile',
    {
      description:
        'Your agent profile -- languages, frameworks, tools detected from your environment.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'chinmeister://profile',
          mimeType: 'application/json',
          text: JSON.stringify(profile, null, 2),
        },
      ],
    }),
  );
}
