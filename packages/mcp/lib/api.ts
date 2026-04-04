import { mkdirSync, writeFileSync } from 'fs';
import { createJsonApiClient, DEFAULT_API_URL } from '@chinwag/shared/api-client.js';
import type { RuntimeIdentity } from '@chinwag/shared/agent-identity.js';
import { CONFIG_DIR, CONFIG_FILE } from '@chinwag/shared/config.js';
import { loadConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import {
  API_TIMEOUT_MS,
  API_MAX_RETRY_ATTEMPTS,
  API_MAX_TIMEOUT_RETRY_ATTEMPTS,
} from './constants.js';
import type { ApiClient } from './team.js';

const log = createLogger('api');

/** Error with an optional HTTP status code. */
interface HttpError extends Error {
  status?: number;
}

/** Result of a successful token refresh. */
interface RefreshResult {
  token: string;
  refresh_token: string;
}

interface ApiOptions {
  agentId?: string;
  runtimeIdentity?: RuntimeIdentity;
}

export function getApiUrl(): string {
  return process.env.CHINWAG_API_URL || DEFAULT_API_URL;
}

/**
 * Attempt to refresh the access token using the stored refresh_token.
 * Returns the new access token on success, or null on failure.
 * Persists updated tokens to disk so subsequent processes pick them up.
 */
async function tryRefreshToken(baseUrl: string): Promise<string | null> {
  const currentConfig = loadConfig();
  const refreshToken = (currentConfig as Record<string, unknown> | null)?.refresh_token;
  if (!refreshToken || typeof refreshToken !== 'string') {
    return null;
  }

  try {
    // Use a bare client (no auth) to call the refresh endpoint
    const refreshClient = createJsonApiClient({ baseUrl, userAgent: 'chinwag-mcp/1.0' });
    const result = await refreshClient.post<RefreshResult>('/auth/refresh', {
      refresh_token: refreshToken,
    });

    if (!result.token) return null;

    // Persist refreshed tokens to disk
    const updatedConfig = {
      ...currentConfig,
      token: result.token,
      refresh_token: result.refresh_token,
    };
    try {
      mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(CONFIG_FILE, JSON.stringify(updatedConfig, null, 2) + '\n', { mode: 0o600 });
    } catch (writeErr: unknown) {
      log.warn('Could not persist refreshed token: ' + ((writeErr as Error)?.message || writeErr));
    }

    log.info('Token refreshed successfully at runtime.');
    return result.token;
  } catch (err: unknown) {
    log.error('Runtime token refresh failed: ' + ((err as Error)?.message || err));
    return null;
  }
}

export function api(config: { token?: string | null } | null, options: ApiOptions = {}): ApiClient {
  const { agentId, runtimeIdentity } = options;
  const baseUrl = getApiUrl();

  // Mutable token reference so refresh can update subsequent requests
  let currentToken = config?.token || null;

  function buildClient(token: string | null): ApiClient {
    return createJsonApiClient({
      baseUrl,
      authToken: token,
      agentId,
      runtimeIdentity,
      userAgent: 'chinwag-mcp/1.0',
      timeoutMs: API_TIMEOUT_MS,
      maxRetryAttempts: API_MAX_RETRY_ATTEMPTS,
      maxTimeoutRetryAttempts: API_MAX_TIMEOUT_RETRY_ATTEMPTS,
      httpErrorMessage: ({ status, data }: { status: number; data: any }) =>
        data?.error || `HTTP ${status}`,
      timeoutErrorMessage: ({ method, path }: { method: string; path: string }) =>
        `Request timed out: ${method} ${path}`,
    });
  }

  let inner = buildClient(currentToken);

  /**
   * Wrap an API call with automatic token refresh on 401.
   * On 401, attempts one refresh cycle. If successful, rebuilds the inner
   * client with the new token and retries the original request once.
   */
  async function withRefresh<T>(fn: (client: ApiClient) => Promise<T>): Promise<T> {
    try {
      return await fn(inner);
    } catch (err: unknown) {
      const httpErr = err as HttpError;
      if (httpErr.status !== 401) throw err;

      // Attempt runtime token refresh
      const newToken = await tryRefreshToken(baseUrl);
      if (!newToken) throw err; // refresh failed, propagate original 401

      // Rebuild client with new token and retry once
      currentToken = newToken;
      inner = buildClient(currentToken);
      return fn(inner);
    }
  }

  return {
    get: <T = unknown>(path: string) => withRefresh<T>((c) => c.get(path)),
    post: <T = unknown>(path: string, body?: Record<string, unknown>) =>
      withRefresh<T>((c) => c.post(path, body)),
    put: <T = unknown>(path: string, body: Record<string, unknown>) =>
      withRefresh<T>((c) => c.put(path, body)),
    del: <T = unknown>(path: string, body?: Record<string, unknown>) =>
      withRefresh<T>((c) => c.del(path, body)),
  };
}
