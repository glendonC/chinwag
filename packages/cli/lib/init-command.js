// chinwag init — zero-friction setup command.
// Detects tools, writes MCP configs, creates/joins team, configures hooks.
// Pure stdout output, no TUI.
//
// Tool detection and config paths are driven by the registry in tools.js.
// Adding a new tool = adding one entry there. No logic changes here.

import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { configExists, loadConfig, saveConfig } from './config.js';
import { api, initAccount } from './api.js';
import { detectTools, writeMcpConfig, writeHooksConfig } from './mcp-config.js';

// Map chinwag color names to chalk methods
const CHALK_COLORS = {
  red: 'red', cyan: 'cyan', yellow: 'yellow', green: 'green',
  magenta: 'magenta', blue: 'blue', orange: 'redBright', lime: 'greenBright',
  pink: 'magentaBright', sky: 'cyanBright', lavender: 'blueBright', white: 'white',
};

function colorize(text, colorName) {
  const fn = CHALK_COLORS[colorName] || 'white';
  return chalk[fn](text);
}

// Terminal hyperlink (OSC 8) — clickable in iTerm2, Warp, modern terminals; plain text fallback
function link(text, url) {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

const dim = chalk.dim;
const ok = chalk.green('✔');
const bullet = chalk.dim('●');

function printSplash() {
  console.log('');
  console.log(`  ${chalk.cyan.bold('chinwag')}`);
  console.log(`  ${dim('the control layer for agentic development')}`);
}

export async function runInit() {
  const cwd = process.cwd();

  printSplash();
  console.log('');

  // Step 1: Account
  let config;
  let handle, color, accountVerb;
  if (configExists()) {
    config = loadConfig();
    try {
      const me = await api(config).get('/me');
      handle = me.handle;
      color = me.color;
      accountVerb = null; // existing, verified
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        config = await createAccount();
        handle = config.handle;
        color = config.color;
        accountVerb = 'created';
      } else {
        console.log(`  ${chalk.red('✖')} Could not reach server: ${err.message}`);
        console.log(`  ${dim('Check your internet connection and try again.')}`);
        console.log('');
        return;
      }
    }
  } else {
    config = await createAccount();
    handle = config.handle;
    color = config.color;
    accountVerb = 'created';
  }

  const coloredHandle = chalk.bold(colorize(handle, color));
  const accountSuffix = accountVerb ? dim(` — ${accountVerb}`) : '';
  console.log(`  ${ok} Account  ${coloredHandle}${accountSuffix}`);

  const client = api(config);

  // Step 2: Team
  const chinwagFile = join(cwd, '.chinwag');
  let teamId;
  let teamName, teamVerb;
  if (existsSync(chinwagFile)) {
    try {
      const data = JSON.parse(readFileSync(chinwagFile, 'utf-8'));
      teamId = data.team;
      await client.post(`/teams/${teamId}/join`, { name: basename(cwd) });
      teamName = data.name || teamId;
      teamVerb = 'joined';
    } catch (err) {
      console.log(`  ${chalk.red('✖')} Failed to join team: ${err.message}`);
      console.log('');
      return;
    }
  } else {
    try {
      const projectName = basename(cwd);
      const result = await client.post('/teams', { name: projectName });
      teamId = result.team_id;
      writeFileSync(chinwagFile, JSON.stringify({ team: teamId, name: projectName }, null, 2) + '\n');
      teamName = projectName;
      teamVerb = 'created';
    } catch (err) {
      console.log(`  ${chalk.red('✖')} Failed to create team: ${err.message}`);
      console.log('');
      return;
    }
  }

  console.log(`  ${ok} Team     ${chalk.bold(teamName)} ${dim(`— ${teamVerb}`)}`);

  // Step 3: Detect tools — iterate the registry, not hardcoded checks
  const detected = detectTools(cwd);

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

    let detail = dim(tool.mcpConfig);
    if (tool.hooks) detail += dim(' + hooks');
    if (tool.channel) detail += dim(' + channel');
    configured.push({ name: tool.name, detail });
  }

  if (configured.length > 0) {
    console.log(`  ${ok} Configured ${chalk.bold(configured.length)} tools`);
    const maxName = Math.max(...configured.map(c => c.name.length));
    for (const { name, detail } of configured) {
      console.log(`      ${bullet} ${name.padEnd(maxName + 1)} ${detail}`);
    }
  } else {
    console.log('');
    console.log(`  ${dim('No tools detected.')} Run ${chalk.cyan('chinwag add --list')} to see available tools.`);
  }

  // Next steps
  console.log('');
  console.log(`  ${dim('Done. Chinwag runs invisibly inside your AI tools now.')}`);
  console.log('');
  console.log(`  ${dim('Try it:')}  ${chalk.cyan('npx chinwag')}           ${dim('open the dashboard')}`);
  console.log(`           ${chalk.cyan('npx chinwag add')}       ${dim('add more tools')}`);
  console.log('');
  console.log(`  ${dim('Commit')} ${chalk.cyan('.chinwag')} ${dim('so teammates auto-join.')}`);
  console.log(`  ${dim('Web:')} ${link(chalk.cyan('chinwag.dev/dashboard'), 'https://chinwag.dev/dashboard')}`);
  console.log('');
}

async function createAccount() {
  const result = await initAccount();
  const config = { token: result.token, handle: result.handle, color: result.color };
  saveConfig(config);
  return config;
}
