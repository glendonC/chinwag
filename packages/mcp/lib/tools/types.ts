// Shared type definitions for MCP tool modules.

import type { TeamHandlers } from '../team.js';
import type { McpState } from '../lifecycle.js';
import type { EnvironmentProfile } from '../profile.js';
import type { McpToolResult } from '../utils/responses.js';

/** Function signature for registering an MCP tool. */
export type AddToolFn = (
  name: string,
  schema: { description: string; inputSchema: any },
  handler: (...args: any[]) => Promise<McpToolResult>,
) => void;

/** Integration doctor interface. */
export interface IntegrationDoctor {
  scanHostIntegrations(cwd: string): any[];
  configureHostIntegration(cwd: string, hostId: string, options?: { surfaceId?: string }): any;
}

/** Dependencies injected into tool registration functions. */
export interface ToolDeps {
  team: TeamHandlers;
  state: McpState;
  profile: EnvironmentProfile;
  integrationDoctor?: IntegrationDoctor;
}
