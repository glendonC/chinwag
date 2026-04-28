// chinmeister API client
// Pure utility - no store imports to avoid circular deps.

import { createJsonApiClient } from '@chinmeister/shared/api-client.js';
import { resolveRuntimeTargets, type RuntimeTargets } from '@chinmeister/shared/runtime-profile.js';

export function getRuntimeTargets(): RuntimeTargets {
  return resolveRuntimeTargets({
    profile: import.meta.env.VITE_CHINMEISTER_PROFILE,
    apiUrl: import.meta.env.VITE_CHINMEISTER_API_URL,
  });
}

export function getApiUrl(): string {
  return getRuntimeTargets().apiUrl;
}

interface ApiOptions {
  signal?: AbortSignal;
}

/**
 * Make an authenticated API request.
 */
export async function api<T = unknown>(
  method: string,
  path: string,
  body: unknown = null,
  authToken: string | null = null,
  options: ApiOptions = {},
): Promise<T> {
  const runtime = getRuntimeTargets();
  return createJsonApiClient({
    baseUrl: runtime.apiUrl,
    authToken,
    timeoutMs: 15_000,
    signal: options.signal,
    parseErrorMessage: ({ status }) => `HTTP ${status} (server error)`,
    httpErrorMessage: ({ status, data }) => (data as { error?: string })?.error || `HTTP ${status}`,
    timeoutErrorMessage: () => 'Request timed out',
  } as Parameters<typeof createJsonApiClient>[0]).request<T>(method, path, body);
}
