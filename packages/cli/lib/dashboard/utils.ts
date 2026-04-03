export function truncateText(
  text: string | null | undefined,
  max: number,
): string | null | undefined {
  if (!text) return text;
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}\u2026`;
}

import { execFileSync } from 'child_process';
import { homedir } from 'os';

const EXEC_TIMEOUT_MS = 10000;
export const DASHBOARD_URL = process.env.CHINWAG_DASHBOARD_URL || 'https://chinwag.dev/dashboard';
export const MIN_WIDTH = 50;
export const SPINNER = [
  '\u280B',
  '\u2819',
  '\u2839',
  '\u2838',
  '\u283C',
  '\u2834',
  '\u2826',
  '\u2827',
  '\u2807',
  '\u280F',
];

interface OpenResult {
  ok: boolean;
  error?: string;
}

export function openWebDashboard(token?: string | null): OpenResult {
  const url = token ? `${DASHBOARD_URL}#token=${token}` : DASHBOARD_URL;
  try {
    if (process.platform === 'darwin') {
      execFileSync('open', [url], { stdio: 'ignore', timeout: EXEC_TIMEOUT_MS });
      return { ok: true };
    }
    if (process.platform === 'linux') {
      execFileSync('xdg-open', [url], { stdio: 'ignore', timeout: EXEC_TIMEOUT_MS });
      return { ok: true };
    }
    if (process.platform === 'win32') {
      execFileSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore', timeout: EXEC_TIMEOUT_MS });
      return { ok: true };
    }
    return { ok: false, error: 'Unsupported platform' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[chinwag]', message);
    return { ok: false, error: 'Could not open browser' };
  }
}

// stripAnsi: use utils/ansi.js (canonical implementation)

interface VisibleWindow<T> {
  items: T[];
  start: number;
}

export function getVisibleWindow<T>(
  items: T[] | null | undefined,
  selectedIdx: number | null | undefined,
  maxItems: number,
): VisibleWindow<T> {
  if (!items?.length || items.length <= maxItems) {
    return { items: items || [], start: 0 };
  }

  if (selectedIdx == null || selectedIdx < 0) {
    return { items: items.slice(0, maxItems), start: 0 };
  }

  const half = Math.floor(maxItems / 2);
  let start = Math.max(0, selectedIdx - half);
  if (start + maxItems > items.length) {
    start = Math.max(0, items.length - maxItems);
  }

  return {
    items: items.slice(start, start + maxItems),
    start,
  };
}

export function formatProjectPath(
  projectRoot: string | null | undefined,
): string | null | undefined {
  const home = homedir();
  if (projectRoot?.startsWith(home)) {
    return `~${projectRoot.slice(home.length)}`;
  }
  return projectRoot;
}
