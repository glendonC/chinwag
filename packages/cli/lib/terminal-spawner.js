import { execFileSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { safeAgentId, isProcessAlive } from '../../shared/session-registry.js';
import { escapeAppleScriptString } from './utils/shell.js';

const PIDS_DIR = join(homedir(), '.chinwag', 'pids');
const KILL_GRACE_MS = 5000;

// ── Terminal environment detection ────────────────────
// Detects terminal CAPABILITY, not brand. Grouped by how we spawn into them.

export function detectTerminalEnvironment() {
  // 1. tmux — best experience: split pane in current session
  if (process.env.TMUX) {
    return { type: 'tmux', name: 'tmux pane' };
  }

  const termProgram = (process.env.TERM_PROGRAM || '').toLowerCase();

  // 2. IDE integrated terminal (any Electron-based IDE: VS Code, Cursor, Windsurf, etc.)
  //    Detected by VSCODE_INJECTION (set by all VS Code forks) or TERM_PROGRAM=vscode
  if (process.env.VSCODE_INJECTION || termProgram === 'vscode') {
    // Derive a human-readable name from the app path or fall back to generic
    const appPath = process.env.VSCODE_GIT_ASKPASS_NODE || '';
    const name = /Cursor/i.test(appPath) ? 'Cursor'
      : /Windsurf/i.test(appPath) ? 'Windsurf'
      : /Code/i.test(appPath) ? 'VS Code'
      : 'IDE';
    return { type: 'ide-terminal', name: `${name} terminal` };
  }

  // 3. iTerm2 — macOS power terminal, AppleScript for new tab
  if (termProgram === 'iterm.app' || process.env.ITERM_SESSION_ID) {
    return { type: 'iterm2', name: 'iTerm2 tab' };
  }

  // 4. Standard macOS Terminal.app
  if (termProgram === 'apple_terminal' || (process.platform === 'darwin' && !termProgram)) {
    return { type: 'macos-terminal', name: 'Terminal.app' };
  }

  // 5. Linux — try common terminal emulators
  if (process.platform === 'linux') {
    return { type: 'linux', name: 'terminal' };
  }

  // 6. Windows
  if (process.platform === 'win32') {
    return { type: 'windows', name: 'terminal' };
  }

  return { type: 'fallback', name: 'terminal' };
}

// ── Shell command builder ─────────────────────────────

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

// Use escapeAppleScriptString from utils/shell.js (imported above)
const escapeAppleScript = escapeAppleScriptString;

export function buildTerminalCommand(launch) {
  const { agentId, toolId, cwd, cmd, args = [], task } = launch;
  const safe = safeAgentId(agentId);

  // Wrap in a function so the setup commands are hidden from the user.
  // They see "clear" then the tool starts cleanly.
  const setup = [
    `export CHINWAG_TOOL=${shellQuote(toolId)}`,
    `export CHINWAG_AGENT_ID=${shellQuote(agentId)}`,
    `mkdir -p ${shellQuote(PIDS_DIR)}`,
    `echo $$ > ${shellQuote(join(PIDS_DIR, `${safe}.pid`))}`,
  ];
  if (cwd) setup.push(`cd ${shellQuote(cwd)}`);

  const toolParts = [cmd, ...args];
  if (task) toolParts.push(shellQuote(task));

  // clear && tool command — user only sees the tool starting
  return `${setup.join(' && ')} && clear && ${toolParts.join(' ')}`;
}

// ── Spawners by capability ───────────────────────────

function spawnInTmux(shellCommand, cwd) {
  try {
    const args = ['split-window', '-h'];
    if (cwd) args.push('-c', cwd);
    args.push(shellCommand);
    execFileSync('tmux', args, { stdio: 'ignore' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function spawnInIdeTerminal(shellCommand, cwd, toolName) {
  // Write a launch request that the chinwag VS Code/Cursor extension picks up.
  // The extension watches ~/.chinwag/launch-queue.json and creates an integrated terminal.
  const launchQueuePath = join(homedir(), '.chinwag', 'launch-queue.json');
  try {
    mkdirSync(join(homedir(), '.chinwag'), { recursive: true });
    writeFileSync(launchQueuePath, JSON.stringify({
      command: shellCommand,
      name: toolName || 'chinwag agent',
      cwd: cwd || process.cwd(),
    }));
    return { ok: true };
  } catch (err) {
    console.error('[chinwag]', err?.message || err);
    // Fallback to platform terminal if file write fails
    if (process.platform === 'darwin') return spawnInMacosTerminal(shellCommand);
    if (process.platform === 'linux') return spawnOnLinux(shellCommand);
    if (process.platform === 'win32') return spawnOnWindows(shellCommand);
    return { ok: false, error: 'No terminal available' };
  }
}

function spawnInIterm2(shellCommand) {
  try {
    const script = `
      tell application "iTerm2"
        tell current window
          create tab with default profile
          tell current session of current tab
            write text "${escapeAppleScript(shellCommand)}"
          end tell
        end tell
      end tell
    `;
    execFileSync('osascript', ['-e', script], { stdio: 'ignore' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function spawnInMacosTerminal(shellCommand) {
  try {
    execFileSync('osascript', [
      '-e', 'tell application "Terminal" to activate',
      '-e', `tell application "Terminal" to do script "${escapeAppleScript(shellCommand)}"`,
    ], { stdio: 'ignore' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function spawnOnLinux(shellCommand) {
  const attempts = [
    ['gnome-terminal', ['--', 'sh', '-lc', shellCommand]],
    ['konsole', ['-e', 'sh', '-lc', shellCommand]],
    ['x-terminal-emulator', ['-e', 'sh', '-lc', shellCommand]],
    ['xterm', ['-e', shellCommand]],
  ];
  for (const [cmd, args] of attempts) {
    try {
      execFileSync(cmd, args, { stdio: 'ignore' });
      return { ok: true };
    } catch (err) { console.error('[chinwag]', err?.message || err); }
  }
  return { ok: false, error: 'No terminal emulator found' };
}

function spawnOnWindows(shellCommand) {
  try {
    try {
      execFileSync('wt', ['new-tab', 'cmd', '/k', shellCommand], { stdio: 'ignore' });
      return { ok: true };
    } catch (err) { console.error('[chinwag]', err?.message || err); }
    execFileSync('cmd', ['/c', 'start', '', 'cmd', '/k', shellCommand], { stdio: 'ignore' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Main spawn function ──────────────────────────────

export function spawnInTerminal(launch) {
  const shellCommand = buildTerminalCommand(launch);
  const env = detectTerminalEnvironment();

  const spawners = {
    'tmux': () => spawnInTmux(shellCommand, launch.cwd),
    'ide-terminal': () => spawnInIdeTerminal(shellCommand, launch.cwd, launch.toolName),
    'iterm2': () => spawnInIterm2(shellCommand),
    'macos-terminal': () => spawnInMacosTerminal(shellCommand),
    'linux': () => spawnOnLinux(shellCommand),
    'windows': () => spawnOnWindows(shellCommand),
  };

  const spawner = spawners[env.type];
  if (!spawner) return { ok: false, error: 'No supported terminal detected' };

  const result = spawner();
  if (result.ok) {
    return { ok: true, agentId: launch.agentId, terminalType: env.type };
  }
  return result;
}

// ── PID file management ──────────────────────────────

export function readPidFile(agentId) {
  try {
    const safe = safeAgentId(agentId);
    const pidPath = join(PIDS_DIR, `${safe}.pid`);
    if (!existsSync(pidPath)) return null;
    const content = readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch (err) {
    console.error('[chinwag]', err?.message || err);
    return null;
  }
}

export function cleanPidFile(agentId) {
  try {
    const safe = safeAgentId(agentId);
    const pidPath = join(PIDS_DIR, `${safe}.pid`);
    if (existsSync(pidPath)) unlinkSync(pidPath);
  } catch (err) { console.error('[chinwag]', err?.message || err); }
}

export function killByPid(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    setTimeout(() => {
      try { process.kill(pid, 'SIGKILL'); } catch (err) { console.error('[chinwag]', err?.message || err); }
    }, KILL_GRACE_MS);
    return true;
  } catch (err) {
    console.error('[chinwag]', err?.message || err);
    return false;
  }
}

// Re-export isProcessAlive from shared (imported above)
export { isProcessAlive };
