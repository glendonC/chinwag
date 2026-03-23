// chinwag init — zero-friction setup command.
// Detects tools, writes MCP configs, creates/joins team, configures hooks.
// Pure stdout output, no TUI.
//
// Tool detection and config paths are driven by the registry in tools.js.
// Adding a new tool = adding one entry there. No logic changes here.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { configExists, loadConfig, saveConfig } from './config.js';
import { api, initAccount } from './api.js';
import { TOOL_REGISTRY } from './tools.js';

export async function runInit() {
  const cwd = process.cwd();

  // Step 1: Account
  let config;
  if (configExists()) {
    config = loadConfig();
    try {
      const me = await api(config).get('/me');
      log('account', `${me.handle} (${me.color})`);
    } catch {
      // Token invalid — re-create
      config = await createAccount();
    }
  } else {
    config = await createAccount();
  }

  const client = api(config);

  // Step 2: Team
  const chinwagFile = join(cwd, '.chinwag');
  let teamId;
  if (existsSync(chinwagFile)) {
    try {
      const data = JSON.parse(readFileSync(chinwagFile, 'utf-8'));
      teamId = data.team;
      // Join existing team (idempotent)
      await client.post(`/teams/${teamId}/join`, {});
      log('team', `${teamId} (joined)`);
    } catch (err) {
      log('team', `failed to join: ${err.message}`);
      return;
    }
  } else {
    try {
      const result = await client.post('/teams', {});
      teamId = result.team_id;
      writeFileSync(chinwagFile, JSON.stringify({ team: teamId }, null, 2) + '\n');
      log('team', `${teamId} (created)`);
    } catch (err) {
      log('team', `failed to create: ${err.message}`);
      return;
    }
  }

  // Step 3: Detect tools — iterate the registry, not hardcoded checks
  const detected = detectTools(cwd);
  if (detected.length === 0) {
    log('tools', 'none detected — you can manually add MCP configs later');
  }

  // Step 4: Write MCP configs — deduplicate by config path (multiple tools may share one)
  const configsWritten = new Set();
  const configured = [];

  for (const tool of detected) {
    if (!configsWritten.has(tool.mcpConfig)) {
      const dir = dirname(tool.mcpConfig);
      if (dir !== '.') mkdirSync(join(cwd, dir), { recursive: true });
      writeMcpConfig(cwd, tool.mcpConfig, { channel: tool.channel });
      configsWritten.add(tool.mcpConfig);
    }

    if (tool.hooks) {
      writeHooksConfig(cwd);
    }

    let detail = tool.mcpConfig;
    if (tool.hooks) detail += ' + hooks';
    if (tool.channel) detail += ' + channel';
    configured.push(`${tool.name.padEnd(12)} ${detail}`);
  }

  // Step 5: Print summary
  console.log('');
  console.log('chinwag init');
  console.log('');
  if (configured.length > 0) {
    console.log('  Configured:');
    for (const line of configured) {
      console.log(`    ${line}`);
    }
  }
  console.log('');
  console.log('  Next: open any configured tool in this directory.');
  console.log('  Your agents will automatically coordinate through chinwag.');
  console.log('');
  console.log('  Commit .chinwag so teammates auto-join the same team.');
  console.log('');
}

async function createAccount() {
  const result = await initAccount();
  const config = { token: result.token, handle: result.handle, color: result.color };
  saveConfig(config);
  log('account', `${result.handle} (${result.color}) — created`);
  return config;
}

function log(label, msg) {
  console.log(`  ${label}: ${msg}`);
}

// --- Tool detection (registry-driven) ---

function detectTools(cwd) {
  return TOOL_REGISTRY.filter(tool => {
    const { dirs = [], cmds = [] } = tool.detect;
    return dirs.some(d => existsSync(join(cwd, d))) ||
           cmds.some(c => commandExists(c));
  });
}

function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// --- Config writers ---

function writeMcpConfig(cwd, relativePath, { channel = false } = {}) {
  const filePath = join(cwd, relativePath);

  let existing = {};
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      // Corrupted file — overwrite
    }
  }

  if (!existing.mcpServers) existing.mcpServers = {};
  existing.mcpServers.chinwag = { command: 'npx', args: ['chinwag-mcp'] };

  if (channel) {
    existing.mcpServers['chinwag-channel'] = { command: 'npx', args: ['chinwag-channel'] };
  }

  writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n');
}

function writeHooksConfig(cwd) {
  const claudeDir = join(cwd, '.claude');
  mkdirSync(claudeDir, { recursive: true });

  const filePath = join(claudeDir, 'settings.json');

  let existing = {};
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      // Corrupted — overwrite
    }
  }

  if (!existing.hooks) existing.hooks = {};

  const chinwagHooks = {
    PreToolUse: [{ matcher: 'Edit|Write', command: 'chinwag-hook check-conflict' }],
    PostToolUse: [{ matcher: 'Edit|Write', command: 'chinwag-hook report-edit' }],
    SessionStart: [{ command: 'chinwag-hook session-start' }],
  };

  for (const [event, entries] of Object.entries(chinwagHooks)) {
    if (!existing.hooks[event]) existing.hooks[event] = [];

    for (const entry of entries) {
      // Deduplicate: skip if a chinwag-hook entry already exists for this event
      const hasChinwag = existing.hooks[event].some(h =>
        h.command && h.command.includes('chinwag-hook')
      );
      if (!hasChinwag) {
        existing.hooks[event].push(entry);
      }
    }
  }

  writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n');
}
