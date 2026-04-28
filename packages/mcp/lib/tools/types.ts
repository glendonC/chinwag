// Shared type definitions for MCP tool modules.

import type { TeamHandlers } from '../team.js';
import type { McpState } from '../lifecycle.js';
import type { EnvironmentProfile } from '../profile.js';
import type { McpToolResult } from '../utils/responses.js';
import type {
  IntegrationScanResult,
  ConfigureResult,
} from '@chinmeister/shared/integration-doctor.js';

/**
 * Function signature for registering an MCP tool.
 * Handler args are typed as Record<string, unknown> at the registration
 * boundary - individual tool handlers use Zod-inferred types internally
 * for static type checking, with a cast at the registration site only.
 */

export type ToolHandler = (args: Record<string, unknown>) => Promise<McpToolResult>;

export type AddToolFn = (
  name: string,
  schema: { description: string; inputSchema: unknown },
  handler: ToolHandler,
) => void;

/** Integration doctor interface - mirrors shared/integration-doctor.ts exports. */
export interface IntegrationDoctor {
  scanHostIntegrations(cwd: string): IntegrationScanResult[];
  configureHostIntegration(
    cwd: string,
    hostId: string,
    options?: { surfaceId?: string | null | undefined },
  ): ConfigureResult;
}

/** Dependencies injected into tool registration functions. */
export interface ToolDeps {
  team: TeamHandlers;
  state: McpState;
  profile: EnvironmentProfile;
  integrationDoctor?: IntegrationDoctor;
}
