// Shared helpers for writing MCP config files and detecting tools.
// Used by both `chinwag init` and `chinwag add`.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { execFileSync } from 'child_process';
import { MCP_TOOLS } from './tools.js';

export function detectTools(cwd) {
  return MCP_TOOLS.filter(tool => {
    const { dirs = [], cmds = [] } = tool.detect;
    return dirs.some(d => existsSync(join(cwd, d))) ||
           cmds.some(c => commandExists(c));
  });
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

export function writeMcpConfig(cwd, relativePath, { channel = false, toolId = null } = {}) {
  const filePath = join(cwd, relativePath);
  const isSharedRootConfig = relativePath === '.mcp.json' || relativePath === 'mcp.json';

  let existing = {};
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (err) {
      console.error(`[chinwag] Warning: ${relativePath} has invalid JSON (${err.message}). Existing entries will be lost.`);
    }
  }

  if (!existing.mcpServers) existing.mcpServers = {};

  if (isSharedRootConfig) {
    // Shared root configs are read by multiple CLI tools. Keep a single MCP
    // entry and let the server infer the real tool from its parent process.
    for (const key of Object.keys(existing.mcpServers)) {
      if (key.startsWith('chinwag-') && key !== 'chinwag-channel') {
        delete existing.mcpServers[key];
      }
    }
    existing.mcpServers.chinwag = { command: 'npx', args: ['chinwag-mcp'] };
    if (existing.mcpServers['chinwag-channel']) {
      existing.mcpServers['chinwag-channel'] = { command: 'npx', args: ['chinwag-channel'] };
    }
  } else {
    const entryName = toolId && toolId !== 'claude-code' ? `chinwag-${toolId}` : 'chinwag';
    existing.mcpServers[entryName] = toolId
      ? { command: 'npx', args: ['chinwag-mcp', '--tool', toolId] }
      : { command: 'npx', args: ['chinwag-mcp'] };
  }

  if (channel) {
    existing.mcpServers['chinwag-channel'] = isSharedRootConfig
      ? { command: 'npx', args: ['chinwag-channel'] }
      : toolId
        ? { command: 'npx', args: ['chinwag-channel', '--tool', toolId] }
        : { command: 'npx', args: ['chinwag-channel'] };
  }

  try {
    const dir = dirname(relativePath);
    if (dir !== '.') mkdirSync(join(cwd, dir), { recursive: true });
    writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n');
  } catch (err) {
    return { error: `Failed to write ${relativePath}: ${err.message}` };
  }
  return { ok: true };
}

export function writeHooksConfig(cwd) {
  const claudeDir = join(cwd, '.claude');

  try {
    mkdirSync(claudeDir, { recursive: true });
  } catch (err) {
    return { error: `Failed to create .claude directory: ${err.message}` };
  }

  const filePath = join(claudeDir, 'settings.json');

  let existing = {};
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (err) {
      console.error(`[chinwag] Warning: .claude/settings.json has invalid JSON (${err.message}). Existing entries will be lost.`);
    }
  }

  if (!existing.hooks) existing.hooks = {};

  const chinwagHooks = {
    PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'chinwag-hook check-conflict' }] }],
    PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'chinwag-hook report-edit' }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: 'chinwag-hook session-start' }] }],
  };

  for (const [event, entries] of Object.entries(chinwagHooks)) {
    if (!existing.hooks[event]) existing.hooks[event] = [];

    for (const entry of entries) {
      const cmd = entry.hooks[0]?.command;
      const hasChinwag = existing.hooks[event].some(h => {
        // Check both new format (hooks array) and old format (command directly)
        const existingCmd = h.hooks?.[0]?.command || h.command;
        return existingCmd === cmd || existingCmd?.startsWith('chinwag-hook ');
      });
      if (!hasChinwag) {
        existing.hooks[event].push(entry);
      }
    }
  }

  try {
    writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n');
  } catch (err) {
    return { error: `Failed to write .claude/settings.json: ${err.message}` };
  }
  return { ok: true };
}

// Configure a single tool by id. Returns { ok, detail } or { error }.
export function configureTool(cwd, toolId) {
  const tool = MCP_TOOLS.find(t => t.id === toolId);
  if (!tool) return { error: `Unknown MCP tool: ${toolId}` };

  const mcpResult = writeMcpConfig(cwd, tool.mcpConfig, { channel: tool.channel, toolId: tool.id });
  if (mcpResult.error) return mcpResult;

  if (tool.hooks) {
    const hookResult = writeHooksConfig(cwd);
    if (hookResult.error) return hookResult;
  }

  let detail = tool.mcpConfig;
  if (tool.hooks) detail += ' + hooks';
  if (tool.channel) detail += ' + channel';

  return { ok: true, name: tool.name, detail };
}
