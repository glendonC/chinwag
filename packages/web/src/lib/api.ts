// chinwag API client
// Pure utility — no store imports to avoid circular deps.

import { createJsonApiClient, DEFAULT_API_URL } from '@chinwag/shared/api-client.js';

export function getApiUrl(): string {
  return import.meta.env.VITE_CHINWAG_API_URL || DEFAULT_API_URL;
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
  return createJsonApiClient({
    baseUrl: getApiUrl(),
    authToken,
    timeoutMs: 15_000,
    signal: options.signal,
    parseErrorMessage: ({ status }) => `HTTP ${status} (server error)`,
    httpErrorMessage: ({ status, data }) => (data as { error?: string })?.error || `HTTP ${status}`,
    timeoutErrorMessage: () => 'Request timed out',
  } as Parameters<typeof createJsonApiClient>[0]).request<T>(method, path, body);
}
