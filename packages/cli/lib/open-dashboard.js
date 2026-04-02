// Opens the chinwag web dashboard in the default browser.
// Passes the auth token via URL hash fragment (never sent to server).

import { execFileSync } from 'child_process';
import { configExists, loadConfig } from './config.js';

const DASHBOARD_URL = process.env.CHINWAG_DASHBOARD_URL || 'https://chinwag.dev/dashboard';

export async function openDashboard() {
  if (!configExists()) {
    console.log('  Run `npx chinwag init` first to create an account.');
    return;
  }

  const config = loadConfig();
  if (!config?.token) {
    console.log('  Invalid config — missing token. Run `npx chinwag init` to re-initialize.');
    return;
  }

  const url = `${DASHBOARD_URL}#token=${config.token}`;

  try {
    // macOS
    if (process.platform === 'darwin') {
      execFileSync('open', [url], { stdio: 'ignore' });
    }
    // Linux
    else if (process.platform === 'linux') {
      execFileSync('xdg-open', [url], { stdio: 'ignore' });
    }
    // Windows
    else if (process.platform === 'win32') {
      execFileSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    }
    else {
      console.log(`  Open this URL in your browser:`);
      console.log(`  ${url}`);
      return;
    }
  } catch (err) {
    console.error('[chinwag]', err?.message || err);
    console.log(`  Could not open browser. Open this URL manually:`);
    console.log(`  ${url}`);
  }
}
