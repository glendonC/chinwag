import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getHostIntegrationById } from './integration-model.js';
import { MCP_TOOLS } from './tool-registry.js';

const DEFAULT_HOOK_HOST = MCP_TOOLS.find((tool) => tool.hooks)?.id || 'claude-code';

interface HookCommand {
  type?: string;
  command?: string;
}

interface HookConfigEntry {
  matcher?: string;
  hooks?: HookCommand[];
  command?: string;
}

interface McpServerEntry {
  command?: string;
  args?: string[];
}

export interface ConfigJson {
  mcpServers?: Record<string, McpServerEntry>;
  hooks?: Record<string, HookConfigEntry[]>;
  [key: string]: unknown;
}

export interface WriteResult {
  ok?: boolean;
  error?: string;
}

export interface ConfigureResult {
  ok?: boolean;
  error?: string;
  name?: string;
  detail?: string;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readJson(filePath: string): ConfigJson {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as ConfigJson;
  } catch {
    return {};
  }
}

export function writeJson(filePath: string, value: ConfigJson): void {
  const dir = dirname(filePath);
  if (dir !== '.') mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

export function buildChinmeisterCliArgs(
  subcommand: string,
  { hostId = null, surfaceId = null }: { hostId?: string | null; surfaceId?: string | null } = {},
): string[] {
  const args = ['-y', 'chinmeister', subcommand];
  if (hostId) args.push('--tool', hostId);
  if (surfaceId) args.push('--surface', surfaceId);
  return args;
}

export function buildChinmeisterHookCommand(
  subcommand: string,
  {
    hostId = DEFAULT_HOOK_HOST,
    surfaceId = null,
  }: { hostId?: string; surfaceId?: string | null } = {},
): string {
  const args = ['npx', '-y', 'chinmeister', 'hook', subcommand];
  if (hostId && hostId !== DEFAULT_HOOK_HOST) args.push('--tool', hostId);
  if (surfaceId) args.push('--surface', surfaceId);
  return args.join(' ');
}

function isChinmeisterHookCommand(command: unknown): boolean {
  return typeof command === 'string' && command.includes('chinmeister hook');
}

function buildExpectedMcpArgs(
  hostId: string,
  { subcommand = 'mcp', sharedRoot = false }: { subcommand?: string; sharedRoot?: boolean } = {},
): string[] {
  return buildChinmeisterCliArgs(subcommand, {
    hostId: sharedRoot ? null : hostId,
  });
}

export function hasMatchingMcpEntry(
  config: ConfigJson,
  hostId: string,
  { channel = false, sharedRoot = false }: { channel?: boolean; sharedRoot?: boolean } = {},
): boolean {
  const servers = config.mcpServers || {};
  const primary = servers.chinmeister;
  const expectedPrimary = buildExpectedMcpArgs(hostId, { subcommand: 'mcp', sharedRoot });
  const primaryOk =
    primary?.command === 'npx' &&
    JSON.stringify(primary.args || []) === JSON.stringify(expectedPrimary);
  if (!primaryOk) return false;

  if (!channel) return true;
  const channelEntry = servers['chinmeister-channel'];
  const expectedChannel = buildExpectedMcpArgs(hostId, { subcommand: 'channel', sharedRoot });
  return (
    channelEntry?.command === 'npx' &&
    JSON.stringify(channelEntry.args || []) === JSON.stringify(expectedChannel)
  );
}

export function hasMatchingHookConfig(
  config: ConfigJson | null,
  hostId: string = DEFAULT_HOOK_HOST,
  format: 'claude' | 'windsurf' = 'claude',
): boolean {
  const hooks = config?.hooks || {};

  if (format === 'windsurf') {
    const expected: Record<string, string> = {
      pre_write_code: buildChinmeisterHookCommand('check-conflict', { hostId }),
      post_write_code: buildChinmeisterHookCommand('report-edit', { hostId }),
      post_run_command: buildChinmeisterHookCommand('report-commit', { hostId }),
    };
    return Object.entries(expected).every(([event, command]) => {
      const entries = hooks[event] || [];
      return entries.some((hook) => (hook.hooks?.[0]?.command || hook.command) === command);
    });
  }

  const expected: Record<string, string> = {
    PreToolUse: buildChinmeisterHookCommand('check-conflict', { hostId }),
    PostToolUse: buildChinmeisterHookCommand('report-edit', { hostId }),
    SessionStart: buildChinmeisterHookCommand('session-start', { hostId }),
  };
  return Object.entries(expected).every(([event, command]) => {
    const entries = hooks[event] || [];
    return entries.some((hook) => (hook.hooks?.[0]?.command || hook.command) === command);
  });
}

export function writeMcpConfig(
  cwd: string,
  relativePath: string,
  {
    channel = false,
    hostId = null,
    surfaceId = null,
  }: {
    channel?: boolean | undefined;
    hostId?: string | null | undefined;
    surfaceId?: string | null | undefined;
  } = {},
): WriteResult {
  const filePath = join(cwd, relativePath);
  const isSharedRootConfig = relativePath === '.mcp.json' || relativePath === 'mcp.json';
  const host = hostId ? getHostIntegrationById(hostId) : null;
  const config = readJson(filePath);

  if (!config.mcpServers) config.mcpServers = {};

  if (isSharedRootConfig) {
    for (const key of Object.keys(config.mcpServers)) {
      if (key.startsWith('chinmeister-') && key !== 'chinmeister-channel') {
        delete config.mcpServers[key];
      }
    }
    config.mcpServers.chinmeister = {
      command: 'npx',
      args: buildChinmeisterCliArgs('mcp', { hostId: null, surfaceId }),
    };
    if (config.mcpServers['chinmeister-channel']) {
      config.mcpServers['chinmeister-channel'] = {
        command: 'npx',
        args: buildChinmeisterCliArgs('channel', { hostId: null, surfaceId }),
      };
    }
  } else {
    for (const key of Object.keys(config.mcpServers)) {
      if (key === 'chinmeister' || key.startsWith('chinmeister-')) {
        delete config.mcpServers[key];
      }
    }
    config.mcpServers.chinmeister = {
      command: 'npx',
      args: buildChinmeisterCliArgs('mcp', { hostId: host?.id || null, surfaceId }),
    };
  }

  if (channel && config.mcpServers) {
    config.mcpServers['chinmeister-channel'] = {
      command: 'npx',
      args: buildChinmeisterCliArgs('channel', {
        hostId: isSharedRootConfig ? null : host?.id || null,
        surfaceId,
      }),
    };
  }

  try {
    writeJson(filePath, config);
  } catch (error) {
    return { error: `Failed to write ${relativePath}: ${getErrorMessage(error)}` };
  }

  return { ok: true };
}

export function writeHooksConfig(
  cwd: string,
  {
    hostId = DEFAULT_HOOK_HOST,
    surfaceId = null,
  }: { hostId?: string; surfaceId?: string | null } = {},
): WriteResult {
  const filePath = join(cwd, '.claude', 'settings.json');
  const config = readJson(filePath);

  if (!config.hooks) config.hooks = {};

  const chinmeisterHooks: Record<string, HookConfigEntry[]> = {
    PreToolUse: [
      {
        matcher: 'Edit|Write',
        hooks: [
          {
            type: 'command',
            command: buildChinmeisterHookCommand('check-conflict', { hostId, surfaceId }),
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: 'Edit|Write',
        hooks: [
          {
            type: 'command',
            command: buildChinmeisterHookCommand('report-edit', { hostId, surfaceId }),
          },
        ],
      },
      {
        matcher: 'Read',
        hooks: [
          {
            type: 'command',
            command: buildChinmeisterHookCommand('report-read', { hostId, surfaceId }),
          },
        ],
      },
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: buildChinmeisterHookCommand('report-commit', { hostId, surfaceId }),
          },
        ],
      },
    ],
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: buildChinmeisterHookCommand('session-start', { hostId, surfaceId }),
          },
        ],
      },
    ],
  };

  for (const [event, entries] of Object.entries(chinmeisterHooks)) {
    const currentEntries = config.hooks[event] || [];
    config.hooks[event] = currentEntries.filter((hook) => {
      const existingCommand = hook.hooks?.[0]?.command || hook.command;
      return !isChinmeisterHookCommand(existingCommand);
    });
    config.hooks[event].push(...entries);
  }

  try {
    writeJson(filePath, config);
  } catch (error) {
    return { error: `Failed to write .claude/settings.json: ${getErrorMessage(error)}` };
  }

  return { ok: true };
}

/**
 * Write Cursor hook config to .cursor/hooks.json.
 * Cursor hooks use the same event names as Claude Code with identical payload structure.
 */
export function writeCursorHooksConfig(cwd: string): WriteResult {
  const filePath = join(cwd, '.cursor', 'hooks.json');
  const config = readJson(filePath);
  if (!config.hooks) config.hooks = {};

  const chinmeisterHooks: Record<string, HookConfigEntry[]> = {
    PreToolUse: [
      {
        matcher: 'Edit|Write',
        hooks: [
          {
            type: 'command',
            command: buildChinmeisterHookCommand('check-conflict', { hostId: 'cursor' }),
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: 'Edit|Write',
        hooks: [
          {
            type: 'command',
            command: buildChinmeisterHookCommand('report-edit', { hostId: 'cursor' }),
          },
        ],
      },
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: buildChinmeisterHookCommand('report-commit', { hostId: 'cursor' }),
          },
        ],
      },
    ],
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: buildChinmeisterHookCommand('session-start', { hostId: 'cursor' }),
          },
        ],
      },
    ],
  };

  for (const [event, entries] of Object.entries(chinmeisterHooks)) {
    const current = (config.hooks[event] || []) as HookConfigEntry[];
    config.hooks[event] = current.filter(
      (h) => !isChinmeisterHookCommand(h.hooks?.[0]?.command || h.command),
    );
    (config.hooks[event] as HookConfigEntry[]).push(...entries);
  }

  try {
    writeJson(filePath, config);
  } catch (error) {
    return { error: `Failed to write .cursor/hooks.json: ${getErrorMessage(error)}` };
  }
  return { ok: true };
}

/**
 * Write Windsurf hook config to .windsurf/hooks.json.
 * Windsurf uses snake_case event names and simpler payload structure.
 */
export function writeWindsurfHooksConfig(cwd: string): WriteResult {
  const filePath = join(cwd, '.windsurf', 'hooks.json');
  const config = readJson(filePath);
  if (!config.hooks) config.hooks = {};

  const chinmeisterHooks: Record<string, HookConfigEntry[]> = {
    pre_write_code: [
      { command: buildChinmeisterHookCommand('check-conflict', { hostId: 'windsurf' }) },
    ],
    post_write_code: [
      { command: buildChinmeisterHookCommand('report-edit', { hostId: 'windsurf' }) },
    ],
    post_run_command: [
      { command: buildChinmeisterHookCommand('report-commit', { hostId: 'windsurf' }) },
    ],
  };

  for (const [event, entries] of Object.entries(chinmeisterHooks)) {
    const current = (config.hooks[event] || []) as HookConfigEntry[];
    config.hooks[event] = current.filter((h) => !isChinmeisterHookCommand(h.command));
    (config.hooks[event] as HookConfigEntry[]).push(...entries);
  }

  try {
    writeJson(filePath, config);
  } catch (error) {
    return { error: `Failed to write .windsurf/hooks.json: ${getErrorMessage(error)}` };
  }
  return { ok: true };
}

export function configureHostIntegration(
  cwd: string,
  hostId: string,
  options: { surfaceId?: string | null | undefined } = {},
): ConfigureResult {
  const host = getHostIntegrationById(hostId);
  if (!host) return { error: `Unknown host integration: ${hostId}` };
  // Tools that don't speak MCP (e.g. Copilot) register with an empty
  // `mcpConfig`. They still belong in the registry for clientInfo attribution
  // but `chinmeister add <tool>` has nothing to configure for them — surface a
  // clear message rather than writing to the project root.
  if (!host.mcpConfig) {
    return {
      error: `${host.name} does not support MCP configuration via chinmeister. Sessions will still be attributed to ${host.id} when detected.`,
    };
  }

  const mcpResult = writeMcpConfig(cwd, host.mcpConfig, {
    channel: host.channel,
    hostId: host.id,
    surfaceId: options.surfaceId || null,
  });
  if (mcpResult.error) return mcpResult;

  if (host.hooks) {
    let hookResult: WriteResult;
    if (hostId === 'cursor') {
      hookResult = writeCursorHooksConfig(cwd);
    } else if (hostId === 'windsurf') {
      hookResult = writeWindsurfHooksConfig(cwd);
    } else {
      hookResult = writeHooksConfig(cwd, {
        hostId: host.id,
        surfaceId: options.surfaceId || null,
      });
    }
    if (hookResult.error) return hookResult;
  }

  let detail = host.mcpConfig;
  if (host.hooks) detail += ' + hooks';
  if (host.channel) detail += ' + channel';

  return { ok: true, name: host.name, detail };
}
