import { detectTerminalEnvironment } from './terminal-spawner.js';
import type { SpawnResult } from './terminal-spawner.js';
import { execFileSync } from 'child_process';
import { shellQuote, escapeAppleScriptString } from './utils/shell.js';
import { writeFileAtomicSync } from '@chinmeister/shared/fs-atomic.js';
import { join } from 'path';
import { homedir } from 'os';
import { formatError, createLogger } from '@chinmeister/shared';
import { EXEC_TIMEOUT_MS } from './constants/timings.js';

const log = createLogger('open-command');

export function openCommandInTerminal(command: string, cwd: string = process.cwd()): SpawnResult {
  const env = detectTerminalEnvironment();

  // IDE terminal — write to launch queue so the command runs in-IDE
  if (env.type === 'ide-terminal') {
    try {
      const queuePath = join(homedir(), '.chinmeister', 'launch-queue.json');
      writeFileAtomicSync(
        queuePath,
        JSON.stringify({
          command,
          name: 'fix',
          cwd,
        }),
      );
      return { ok: true };
    } catch (err: unknown) {
      log.error(formatError(err));
      // fall through to platform spawners
    }
  }

  try {
    if (process.platform === 'darwin') {
      const shellCommand = cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;
      execFileSync(
        'osascript',
        [
          '-e',
          'tell application "Terminal" to activate',
          '-e',
          `tell application "Terminal" to do script "${escapeAppleScriptString(shellCommand)}"`,
        ],
        { stdio: 'ignore', timeout: EXEC_TIMEOUT_MS },
      );
      return { ok: true };
    }

    if (process.platform === 'linux') {
      const shellCommand = cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;
      const attempts: [string, string[]][] = [
        ['x-terminal-emulator', ['-e', 'sh', '-lc', shellCommand]],
        ['gnome-terminal', ['--', 'sh', '-lc', shellCommand]],
        ['konsole', ['-e', 'sh', '-lc', shellCommand]],
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

      return { ok: false, error: 'Could not open a terminal automatically' };
    }

    if (process.platform === 'win32') {
      const shellCommand = cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;
      execFileSync('cmd', ['/c', 'start', '', 'cmd', '/k', shellCommand], {
        stdio: 'ignore',
        timeout: EXEC_TIMEOUT_MS,
      });
      return { ok: true };
    }

    return { ok: false, error: 'Unsupported platform' };
  } catch (err: unknown) {
    return { ok: false, error: formatError(err) };
  }
}
