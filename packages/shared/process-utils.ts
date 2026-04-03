import { execFileSync } from 'node:child_process';

const EXEC_TIMEOUT_MS = 5000;

/** Log process-utils errors when CHINWAG_DEBUG is set. */
function debugLog(fn: string, pid: number, err: unknown): void {
  if (!process.env.CHINWAG_DEBUG) return;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[chinwag:process-utils] ${fn}(${pid}) failed: ${message}`);
}

/**
 * Read a process's parent PID and full command string via `ps`.
 * Returns null on Windows, invalid PIDs, or if `ps` fails.
 */
export function readProcessInfo(pid: number): { ppid: number; command: string } | null {
  if (!pid || pid <= 0 || process.platform === 'win32') return null;

  try {
    const line = execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], {
      encoding: 'utf-8',
      timeout: EXEC_TIMEOUT_MS,
    }).trim();

    if (!line) return null;
    const match = line.match(/^\s*(\d+)\s+(.*)$/s);
    if (!match) return null;
    return {
      ppid: Number(match[1]),
      command: match[2],
    };
  } catch (err) {
    debugLog('readProcessInfo', pid, err);
    return null;
  }
}

/**
 * Get the TTY path for a given process via `ps`.
 * Returns null if the process has no controlling terminal.
 */
export function getProcessTtyPath(pid: number): string | null {
  try {
    const ttyName = execFileSync('ps', ['-o', 'tty=', '-p', String(pid)], {
      encoding: 'utf-8',
      timeout: EXEC_TIMEOUT_MS,
    }).trim();
    if (ttyName && ttyName !== '??' && ttyName !== '?') {
      return `/dev/${ttyName}`;
    }
  } catch (err) {
    debugLog('getProcessTtyPath', pid, err);
  }
  return null;
}

/**
 * Get the full command string for a given process via `ps`.
 * Returns null if `ps` fails or the process doesn't exist.
 */
export function getProcessCommandString(pid: number): string | null {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf-8',
      timeout: EXEC_TIMEOUT_MS,
    }).trim();
  } catch (err) {
    debugLog('getProcessCommandString', pid, err);
    return null;
  }
}
