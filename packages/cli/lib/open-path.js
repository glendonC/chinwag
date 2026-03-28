import { execFileSync } from 'child_process';

export function openPath(targetPath) {
  if (!targetPath) {
    return { ok: false, error: 'Missing path' };
  }

  try {
    if (process.platform === 'darwin') {
      execFileSync('open', [targetPath], { stdio: 'ignore' });
      return { ok: true };
    }

    if (process.platform === 'linux') {
      execFileSync('xdg-open', [targetPath], { stdio: 'ignore' });
      return { ok: true };
    }

    if (process.platform === 'win32') {
      execFileSync('cmd', ['/c', 'start', '', targetPath], { stdio: 'ignore' });
      return { ok: true };
    }

    return { ok: false, error: 'Unsupported platform' };
  } catch (err) {
    return { ok: false, error: err.message || 'Could not open path' };
  }
}
