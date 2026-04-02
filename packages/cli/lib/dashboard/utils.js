export function truncateText(text, max) {
  if (!text) return text;
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}\u2026`;
}

import { execFileSync } from 'child_process';
import { homedir } from 'os';

const EXEC_TIMEOUT_MS = 10000;
export const DASHBOARD_URL = process.env.CHINWAG_DASHBOARD_URL || 'https://chinwag.dev/dashboard';
export const MIN_WIDTH = 50;
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function openWebDashboard(token) {
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
  } catch (err) {
    console.error('[chinwag]', err?.message || err);
    return { ok: false, error: 'Could not open browser' };
  }
}

// stripAnsi: use utils/ansi.js (canonical implementation)

export function getVisibleWindow(items, selectedIdx, maxItems) {
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

export function formatProjectPath(projectRoot) {
  const home = homedir();
  if (projectRoot?.startsWith(home)) {
    return `~${projectRoot.slice(home.length)}`;
  }
  return projectRoot;
}
