// Shared initialization factory for all MCP entry points (index.js, hook.js, channel.js).
// Consolidates config loading, identity resolution, API client init, and team setup.
// CRITICAL: Never console.log — stdio transport. Use console.error for all logging.

import { loadConfig, configExists } from './config.js';
import { api } from './api.js';
import { findTeamFile, teamHandlers } from './team.js';
import { detectRuntimeIdentity, getConfiguredAgentId, generateSessionAgentId } from './identity.js';
import { resolveAgentIdentity } from './lifecycle.js';
import { validateConfig } from './auth.js';
import { createLogger } from './utils/logger.js';
import type { RuntimeIdentity } from '@chinwag/shared/agent-identity.js';
import type { ApiClient, TeamHandlers } from './team.js';

const log = createLogger('bootstrap');

// ── Types ──

/** Options that control how bootstrap behaves for each entry point. */
export interface BootstrapOptions {
  /**
   * How to identify the host tool.
   * - 'unknown': let detection figure it out (index.js, channel.js)
   * - 'claude-code': force Claude Code identity (hook.js)
   */
  hostToolHint?: string;

  /** Default transport label for runtime identity detection. */
  defaultTransport?: string;

  /**
   * Config validation strategy:
   * - 'full': call validateConfig with token refresh + /me preflight (index.js)
   * - 'simple': just check configExists + loadConfig, no network call (hook.js, channel.js)
   */
  configMode?: 'full' | 'simple';

  /**
   * Identity resolution strategy:
   * - 'session': use getConfiguredAgentId || generateSessionAgentId (index.js)
   * - 'resolve': use resolveAgentIdentity from lifecycle (hook.js, channel.js)
   */
  identityMode?: 'session' | 'resolve';

  /**
   * What to do when config, token, or team file is missing.
   * - 'exit-error': log error and exit with non-zero code (index.js via validateConfig)
   * - 'exit-silent': exit(0) silently, never block the caller (hook.js)
   * - 'exit-mixed': exit(1) for config/token, exit(0) for missing team (channel.js)
   * - 'return-null': return null so the caller can decide (not currently used)
   */
  onMissing?: 'exit-error' | 'exit-silent' | 'exit-mixed' | 'return-null';

  /** Label for log messages, e.g. 'chinwag' or 'chinwag-channel'. */
  logPrefix?: string;
}

/**
 * Config shape after bootstrap. Uses a loose record type so it works with both
 * ChinwagConfig (from loadConfig) and AuthConfig (from validateConfig, which
 * may add refresh_token and other fields after token refresh).
 */
export type BootstrapConfig = Record<string, unknown> & { token?: string };

/** Fully resolved bootstrap result — everything an entry point needs. */
export interface BootstrapResult {
  config: BootstrapConfig;
  runtime: RuntimeIdentity;
  agentId: string;
  /** Whether the agent ID was resolved from an exact session record (hook/channel). */
  hasExactSession: boolean;
  client: ApiClient;
  team: TeamHandlers;
  teamId: string | null;
}

// ── Factory ──

/**
 * Bootstrap shared initialization for any MCP entry point.
 *
 * Returns a fully resolved BootstrapResult, or null if `onMissing: 'return-null'`
 * is set and a required value is missing. For other onMissing modes, the function
 * calls process.exit() and never returns.
 */
export async function bootstrap(options: BootstrapOptions = {}): Promise<BootstrapResult | null> {
  const {
    hostToolHint = 'unknown',
    defaultTransport = 'mcp',
    configMode = 'simple',
    identityMode = 'resolve',
    onMissing = 'exit-error',
    logPrefix = 'chinwag',
  } = options;

  // 1. Load and validate config
  let config: BootstrapResult['config'];

  if (configMode === 'full') {
    // Full validation: checks /me, refreshes expired tokens, exits on failure
    // loadConfig returns ChinwagConfig which is a subset of AuthConfig; the cast
    // bridges the index-signature mismatch between the two interfaces.
    const result = await validateConfig({
      configExists,
      loadConfig: loadConfig as () => Record<string, unknown> | null,
      api,
    });
    config = result.config as BootstrapConfig;
  } else {
    // Simple check: just load config, no network call
    if (!configExists()) {
      return handleMissing(onMissing, logPrefix, 'No config found.');
    }
    const loaded = loadConfig();
    if (!loaded?.token) {
      return handleMissing(onMissing, logPrefix, 'Invalid config — missing token.');
    }
    config = loaded as BootstrapConfig;
  }

  // 2. Find team file
  const teamId = findTeamFile();
  if (!teamId) {
    if (onMissing === 'exit-mixed') {
      // channel.js: missing team is a clean exit, not an error
      log.info('No .chinwag file — inactive.');
      process.exit(0);
    } else if (onMissing === 'exit-silent') {
      process.exit(0);
    }
    // For 'exit-error' and 'return-null': teamId is allowed to be null
    // (index.js proceeds with teamId=null; tools just skip team ops)
  }

  // 3. Detect runtime identity
  const runtime = detectRuntimeIdentity(hostToolHint, { defaultTransport });
  const toolName = runtime.hostTool;

  // 4. Resolve agent identity
  let agentId: string;
  let hasExactSession = false;

  if (identityMode === 'session') {
    // index.js style: configured agent ID or generate a session-scoped one
    agentId = getConfiguredAgentId(runtime) || generateSessionAgentId(config.token!, runtime);
    hasExactSession = !!getConfiguredAgentId(runtime);
  } else {
    // hook.js / channel.js style: resolve from session registry
    const resolved = resolveAgentIdentity(config.token!, toolName);
    agentId = resolved.agentId;
    hasExactSession = resolved.hasExactSession;
  }

  // 5. Create API client and team handlers
  const client = api(config, { agentId, runtimeIdentity: runtime });
  const team = teamHandlers(client);

  return {
    config,
    runtime,
    agentId,
    hasExactSession,
    client,
    team,
    teamId,
  };
}

// ── Helpers ──

/**
 * Handle a missing prerequisite (config, token, or team) according to the
 * configured onMissing strategy.
 */
function handleMissing(
  mode: NonNullable<BootstrapOptions['onMissing']>,
  logPrefix: string,
  reason: string,
): null | never {
  switch (mode) {
    case 'exit-silent':
      process.exit(0);
      return null as never; // unreachable, satisfies TS
    case 'exit-mixed':
      // For config/token issues in channel.js: exit(1) with a log
      console.error(`[${logPrefix}] ${reason}`);
      process.exit(1);
      return null as never;
    case 'exit-error':
      // validateConfig handles its own exits, this shouldn't be reached
      // for configMode 'full'. For safety, log and exit.
      console.error(`[${logPrefix}] ${reason}`);
      process.exit(1);
      return null as never;
    case 'return-null':
      return null;
  }
}
