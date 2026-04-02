import { detectTerminalEnvironment } from './terminal-spawner.js';
import { execFileSync } from 'child_process';
import { shellQuote, escapeAppleScriptString } from './utils/shell.js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export function openCommandInTerminal(command, cwd = process.cwd()) {
  const env = detectTerminalEnvironment();

  // IDE terminal — write to launch queue so the command runs in-IDE
  if (env.type === 'ide-terminal') {
    try {
      const queuePath = join(homedir(), '.chinwag', 'launch-queue.json');
      mkdirSync(join(homedir(), '.chinwag'), { recursive: true });
      writeFileSync(queuePath, JSON.stringify({
        command,
        name: 'fix',
        cwd,
      }));
      return { ok: true };
    } catch (err) {
      console.error('[chinwag]', err?.message || err);
      // fall through to platform spawners
    }
  }

  try {
    if (process.platform === 'darwin') {
      const shellCommand = cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;
      execFileSync('osascript', [
        '-e',
        'tell application "Terminal" to activate',
        '-e',
        `tell application "Terminal" to do script "${escapeAppleScriptString(shellCommand)}"`,
      ], { stdio: 'ignore' });
      return { ok: true };
    }

    if (process.platform === 'linux') {
      const shellCommand = cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;
      const attempts = [
        ['x-terminal-emulator', ['-e', 'sh', '-lc', shellCommand]],
        ['gnome-terminal', ['--', 'sh', '-lc', shellCommand]],
        ['konsole', ['-e', 'sh', '-lc', shellCommand]],
        ['xterm', ['-e', shellCommand]],
      ];

      for (const [cmd, args] of attempts) {
        try {
          execFileSync(cmd, args, { stdio: 'ignore' });
          return { ok: true };
        } catch (err) { console.error('[chinwag]', err?.message || err); }
      }

      return { ok: false, error: 'Could not open a terminal automatically' };
    }

    if (process.platform === 'win32') {
      const shellCommand = cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;
      execFileSync('cmd', ['/c', 'start', '', 'cmd', '/k', shellCommand], { stdio: 'ignore' });
      return { ok: true };
    }

    return { ok: false, error: 'Unsupported platform' };
  } catch (err) {
    return { ok: false, error: err.message || 'Could not open terminal' };
  }
}
