// chinwag init — zero-friction setup command.
// Detects tools, writes MCP configs, creates/joins team, configures hooks.
// Pure stdout output, no TUI.
//
// Tool detection and config paths are driven by the registry in tools.js.
// Adding a new tool = adding one entry there. No logic changes here.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { configExists, loadConfig, saveConfig } from './config.js';
import { api, initAccount } from './api.js';
import { detectTools, writeMcpConfig, writeHooksConfig } from './mcp-config.js';

export async function runInit() {
  const cwd = process.cwd();

  // Step 1: Account
  let config;
  if (configExists()) {
    config = loadConfig();
    try {
      const me = await api(config).get('/me');
      log('account', `${me.handle} (${me.color})`);
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        // Token invalid — re-create
        config = await createAccount();
      } else {
        // Network error or server issue — don't create a new account
        log('account', `could not reach server: ${err.message}`);
        console.log('');
        console.log('  Check your internet connection and try again.');
        return;
      }
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
      // Join existing team (idempotent), pass project name for dashboard display
      await client.post(`/teams/${teamId}/join`, { name: basename(cwd) });
      log('team', `${teamId} (joined)`);
    } catch (err) {
      log('team', `failed to join: ${err.message}`);
      return;
    }
  } else {
    try {
      const projectName = basename(cwd);
      const result = await client.post('/teams', { name: projectName });
      teamId = result.team_id;
      writeFileSync(chinwagFile, JSON.stringify({ team: teamId, name: projectName }, null, 2) + '\n');
      log('team', `${teamId} (created)`);
    } catch (err) {
      log('team', `failed to create: ${err.message}`);
      return;
    }
  }

  // Step 3: Detect tools — iterate the registry, not hardcoded checks
  const detected = detectTools(cwd);
  if (detected.length === 0) {
    log('tools', 'none detected — run `chinwag add --list` to see available tools');
  }

  // Step 4: Write MCP configs — deduplicate by config path (multiple tools may share one)
  const configsWritten = new Set();
  const configured = [];

  for (const tool of detected) {
    if (!configsWritten.has(tool.mcpConfig)) {
      writeMcpConfig(cwd, tool.mcpConfig, { channel: tool.channel, toolId: tool.id });
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
  console.log('  Dashboard: chinwag dashboard');
  console.log('  Or visit:  https://chinwag.dev/dashboard');
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
