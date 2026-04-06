import { createJsonApiClient } from '@chinwag/shared/api-client.js';
import type { RuntimeIdentity } from '@chinwag/shared/agent-identity.js';
import { resolveRuntimeTargets, type RuntimeTargets } from '@chinwag/shared/runtime-profile.js';
import { loadConfig } from './config.js';
import { refreshAndPersistToken } from './token-refresh.js';
import {
  API_TIMEOUT_MS,
  API_MAX_RETRY_ATTEMPTS,
  API_MAX_TIMEOUT_RETRY_ATTEMPTS,
} from './constants.js';
import type { ApiClient } from './team.js';

/** Error with an optional HTTP status code. */
interface HttpError extends Error {
  status?: number;
}

interface ApiOptions {
  agentId?: string;
  runtimeIdentity?: RuntimeIdentity;
}

export function getRuntimeTargets(): RuntimeTargets {
  return resolveRuntimeTargets({
    profile: process.env.CHINWAG_PROFILE,
    apiUrl: process.env.CHINWAG_API_URL,
    dashboardUrl: process.env.CHINWAG_DASHBOARD_URL,
    chatWsUrl: process.env.CHINWAG_WS_URL,
  });
}

export function getApiUrl(): string {
  return getRuntimeTargets().apiUrl;
}

/**
 * Attempt to refresh the access token using the stored refresh_token.
 * Returns the new access token on success, or null on failure.
 */
async function tryRefreshToken(baseUrl: string): Promise<string | null> {
  const currentConfig = loadConfig();
  const refreshToken = (currentConfig as Record<string, unknown> | null)?.refresh_token;
  if (!refreshToken || typeof refreshToken !== 'string') {
    return null;
  }
  const result = await refreshAndPersistToken(
    baseUrl,
    refreshToken,
    currentConfig as Record<string, unknown>,
  );
  return result?.token ?? null;
}

/** Extended API client that supports identity correction after MCP init. */
export interface IdentityUpdatableClient extends ApiClient {
  /** Rebuild internal HTTP client with corrected agent identity. */
  updateIdentity(newAgentId: string, newRuntime: RuntimeIdentity): void;
}

export function api(
  config: { token?: string | null } | null,
  options: ApiOptions = {},
): IdentityUpdatableClient {
  let agentId = options.agentId;
  let runtimeIdentity = options.runtimeIdentity;
  const { apiUrl: baseUrl } = getRuntimeTargets();

  // Mutable token reference so refresh can update subsequent requests
  let currentToken = config?.token || null;

  // Inflight deduplication: if two concurrent 401s trigger refresh,
  // the second awaits the first's promise instead of starting a new one.
  // Same pattern as context.ts inflightRefresh.
  let inflightRefresh: Promise<string | null> | null = null;

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
      httpErrorMessage: ({ status, data }: { status: number; data: unknown }) =>
        ((data as Record<string, unknown>)?.error as string) || `HTTP ${status}`,
      timeoutErrorMessage: ({ method, path }: { method: string; path: string }) =>
        `Request timed out: ${method} ${path}`,
    });
  }

  let inner = buildClient(currentToken);

  /**
   * Wrap an API call with automatic token refresh on 401.
   * On 401, attempts one refresh cycle. If successful, rebuilds the inner
   * client with the new token and retries the original request once.
   * Uses inflight deduplication so concurrent 401s share a single refresh call.
   */
  async function withRefresh<T>(fn: (client: ApiClient) => Promise<T>): Promise<T> {
    try {
      return await fn(inner);
    } catch (err: unknown) {
      const httpErr = err as HttpError;
      if (httpErr.status !== 401) throw err;

      // Deduplicate concurrent refresh attempts
      if (!inflightRefresh) {
        inflightRefresh = tryRefreshToken(baseUrl).finally(() => {
          inflightRefresh = null;
        });
      }
      const newToken = await inflightRefresh;
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
    updateIdentity(newAgentId: string, newRuntime: RuntimeIdentity) {
      agentId = newAgentId;
      runtimeIdentity = newRuntime;
      inner = buildClient(currentToken);
    },
  };
}
