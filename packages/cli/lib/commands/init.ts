// chinmeister init — zero-friction setup command.
// Detects tools, writes MCP configs, creates/joins team, configures hooks.
// Pure stdout output, no TUI.
//
// Tool detection and config paths are driven by the registry in tools.js.
// Adding a new tool = adding one entry there. No logic changes here.

import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import { configExists, loadConfig, saveConfig } from '../config.js';
import { writeFileAtomicSync } from '@chinmeister/shared/fs-atomic.js';
import type { ChinmeisterConfig } from '../config.js';
import { api, initAccount } from '../api.js';
import { detectTools, configureTool } from '../mcp-config.js';
import { installChinmeisterHooks } from '../hooks/install.js';
import { classifyError } from '../utils/errors.js';
import type { AuthenticatedUser } from '@chinmeister/shared/contracts/dashboard.js';
import type { InitAccountResponse, CreateTeamResponse } from '../types/api.js';

// Map chinmeister color names to type-safe chalk functions
const CHALK_COLORS: Record<string, (s: string) => string> = {
  red: chalk.red,
  cyan: chalk.cyan,
  yellow: chalk.yellow,
  green: chalk.green,
  magenta: chalk.magenta,
  blue: chalk.blue,
  orange: chalk.hex('#ff9b3f'),
  lime: chalk.greenBright,
  pink: chalk.magentaBright,
  sky: chalk.cyanBright,
  lavender: chalk.hex('#a585ff'),
  white: chalk.white,
};

function colorize(text: string, colorName: string): string {
  const fn = CHALK_COLORS[colorName];
  return fn ? fn(text) : text;
}

const dim = chalk.dim;
const ok = chalk.green('✔');
const bullet = chalk.dim('●');

function printSplash(): void {
  console.log('');
  console.log(`  ${chalk.cyan.bold('chinmeister')}`);
  console.log(`  ${dim('the control layer for agentic development')}`);
}

export async function runInit(): Promise<void> {
  const cwd = process.cwd();

  printSplash();
  console.log('');

  // Step 1: Account
  let config: ChinmeisterConfig;
  let handle: string, color: string, accountVerb: string | null;
  if (configExists()) {
    config = loadConfig() as ChinmeisterConfig;
    try {
      const me = await api(config).get<AuthenticatedUser>('/me');
      handle = me.handle;
      color = me.color;
      accountVerb = null; // existing, verified
    } catch (err: unknown) {
      const typedErr = err as { status?: number; message?: string };
      if (typedErr.status === 401 || typedErr.status === 403) {
        // Token expired — attempt refresh before creating a new account.
        // Creating a new account would orphan the user's existing team memberships.
        const refreshed = await tryRefreshConfig(config);
        if (refreshed) {
          config = refreshed.config;
          handle = refreshed.handle;
          color = refreshed.color;
          accountVerb = 'refreshed';
        } else {
          config = await createAccount();
          handle = config.handle!;
          color = config.color!;
          accountVerb = 'created';
        }
      } else {
        console.log(`  ${chalk.red('✖')} Could not reach server: ${typedErr.message}`);
        console.log(`  ${dim('Check your internet connection and try again.')}`);
        console.log('');
        return;
      }
    }
  } else {
    config = await createAccount();
    handle = config.handle!;
    color = config.color!;
    accountVerb = 'created';
  }

  const coloredHandle = chalk.bold(colorize(handle, color));
  const accountSuffix = accountVerb ? dim(` — ${accountVerb}`) : '';
  console.log(`  ${ok} Account  ${coloredHandle}${accountSuffix}`);

  const client = api(config);

  // Step 2: Team
  const chinmeisterFile = join(cwd, '.chinmeister');
  let teamId: string;
  let teamName: string, teamVerb: string;
  if (existsSync(chinmeisterFile)) {
    try {
      const data = JSON.parse(readFileSync(chinmeisterFile, 'utf-8'));
      teamId = data.team;
      await client.post(`/teams/${teamId}/join`, { name: basename(cwd) });
      teamName = data.name || teamId;
      teamVerb = 'joined';
    } catch (err: unknown) {
      const typedErr = err as { status?: number; message?: string };
      const classified = classifyError(typedErr);
      const hint =
        typedErr.status === 404
          ? 'Team not found — the .chinmeister file may be stale. Delete it and re-run init.'
          : typedErr.status === 403
            ? 'Access denied. Ask a team member to verify your access.'
            : classified.detail || 'Check your connection and try again.';
      console.log(`  ${chalk.red('✖')} Failed to join team: ${typedErr.message}`);
      console.log(`    ${chalk.dim(hint)}`);
      console.log('');
      return;
    }
  } else {
    try {
      const projectName = basename(cwd);
      const result = await client.post<CreateTeamResponse>('/teams', { name: projectName });
      teamId = result.team_id;
      await client.post(`/teams/${teamId}/join`, { name: projectName });
      writeFileAtomicSync(
        chinmeisterFile,
        JSON.stringify({ team: teamId, name: projectName }, null, 2) + '\n',
      );
      teamName = projectName;
      teamVerb = 'created';
    } catch (err: unknown) {
      const typedErr = err as { status?: number; message?: string };
      const classified = classifyError(typedErr);
      const hint =
        typedErr.status === 429
          ? 'Rate limit reached. Try again tomorrow.'
          : classified.detail || 'Check your connection and try again.';
      console.log(`  ${chalk.red('✖')} Failed to create team: ${typedErr.message}`);
      console.log(`    ${chalk.dim(hint)}`);
      console.log('');
      return;
    }
  }

  console.log(`  ${ok} Team     ${chalk.bold(teamName)} ${dim(`— ${teamVerb}`)}`);

  // Step 3: Detect tools — iterate the registry, not hardcoded checks
  const detected = detectTools(cwd);

  // Step 4: Configure detected integrations through the shared doctor path
  const configured: Array<{ name: string; detail: string }> = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const tool of detected) {
    const result = configureTool(cwd, tool.id);
    if (result.error) {
      failed.push({ name: tool.name, error: result.error });
      continue;
    }
    configured.push({ name: result.name || tool.name, detail: dim(result.detail || '') });
  }

  if (configured.length > 0) {
    console.log(`  ${ok} Configured ${chalk.bold(String(configured.length))} tools`);
    const maxName = Math.max(...configured.map((c) => c.name.length));
    for (const { name, detail } of configured) {
      console.log(`      ${bullet} ${name.padEnd(maxName + 1)} ${detail}`);
    }
  } else if (detected.length === 0) {
    console.log('');
    console.log(
      `  ${dim('No tools detected.')} Install an AI coding tool and re-run ${chalk.cyan('npx chinmeister init')}.`,
    );
  }

  if (failed.length > 0) {
    for (const { name, error } of failed) {
      console.log(`  ${chalk.red('✖')} Could not configure ${name}: ${error}`);
    }
    console.log(
      `    ${dim('Run')} ${chalk.cyan('npx chinmeister doctor')} ${dim('to diagnose and repair.')}`,
    );
  }

  // Step 5: Git pre-commit hook (tool-agnostic enforcement of file leases).
  // Skips silently outside a git repo; prints a single line of status when
  // it fires. Advisory by default — developers can set CHINMEISTER_GUARD=block
  // to have the hook actually refuse commits on conflict.
  const hookResult = installChinmeisterHooks(cwd);
  if (hookResult.status === 'installed') {
    const where = hookResult.customHooksPath ? dim(' (custom hooksPath)') : '';
    const preservedNote = hookResult.preservedOriginal
      ? dim(' — your existing pre-commit preserved as .orig and chained first')
      : '';
    console.log(`  ${ok} Git hook installed${where}${preservedNote}`);
  } else if (hookResult.status === 'upgraded') {
    const where = hookResult.customHooksPath ? dim(' (custom hooksPath)') : '';
    console.log(`  ${ok} Git hook upgraded${where}`);
  } else if (hookResult.status === 'error') {
    console.log(`  ${chalk.yellow('!')} Git hook skipped: ${hookResult.error}`);
  }
  // status === 'skipped-not-a-repo' is silent — a non-git directory is a
  // legitimate use case (e.g. running chinmeister in a plain project folder).

  // Next steps
  console.log('');
  if (configured.length > 0) {
    console.log(`  ${dim('Open or restart your tools to activate chinmeister:')}`);
    for (const { name } of configured) {
      console.log(`    ${bullet} ${name}`);
    }
    console.log('');
  }
  console.log(`  ${chalk.cyan('npx chinmeister')}           ${dim('open the dashboard')}`);
  console.log(`  ${chalk.cyan('npx chinmeister add')}       ${dim('add more tools')}`);
  console.log(`  ${chalk.cyan('npx chinmeister doctor')}    ${dim('scan integration health')}`);
  console.log('');
  console.log(`  ${dim('Commit')} ${chalk.cyan('.chinmeister')} ${dim('so teammates auto-join.')}`);
  console.log('');
}

async function createAccount(): Promise<ChinmeisterConfig> {
  const result = (await initAccount()) as InitAccountResponse;
  const config: ChinmeisterConfig = {
    token: result.token,
    refresh_token: result.refresh_token,
    handle: result.handle,
    color: result.color,
  };
  saveConfig(config);
  return config;
}

/**
 * Attempt to refresh an expired token using the stored refresh_token.
 * Returns refreshed config with verified handle/color, or null on failure.
 */
async function tryRefreshConfig(
  staleConfig: ChinmeisterConfig,
): Promise<{ config: ChinmeisterConfig; handle: string; color: string } | null> {
  if (!staleConfig.refresh_token) return null;
  try {
    const client = api(null); // unauthenticated — refresh endpoint uses body token
    const result = await client.post<{ token: string; refresh_token: string }>('/auth/refresh', {
      refresh_token: staleConfig.refresh_token,
    });
    if (!result.token) return null;
    const refreshedConfig: ChinmeisterConfig = {
      ...staleConfig,
      token: result.token,
      refresh_token: result.refresh_token,
    };
    saveConfig(refreshedConfig);
    // Verify the new token and fetch current profile
    const me = await api(refreshedConfig).get<AuthenticatedUser>('/me');
    return { config: refreshedConfig, handle: me.handle, color: me.color };
  } catch {
    return null; // Refresh failed — caller will fall back to new account
  }
}
