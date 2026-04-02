// chinwag init — zero-friction setup command.
// Detects tools, writes MCP configs, creates/joins team, configures hooks.
// Pure stdout output, no TUI.
//
// Tool detection and config paths are driven by the registry in tools.js.
// Adding a new tool = adding one entry there. No logic changes here.

import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { configExists, loadConfig, saveConfig } from '../config.js';
import { api, initAccount } from '../api.js';
import { detectTools, configureTool } from '../mcp-config.js';

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
      const hint = err.status === 404 ? 'Team not found — the .chinwag file may be stale. Delete it and re-run init.'
        : err.status === 403 ? 'Access denied. Ask a team member to verify your access.'
        : err.status >= 500 ? 'Server error. Try again in a moment.'
        : `Check your connection and try again.`;
      console.log(`  ${chalk.red('✖')} Failed to join team: ${err.message}`);
      console.log(`    ${chalk.dim(hint)}`);
      console.log('');
      return;
    }
  } else {
    try {
      const projectName = basename(cwd);
      const result = await client.post('/teams', { name: projectName });
      teamId = result.team_id;
      await client.post(`/teams/${teamId}/join`, { name: projectName });
      writeFileSync(chinwagFile, JSON.stringify({ team: teamId, name: projectName }, null, 2) + '\n');
      teamName = projectName;
      teamVerb = 'created';
    } catch (err) {
      const hint = err.status === 429 ? 'Rate limit reached. Try again tomorrow.'
        : err.status >= 500 ? 'Server error. Try again in a moment.'
        : 'Check your connection and try again.';
      console.log(`  ${chalk.red('✖')} Failed to create team: ${err.message}`);
      console.log(`    ${chalk.dim(hint)}`);
      console.log('');
      return;
    }
  }

  console.log(`  ${ok} Team     ${chalk.bold(teamName)} ${dim(`— ${teamVerb}`)}`);

  // Step 3: Detect tools — iterate the registry, not hardcoded checks
  const detected = detectTools(cwd);

  // Step 4: Configure detected integrations through the shared doctor path
  const configured = [];

  for (const tool of detected) {
    const result = configureTool(cwd, tool.id);
    if (result.error) {
      console.log(`  ${chalk.red('✖')} Could not configure ${tool.name}: ${result.error}`);
      continue;
    }
    configured.push({ name: result.name, detail: dim(result.detail) });
  }

  if (configured.length > 0) {
    console.log(`  ${ok} Configured ${chalk.bold(configured.length)} tools`);
    const maxName = Math.max(...configured.map(c => c.name.length));
    for (const { name, detail } of configured) {
      console.log(`      ${bullet} ${name.padEnd(maxName + 1)} ${detail}`);
    }
  } else {
    console.log('');
    console.log(`  ${dim('No tools detected.')} Run ${chalk.cyan('npx chinwag add --list')} to see available tools.`);
  }

  // Next steps
  console.log('');
  if (configured.length > 0) {
    console.log(`  ${dim('Open or restart your tools to activate chinwag:')}`);
    for (const { name } of configured) {
      console.log(`    ${bullet} ${name}`);
    }
    console.log('');
  }
  console.log(`  ${chalk.cyan('npx chinwag')}           ${dim('open the dashboard')}`);
  console.log(`  ${chalk.cyan('npx chinwag add')}       ${dim('add more tools')}`);
  console.log(`  ${chalk.cyan('npx chinwag doctor')}    ${dim('scan integration health')}`);
  console.log('');
  console.log(`  ${dim('Commit')} ${chalk.cyan('.chinwag')} ${dim('so teammates auto-join.')}`);
  console.log('');
}

async function createAccount() {
  const result = await initAccount();
  const config = { token: result.token, handle: result.handle, color: result.color };
  saveConfig(config);
  return config;
}
