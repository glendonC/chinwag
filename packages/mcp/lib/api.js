import { createJsonApiClient, DEFAULT_API_URL } from '../../shared/api-client.js';

export function getApiUrl() {
  return process.env.CHINWAG_API_URL || DEFAULT_API_URL;
}

export function api(config, { agentId, runtimeIdentity } = {}) {
  return createJsonApiClient({
    baseUrl: getApiUrl(),
    authToken: config?.token || null,
    agentId,
    runtimeIdentity,
    userAgent: 'chinwag-mcp/1.0',
    timeoutMs: 10_000,
    maxRetryAttempts: 2,
    maxTimeoutRetryAttempts: 1,
    httpErrorMessage: ({ status, data }) => data?.error || `HTTP ${status}`,
    timeoutErrorMessage: ({ method, path }) => `Request timed out: ${method} ${path}`,
  });
}
