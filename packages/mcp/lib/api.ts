import { createJsonApiClient, DEFAULT_API_URL } from '../../shared/api-client.js';
import type { ApiClient } from './team.js';

interface RuntimeIdentity {
  hostTool: string;
  agentSurface?: string;
  transport: string;
  capabilities: string[];
}

interface ApiOptions {
  agentId?: string;
  runtimeIdentity?: RuntimeIdentity;
}

export function getApiUrl(): string {
  return process.env.CHINWAG_API_URL || DEFAULT_API_URL;
}

export function api(config: { token?: string | null } | null, options: ApiOptions = {}): ApiClient {
  const { agentId, runtimeIdentity } = options;
  return createJsonApiClient({
    baseUrl: getApiUrl(),
    authToken: config?.token || null,
    agentId,
    runtimeIdentity,
    userAgent: 'chinwag-mcp/1.0',
    timeoutMs: 10_000,
    maxRetryAttempts: 2,
    maxTimeoutRetryAttempts: 1,
    httpErrorMessage: ({ status, data }: { status: number; data: any }) =>
      data?.error || `HTTP ${status}`,
    timeoutErrorMessage: ({ method, path }: { method: string; path: string }) =>
      `Request timed out: ${method} ${path}`,
  });
}
