import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoName = basename(rootDir);

const LOCAL_API_URL = 'http://localhost:8787';
const LOCAL_DASHBOARD_URL = 'http://localhost:56790/dashboard.html';
const LOCAL_CONFIG_DIR = join(homedir(), '.chinwag', 'local');
const LOCAL_CONFIG_FILE = join(LOCAL_CONFIG_DIR, 'config.json');

/** @typedef {{ token?: string, refresh_token?: string, handle?: string, color?: string }} LocalConfig */
/** @typedef {{ teamId: string, teamName: string }} TeamFile */

let workerProcess = null;
let webProcess = null;
let shuttingDown = false;

function logLine(message = '') {
  process.stderr.write(`${message}\n`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function assertPortAvailable(port, label) {
  await new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `${label} port ${port} is already in use. Stop the existing process before running npm run dev:local.`,
          ),
        );
        return;
      }
      reject(err);
    });
    server.once('listening', () => {
      server.close((closeErr) => (closeErr ? reject(closeErr) : resolvePromise()));
    });
    server.listen(port, '127.0.0.1');
  });
}

function writeLocalConfig(config) {
  mkdirSync(LOCAL_CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(LOCAL_CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

function readLocalConfig() {
  if (!existsSync(LOCAL_CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(LOCAL_CONFIG_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function readTeamFile() {
  const teamFilePath = join(rootDir, '.chinwag');
  if (!existsSync(teamFilePath)) return null;
  try {
    const data = JSON.parse(readFileSync(teamFilePath, 'utf-8'));
    if (typeof data.team !== 'string' || !data.team) return null;
    return {
      teamId: data.team,
      teamName: typeof data.name === 'string' && data.name ? data.name : repoName,
    };
  } catch {
    return null;
  }
}

function formatChildExit(name, code, signal) {
  if (signal) return `${name} exited from signal ${signal}`;
  return `${name} exited with code ${code ?? 0}`;
}

function registerChild(name, child) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    logLine(`[dev:local] ${formatChildExit(name, code, signal)}`);
    void shutdown(typeof code === 'number' ? code : 1);
  });
  return child;
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of [webProcess, workerProcess]) {
    if (!child || child.killed) continue;
    try {
      child.kill('SIGTERM');
    } catch {
      /* best-effort */
    }
  }

  await sleep(150);

  for (const child of [webProcess, workerProcess]) {
    if (!child || child.killed) continue;
    try {
      child.kill('SIGKILL');
    } catch {
      /* best-effort */
    }
  }

  process.exit(exitCode);
}

function installSignalHandlers() {
  process.on('SIGINT', () => {
    void shutdown(0);
  });
  process.on('SIGTERM', () => {
    void shutdown(0);
  });
}

async function waitForUrl(url, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'not reachable yet';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(400);
  }

  throw new Error(`${label} did not become ready: ${lastError}`);
}

async function requestJson(method, path, { body, token, expectedStatuses = [200] } = {}) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) headers.Authorization = `Bearer ${token}`;
  if (path === '/auth/init') headers['CF-Connecting-IP'] = '127.0.0.1';

  const response = await fetch(`${LOCAL_API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!expectedStatuses.includes(response.status)) {
    const message =
      data && typeof data === 'object' && typeof data.error === 'string'
        ? data.error
        : `${method} ${path} failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function tryRefreshConfig(config) {
  if (!config?.refresh_token) return null;

  try {
    const refreshed = await requestJson('POST', '/auth/refresh', {
      body: { refresh_token: config.refresh_token },
      expectedStatuses: [200],
    });
    if (!refreshed?.token || !refreshed?.refresh_token) return null;

    const nextConfig = {
      ...config,
      token: refreshed.token,
      refresh_token: refreshed.refresh_token,
    };
    writeLocalConfig(nextConfig);
    return nextConfig;
  } catch {
    return null;
  }
}

async function ensureLocalConfig() {
  const currentConfig = readLocalConfig();

  if (currentConfig?.token) {
    try {
      await requestJson('GET', '/me', {
        token: currentConfig.token,
        expectedStatuses: [200],
      });
      return currentConfig;
    } catch (err) {
      if (err?.status === 401) {
        const refreshedConfig = await tryRefreshConfig(currentConfig);
        if (refreshedConfig) return refreshedConfig;
      }
    }
  }

  const created = await requestJson('POST', '/auth/init', {
    body: {},
    expectedStatuses: [201],
  });

  if (!created?.token) {
    throw new Error('Local auth bootstrap did not return a token');
  }

  const nextConfig = {
    token: created.token,
    refresh_token: created.refresh_token,
    handle: created.handle,
    color: created.color,
  };
  writeLocalConfig(nextConfig);
  return nextConfig;
}

async function ensureLocalTeam(token) {
  const repoTeam = readTeamFile();
  const teamsResponse = await requestJson('GET', '/me/teams', {
    token,
    expectedStatuses: [200],
  });
  const teams = Array.isArray(teamsResponse?.teams) ? teamsResponse.teams : [];

  if (repoTeam) {
    if (teams.some((team) => team.team_id === repoTeam.teamId)) {
      return { teamId: repoTeam.teamId, source: 'repo-file' };
    }

    await requestJson('POST', `/teams/${repoTeam.teamId}/join`, {
      token,
      body: { name: repoTeam.teamName },
      expectedStatuses: [200],
    });
    return { teamId: repoTeam.teamId, source: 'repo-file' };
  }

  const existingTeam = teams.find((team) => team.team_name === repoName);
  if (existingTeam?.team_id) {
    return { teamId: existingTeam.team_id, source: 'account-team' };
  }

  const created = await requestJson('POST', '/teams', {
    token,
    body: { name: repoName },
    expectedStatuses: [201],
  });

  if (!created?.team_id) {
    throw new Error('Local team bootstrap did not return a team_id');
  }

  return { teamId: created.team_id, source: 'local-only' };
}

async function main() {
  installSignalHandlers();

  await assertPortAvailable(8787, 'Worker');
  await assertPortAvailable(56790, 'Dashboard');

  logLine('[dev:local] starting local worker...');
  workerProcess = registerChild(
    'worker',
    spawn('npm', ['run', 'dev:local', '--workspace=packages/worker'], {
      cwd: rootDir,
      stdio: 'inherit',
      env: process.env,
    }),
  );

  logLine('[dev:local] waiting for local API...');
  // Cold-start budget: wrangler dev needs to download workerd, bundle the
  // worker, and boot the DO runtime before /stats responds. Measured at
  // ~35s on a clean shell; 90s absorbs slower machines and first-run
  // dependency fetches. Warm runs still return instantly.
  await waitForUrl(`${LOCAL_API_URL}/stats`, 'local API', 90_000);

  logLine('[dev:local] provisioning isolated local auth...');
  const config = await ensureLocalConfig();

  logLine('[dev:local] ensuring a local team view for this repo...');
  const team = await ensureLocalTeam(config.token);

  logLine('[dev:local] starting local web dashboard...');
  webProcess = registerChild(
    'web',
    spawn('npm', ['run', 'dev', '--workspace=packages/web'], {
      cwd: rootDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_CHINWAG_PROFILE: 'local',
      },
    }),
  );

  logLine('[dev:local] waiting for local dashboard...');
  await waitForUrl(LOCAL_DASHBOARD_URL, 'local dashboard');

  const dashboardUrl = `${LOCAL_DASHBOARD_URL}#token=${encodeURIComponent(config.token)}`;

  logLine('');
  logLine('[dev:local] Local profile ready.');
  logLine(`[dev:local] Dashboard: ${dashboardUrl}`);
  logLine(`[dev:local] Config: ${LOCAL_CONFIG_FILE}`);
  logLine(`[dev:local] Team: ${team.teamId}`);
  if (!readTeamFile()) {
    logLine(
      '[dev:local] No .chinwag file found, so this local team is dashboard-only until you link the repo.',
    );
  }
  logLine('[dev:local] Press Ctrl+C to stop both servers.');

  await new Promise(() => {});
}

try {
  await main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  logLine(`[dev:local] ${message}`);
  await shutdown(1);
}
