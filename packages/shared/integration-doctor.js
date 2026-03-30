import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { execFileSync } from 'child_process';
import { HOST_INTEGRATIONS, getHostIntegrationById } from './integration-model.js';

function readJson(filePath) {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeJson(filePath, value) {
  const dir = dirname(filePath);
  if (dir !== '.') mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

export function commandExists(cmd) {
  try {
    const bin = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(bin, [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function buildChinwagCliArgs(subcommand, { hostId = null, surfaceId = null } = {}) {
  const args = ['-y', 'chinwag', subcommand];
  if (hostId) args.push('--tool', hostId);
  if (surfaceId) args.push('--surface', surfaceId);
  return args;
}

export function buildChinwagHookCommand(subcommand, { hostId = 'claude-code', surfaceId = null } = {}) {
  const args = ['npx', '-y', 'chinwag', 'hook', subcommand];
  // Hooks are currently Claude Code-specific, so keep the subcommand positional
  // and avoid forcing argv reshaping in the runtime handoff path.
  if (hostId && hostId !== 'claude-code') args.push('--tool', hostId);
  if (surfaceId) args.push('--surface', surfaceId);
  return args.join(' ');
}

function isChinwagHookCommand(command) {
  return typeof command === 'string'
    && (command.includes('chinwag-hook') || command.includes('chinwag hook'));
}

function buildExpectedMcpArgs(hostId, { subcommand = 'mcp', sharedRoot = false } = {}) {
  return buildChinwagCliArgs(subcommand, {
    hostId: sharedRoot ? null : hostId,
  });
}

function hasMatchingMcpEntry(config, hostId, { channel = false, sharedRoot = false } = {}) {
  const servers = config?.mcpServers || {};
  const primary = servers.chinwag;
  const expectedPrimary = buildExpectedMcpArgs(hostId, { subcommand: 'mcp', sharedRoot });
  const primaryOk = primary?.command === 'npx'
    && JSON.stringify(primary.args || []) === JSON.stringify(expectedPrimary);
  if (!primaryOk) return false;

  if (!channel) return true;
  const channelEntry = servers['chinwag-channel'];
  const expectedChannel = buildExpectedMcpArgs(hostId, { subcommand: 'channel', sharedRoot });
  return channelEntry?.command === 'npx'
    && JSON.stringify(channelEntry.args || []) === JSON.stringify(expectedChannel);
}

function hasMatchingHookConfig(config) {
  const hooks = config?.hooks || {};
  const expected = {
    PreToolUse: buildChinwagHookCommand('check-conflict'),
    PostToolUse: buildChinwagHookCommand('report-edit'),
    SessionStart: buildChinwagHookCommand('session-start'),
  };

  return Object.entries(expected).every(([event, command]) => {
    const entries = hooks[event] || [];
    return entries.some((hook) => (hook.hooks?.[0]?.command || hook.command) === command);
  });
}

function detectHost(cwd, host) {
  const dirs = host.detect?.dirs || [];
  const cmds = host.detect?.cmds || [];
  return dirs.some((dir) => existsSync(join(cwd, dir))) || cmds.some((cmd) => commandExists(cmd));
}

export function detectHostIntegrations(cwd) {
  return HOST_INTEGRATIONS.filter((host) => detectHost(cwd, host));
}

export function formatIntegrationScanResults(scanResults, { onlyDetected = false } = {}) {
  const rows = onlyDetected ? scanResults.filter((item) => item.detected) : scanResults;
  if (rows.length === 0) return 'No supported integrations detected in this repo.';

  const lines = ['Integrations:'];
  for (const item of rows) {
    const summary = `${item.name} [${item.tier}] — ${item.status}`;
    const capabilityText = item.capabilities?.length ? ` (${item.capabilities.join(', ')})` : '';
    lines.push(`- ${summary}${capabilityText}`);
    if (item.detected) lines.push(`  config: ${item.configPath}`);
    if (item.issues?.length) {
      for (const issue of item.issues) lines.push(`  issue: ${issue}`);
    }
  }
  return lines.join('\n');
}

export function summarizeIntegrationScan(scanResults, { onlyDetected = true } = {}) {
  const rows = onlyDetected ? scanResults.filter((item) => item.detected) : scanResults;
  if (rows.length === 0) return { text: 'No supported integrations detected.', tone: 'info' };

  const ready = rows.filter((item) => item.status === 'ready').length;
  const problematic = rows.filter((item) => item.status !== 'ready').length;
  if (problematic === 0) {
    return {
      text: `${ready} integration${ready === 1 ? '' : 's'} ready.`,
      tone: 'success',
    };
  }

  return {
    text: `${ready} ready · ${problematic} need attention.`,
    tone: 'warning',
  };
}

export function writeMcpConfig(cwd, relativePath, { channel = false, hostId = null, surfaceId = null } = {}) {
  const filePath = join(cwd, relativePath);
  const isSharedRootConfig = relativePath === '.mcp.json' || relativePath === 'mcp.json';
  const host = hostId ? getHostIntegrationById(hostId) : null;
  const config = readJson(filePath);

  if (!config.mcpServers) config.mcpServers = {};

  if (isSharedRootConfig) {
    for (const key of Object.keys(config.mcpServers)) {
      if (key.startsWith('chinwag-') && key !== 'chinwag-channel') {
        delete config.mcpServers[key];
      }
    }
    config.mcpServers.chinwag = {
      command: 'npx',
      args: buildChinwagCliArgs('mcp', { hostId: null, surfaceId }),
    };
    if (config.mcpServers['chinwag-channel']) {
      config.mcpServers['chinwag-channel'] = {
        command: 'npx',
        args: buildChinwagCliArgs('channel', { hostId: null, surfaceId }),
      };
    }
  } else {
    for (const key of Object.keys(config.mcpServers)) {
      if (key === 'chinwag' || key.startsWith('chinwag-')) {
        delete config.mcpServers[key];
      }
    }
    config.mcpServers.chinwag = {
      command: 'npx',
      args: buildChinwagCliArgs('mcp', { hostId: host?.id || null, surfaceId }),
    };
  }

  if (channel) {
    config.mcpServers['chinwag-channel'] = {
      command: 'npx',
      args: buildChinwagCliArgs('channel', { hostId: isSharedRootConfig ? null : host?.id || null, surfaceId }),
    };
  }

  try {
    writeJson(filePath, config);
  } catch (err) {
    return { error: `Failed to write ${relativePath}: ${err.message}` };
  }

  return { ok: true };
}

export function writeHooksConfig(cwd, { hostId = 'claude-code', surfaceId = null } = {}) {
  const filePath = join(cwd, '.claude', 'settings.json');
  const config = readJson(filePath);

  if (!config.hooks) config.hooks = {};

  const chinwagHooks = {
    PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: buildChinwagHookCommand('check-conflict', { hostId, surfaceId }) }] }],
    PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: buildChinwagHookCommand('report-edit', { hostId, surfaceId }) }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: buildChinwagHookCommand('session-start', { hostId, surfaceId }) }] }],
  };

  for (const [event, entries] of Object.entries(chinwagHooks)) {
    if (!config.hooks[event]) config.hooks[event] = [];
    config.hooks[event] = config.hooks[event].filter((hook) => {
      const existingCommand = hook.hooks?.[0]?.command || hook.command;
      return !isChinwagHookCommand(existingCommand);
    });
    config.hooks[event].push(...entries);
  }

  try {
    writeJson(filePath, config);
  } catch (err) {
    return { error: `Failed to write .claude/settings.json: ${err.message}` };
  }

  return { ok: true };
}

export function configureHostIntegration(cwd, hostId, options = {}) {
  const host = getHostIntegrationById(hostId);
  if (!host) return { error: `Unknown host integration: ${hostId}` };

  const mcpResult = writeMcpConfig(cwd, host.mcpConfig, {
    channel: host.channel,
    hostId: host.id,
    surfaceId: options.surfaceId || null,
  });
  if (mcpResult.error) return mcpResult;

  if (host.hooks) {
    const hookResult = writeHooksConfig(cwd, {
      hostId: host.id,
      surfaceId: options.surfaceId || null,
    });
    if (hookResult.error) return hookResult;
  }

  let detail = host.mcpConfig;
  if (host.hooks) detail += ' + hooks';
  if (host.channel) detail += ' + channel';

  return { ok: true, name: host.name, detail };
}

export function scanHostIntegrations(cwd) {
  return HOST_INTEGRATIONS.map((host) => {
    const detected = detectHost(cwd, host);
    const mcpPath = join(cwd, host.mcpConfig);
    const mcpConfig = readJson(mcpPath);
    const mcpConfigured = hasMatchingMcpEntry(mcpConfig, host.id, {
      channel: Boolean(host.channel),
      sharedRoot: host.mcpConfig === '.mcp.json' || host.mcpConfig === 'mcp.json',
    });

    const hooksPath = join(cwd, '.claude', 'settings.json');
    const hooksConfig = host.hooks ? readJson(hooksPath) : null;
    const hooksConfigured = host.hooks ? hasMatchingHookConfig(hooksConfig) : true;

    const issues = [];
    if (detected && !mcpConfigured) issues.push(`Missing or outdated config at ${host.mcpConfig}`);
    if (detected && host.hooks && !hooksConfigured) issues.push('Hooks are missing or outdated');

    let status = 'not_detected';
    if (detected) status = issues.length === 0 ? 'ready' : (mcpConfigured || (host.hooks && hooksConfigured) ? 'needs_repair' : 'needs_setup');

    return {
      id: host.id,
      name: host.name,
      tier: host.tier,
      capabilities: [...host.capabilities],
      detected,
      status,
      configPath: host.mcpConfig,
      mcpConfigured,
      hooksConfigured,
      issues,
      repairable: detected,
    };
  });
}
