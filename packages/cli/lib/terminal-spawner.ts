import { execFileSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { writeFileAtomicSync } from '@chinwag/shared/fs-atomic.js';
import { join } from 'path';
import { homedir } from 'os';
import { safeAgentId, isProcessAlive } from '@chinwag/shared/session-registry.js';
import { escapeAppleScriptString } from './utils/shell.js';
import { formatError, createLogger } from '@chinwag/shared';
import { EXEC_TIMEOUT_MS, KILL_GRACE_MS } from '@chinwag/shared/constants.js';

const log = createLogger('terminal-spawner');

const PIDS_DIR = join(homedir(), '.chinwag', 'pids');

// ── Terminal environment detection ────────────────────
// Detects terminal CAPABILITY, not brand. Grouped by how we spawn into them.

export type TerminalType =
  | 'tmux'
  | 'ide-terminal'
  | 'iterm2'
  | 'macos-terminal'
  | 'linux'
  | 'windows'
  | 'fallback';

export interface TerminalEnvironment {
  type: TerminalType;
  name: string;
}

export function detectTerminalEnvironment(): TerminalEnvironment {
  // 1. tmux — best experience: split pane in current session
  if (process.env.TMUX) {
    return { type: 'tmux' as const, name: 'tmux pane' };
  }

  const termProgram = (process.env.TERM_PROGRAM || '').toLowerCase();

  // 2. IDE integrated terminal (any Electron-based IDE: VS Code, Cursor, Windsurf, etc.)
  //    Detected by VSCODE_INJECTION (set by all VS Code forks) or TERM_PROGRAM=vscode
  if (process.env.VSCODE_INJECTION || termProgram === 'vscode') {
    // Derive a human-readable name from the app path or fall back to generic
    const appPath = process.env.VSCODE_GIT_ASKPASS_NODE || '';
    const name = /Cursor/i.test(appPath)
      ? 'Cursor'
      : /Windsurf/i.test(appPath)
        ? 'Windsurf'
        : /Code/i.test(appPath)
          ? 'VS Code'
          : 'IDE';
    return { type: 'ide-terminal' as const, name: `${name} terminal` };
  }

  // 3. iTerm2 — macOS power terminal, AppleScript for new tab
  if (termProgram === 'iterm.app' || process.env.ITERM_SESSION_ID) {
    return { type: 'iterm2' as const, name: 'iTerm2 tab' };
  }

  // 4. Standard macOS Terminal.app
  if (termProgram === 'apple_terminal' || (process.platform === 'darwin' && !termProgram)) {
    return { type: 'macos-terminal' as const, name: 'Terminal.app' };
  }

  // 5. Linux — try common terminal emulators
  if (process.platform === 'linux') {
    return { type: 'linux' as const, name: 'terminal' };
  }

  // 6. Windows
  if (process.platform === 'win32') {
    return { type: 'windows' as const, name: 'terminal' };
  }

  return { type: 'fallback' as const, name: 'terminal' };
}

// ── Shell command builder ─────────────────────────────

function shellQuote(value: string): string {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

// Use escapeAppleScriptString from utils/shell.js (imported above)
const escapeAppleScript = escapeAppleScriptString;

export interface TerminalLaunch {
  agentId: string;
  toolId: string;
  toolName?: string | undefined;
  cwd?: string | undefined;
  cmd: string;
  args?: string[] | undefined;
  task?: string | undefined;
  interactive?: boolean | undefined;
  taskArg?: string | undefined;
}

export interface SpawnResult {
  ok: boolean;
  error?: string;
  agentId?: string;
  terminalType?: TerminalType;
}

export function buildTerminalCommand(launch: TerminalLaunch): string {
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

function spawnInTmux(shellCommand: string, cwd?: string): SpawnResult {
  try {
    const args = ['split-window', '-h'];
    if (cwd) args.push('-c', cwd);
    args.push(shellCommand);
    execFileSync('tmux', args, { stdio: 'ignore', timeout: EXEC_TIMEOUT_MS });
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: formatError(err) };
  }
}

function spawnInIdeTerminal(shellCommand: string, cwd?: string, toolName?: string): SpawnResult {
  // Write a launch request that the chinwag VS Code/Cursor extension picks up.
  // The extension watches ~/.chinwag/launch-queue.json and creates an integrated terminal.
  const launchQueuePath = join(homedir(), '.chinwag', 'launch-queue.json');
  try {
    writeFileAtomicSync(
      launchQueuePath,
      JSON.stringify({
        command: shellCommand,
        name: toolName || 'chinwag agent',
        cwd: cwd || process.cwd(),
      }),
    );
    return { ok: true };
  } catch (err: unknown) {
    log.error(formatError(err));
    // Fallback to platform terminal if file write fails
    if (process.platform === 'darwin') return spawnInMacosTerminal(shellCommand);
    if (process.platform === 'linux') return spawnOnLinux(shellCommand);
    if (process.platform === 'win32') return spawnOnWindows(shellCommand);
    return { ok: false, error: 'No terminal available' };
  }
}

function spawnInIterm2(shellCommand: string): SpawnResult {
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
    execFileSync('osascript', ['-e', script], { stdio: 'ignore', timeout: EXEC_TIMEOUT_MS });
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: formatError(err) };
  }
}

function spawnInMacosTerminal(shellCommand: string): SpawnResult {
  try {
    execFileSync(
      'osascript',
      [
        '-e',
        'tell application "Terminal" to activate',
        '-e',
        `tell application "Terminal" to do script "${escapeAppleScript(shellCommand)}"`,
      ],
      { stdio: 'ignore', timeout: EXEC_TIMEOUT_MS },
    );
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: formatError(err) };
  }
}

function spawnOnLinux(shellCommand: string): SpawnResult {
  const attempts: [string, string[]][] = [
    ['gnome-terminal', ['--', 'sh', '-lc', shellCommand]],
    ['konsole', ['-e', 'sh', '-lc', shellCommand]],
    ['x-terminal-emulator', ['-e', 'sh', '-lc', shellCommand]],
    ['xterm', ['-e', shellCommand]],
  ];
  for (const [cmd, args] of attempts) {
    try {
      execFileSync(cmd, args, { stdio: 'ignore', timeout: EXEC_TIMEOUT_MS });
      return { ok: true };
    } catch (err: unknown) {
      log.error(formatError(err));
    }
  }
  return { ok: false, error: 'No terminal emulator found' };
}

function spawnOnWindows(shellCommand: string): SpawnResult {
  try {
    try {
      execFileSync('wt', ['new-tab', 'cmd', '/k', shellCommand], {
        stdio: 'ignore',
        timeout: EXEC_TIMEOUT_MS,
      });
      return { ok: true };
    } catch (err: unknown) {
      log.error(formatError(err));
    }
    execFileSync('cmd', ['/c', 'start', '', 'cmd', '/k', shellCommand], {
      stdio: 'ignore',
      timeout: EXEC_TIMEOUT_MS,
    });
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: formatError(err) };
  }
}

// ── Main spawn function ──────────────────────────────

export function spawnInTerminal(launch: TerminalLaunch): SpawnResult {
  const shellCommand = buildTerminalCommand(launch);
  const env = detectTerminalEnvironment();

  const spawners: Record<string, () => SpawnResult> = {
    tmux: () => spawnInTmux(shellCommand, launch.cwd),
    'ide-terminal': () => spawnInIdeTerminal(shellCommand, launch.cwd, launch.toolName),
    iterm2: () => spawnInIterm2(shellCommand),
    'macos-terminal': () => spawnInMacosTerminal(shellCommand),
    linux: () => spawnOnLinux(shellCommand),
    windows: () => spawnOnWindows(shellCommand),
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

export function readPidFile(agentId: string): number | null {
  try {
    const safe = safeAgentId(agentId);
    const pidPath = join(PIDS_DIR, `${safe}.pid`);
    if (!existsSync(pidPath)) return null;
    const content = readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch (err: unknown) {
    log.error(formatError(err));
    return null;
  }
}

export function cleanPidFile(agentId: string): void {
  try {
    const safe = safeAgentId(agentId);
    const pidPath = join(PIDS_DIR, `${safe}.pid`);
    if (existsSync(pidPath)) unlinkSync(pidPath);
  } catch (err: unknown) {
    log.error(formatError(err));
  }
}

export function killByPid(pid: number): boolean {
  try {
    process.kill(pid, 'SIGTERM');
    setTimeout(() => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (err: unknown) {
        log.error(formatError(err));
      }
    }, KILL_GRACE_MS);
    return true;
  } catch (err: unknown) {
    log.error(formatError(err));
    return false;
  }
}

// Re-export isProcessAlive from shared (imported above)
export { isProcessAlive };
