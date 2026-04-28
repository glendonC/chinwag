// Token validation, refresh, and profile registration for the MCP server.
// CRITICAL: Never console.log - stdio transport. Use console.error.

import { createLogger } from './utils/logger.js';
import { getErrorMessage } from './utils/responses.js';
import { refreshAndPersistToken } from './token-refresh.js';
import type { RefreshResult } from './token-refresh.js';
import { getApiUrl } from './api.js';
import type { EnvironmentProfile } from './profile.js';

const log = createLogger('auth');

// Inflight deduplication for startup token refresh: if multiple concurrent
// validateConfig() calls hit a 401, only one refresh runs.
// Same pattern as api.ts inflightRefresh.
let inflightRefresh: Promise<RefreshResult | null> | null = null;

/** @internal Exported only for testing - resets the inflight deduplication state. */
export function _resetInflightRefresh(): void {
  inflightRefresh = null;
}

/** Config shape as used by the auth module (superset of ChinmeisterConfig). */
interface AuthConfig {
  token?: string;
  refresh_token?: string;
  handle?: string;
  userId?: string;
  color?: string;
  [key: string]: unknown;
}

/** API client subset needed by validateConfig. */
interface AuthApiClient {
  get(path: string): Promise<unknown>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put(path: string, body?: unknown): Promise<unknown>;
}

/** Error with an optional HTTP status code. */
interface HttpError extends Error {
  status?: number;
}

/** Dependencies injected into validateConfig. */
interface ValidateConfigDeps {
  configExists: () => boolean;
  loadConfig: () => AuthConfig | null;
  api: (config: AuthConfig | null, options?: Record<string, unknown>) => AuthApiClient;
}

/**
 * Validate that a chinmeister config exists and has a valid token.
 * If the access token is expired, attempts a transparent refresh using the
 * refresh token (180-day TTL vs 90-day access token).
 * Exits the process with an error message if validation fails.
 */
export async function validateConfig({
  configExists,
  loadConfig,
  api,
}: ValidateConfigDeps): Promise<{ config: AuthConfig }> {
  if (!configExists()) {
    log.error('No config found. Run `npx chinmeister` first to create an account.');
    process.exit(1);
  }

  let config = loadConfig() as AuthConfig;
  if (!config?.token) {
    log.error('Invalid config - missing token. Run `npx chinmeister` to re-initialize.');
    process.exit(1);
  }

  // Verify token is still valid; if expired, attempt transparent refresh.
  const preflightClient = api(config);
  try {
    await preflightClient.get('/me');
  } catch (err: unknown) {
    const httpErr = err as HttpError;
    if (httpErr.status === 401 && config.refresh_token) {
      log.info('Access token expired, attempting refresh...');
      // Deduplicate concurrent refresh attempts across validateConfig calls
      if (!inflightRefresh) {
        inflightRefresh = refreshAndPersistToken(
          getApiUrl(),
          config.refresh_token,
          config as Record<string, unknown>,
        ).finally(() => {
          inflightRefresh = null;
        });
      }
      const refreshed = await inflightRefresh;
      if (refreshed) {
        config = { ...config, token: refreshed.token, refresh_token: refreshed.refresh_token };
      } else {
        log.error('Run `npx chinmeister init` to re-authenticate.');
        process.exit(1);
      }
    } else if (httpErr.status === 401) {
      log.error('Access token expired and no refresh token available.');
      log.error('Run `npx chinmeister init` to re-authenticate.');
      process.exit(1);
    }
    // Non-401 errors: proceed anyway - might be temporary network issue
  }

  return { config };
}

/**
 * Register the agent's environment profile with the backend.
 * Logs the result but never blocks startup on failure.
 */
export async function registerProfile(
  client: AuthApiClient,
  profile: EnvironmentProfile,
): Promise<void> {
  try {
    await client.put('/agent/profile', profile);
    const stack = [...profile.languages, ...profile.frameworks].join(', ') || 'no stack detected';
    log.info(`Profile registered: ${stack}`);
  } catch (err: unknown) {
    log.error('Failed to register profile: ' + getErrorMessage(err));
  }
}
