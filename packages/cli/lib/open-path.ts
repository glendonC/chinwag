import { execFileSync } from 'child_process';
import { EXEC_TIMEOUT_MS } from './constants/timings.js';

interface OpenPathResult {
  ok: boolean;
  error?: string;
}

export function openPath(targetPath: string): OpenPathResult {
  if (!targetPath) {
    return { ok: false, error: 'Missing path' };
  }

  try {
    if (process.platform === 'darwin') {
      execFileSync('open', [targetPath], { stdio: 'ignore', timeout: EXEC_TIMEOUT_MS });
      return { ok: true };
    }

    if (process.platform === 'linux') {
      execFileSync('xdg-open', [targetPath], { stdio: 'ignore', timeout: EXEC_TIMEOUT_MS });
      return { ok: true };
    }

    if (process.platform === 'win32') {
      execFileSync('cmd', ['/c', 'start', '', targetPath], {
        stdio: 'ignore',
        timeout: EXEC_TIMEOUT_MS,
      });
      return { ok: true };
    }

    return { ok: false, error: 'Unsupported platform' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
    return { ok: false, error: message || 'Could not open path' };
  }
}
