import { execFileSync } from 'child_process';

function shellQuote(value) {
  return JSON.stringify(String(value));
}

function buildShellCommand(command, cwd) {
  if (!cwd) return command;
  return `cd ${shellQuote(cwd)} && ${command}`;
}

function escapeAppleScriptString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

export function openCommandInTerminal(command, cwd = process.cwd()) {
  const shellCommand = buildShellCommand(command, cwd);

  try {
    if (process.platform === 'darwin') {
      execFileSync('osascript', [
        '-e',
        'tell application "Terminal" to activate',
        '-e',
        `tell application "Terminal" to do script "${escapeAppleScriptString(shellCommand)}"`,
      ], { stdio: 'ignore' });
      return { ok: true };
    }

    if (process.platform === 'linux') {
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
        } catch {}
      }

      return { ok: false, error: 'Could not open a terminal automatically' };
    }

    if (process.platform === 'win32') {
      execFileSync('cmd', ['/c', 'start', '', 'cmd', '/k', shellCommand], { stdio: 'ignore' });
      return { ok: true };
    }

    return { ok: false, error: 'Unsupported platform' };
  } catch (err) {
    return { ok: false, error: err.message || 'Could not open terminal' };
  }
}
