// Token validation, refresh, and profile registration for the MCP server.
// CRITICAL: Never console.log — stdio transport. Use console.error.

import { mkdirSync, writeFileSync } from 'fs';
import { CONFIG_DIR, CONFIG_FILE } from '@chinwag/shared/config.js';

/**
 * Validate that a chinwag config exists and has a valid token.
 * If the access token is expired, attempts a transparent refresh using the
 * refresh token (180-day TTL vs 90-day access token).
 * Exits the process with an error message if validation fails.
 * @param {{ configExists: () => boolean, loadConfig: () => object, api: Function }} deps
 * @returns {Promise<{ config: object }>} Validated (and possibly refreshed) config
 */
export async function validateConfig({ configExists, loadConfig, api }) {
  if (!configExists()) {
    console.error('[chinwag] No config found. Run `npx chinwag` first to create an account.');
    process.exit(1);
  }

  let config = loadConfig();
  if (!config?.token) {
    console.error('[chinwag] Invalid config — missing token. Run `npx chinwag` to re-initialize.');
    process.exit(1);
  }

  // Verify token is still valid; if expired, attempt transparent refresh.
  const preflightClient = api(config);
  try {
    await preflightClient.get('/me');
  } catch (err) {
    if (err.status === 401 && config.refresh_token) {
      console.error('[chinwag] Access token expired, attempting refresh...');
      try {
        const refreshResult = await preflightClient.post('/auth/refresh', {
          refresh_token: config.refresh_token,
        });
        config = {
          ...config,
          token: refreshResult.token,
          refresh_token: refreshResult.refresh_token,
        };
        try {
          mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
          writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
        } catch (writeErr) {
          console.error('[chinwag] Warning: could not persist refreshed token:', writeErr.message);
        }
        console.error('[chinwag] Token refreshed successfully.');
      } catch (refreshErr) {
        console.error('[chinwag] Token refresh failed:', refreshErr.message);
        console.error('[chinwag] Run `npx chinwag init` to re-authenticate.');
        process.exit(1);
      }
    } else if (err.status === 401) {
      console.error('[chinwag] Access token expired and no refresh token available.');
      console.error('[chinwag] Run `npx chinwag init` to re-authenticate.');
      process.exit(1);
    }
    // Non-401 errors: proceed anyway — might be temporary network issue
  }

  return { config };
}

/**
 * Register the agent's environment profile with the backend.
 * Logs the result but never blocks startup on failure.
 * @param {object} client - API client
 * @param {object} profile - Environment profile from scanEnvironment()
 */
export async function registerProfile(client, profile) {
  try {
    await client.put('/agent/profile', profile);
    console.error(
      `[chinwag] Profile registered: ${[...profile.languages, ...profile.frameworks].join(', ') || 'no stack detected'}`,
    );
  } catch (err) {
    console.error('[chinwag] Failed to register profile:', err.message);
  }
}
