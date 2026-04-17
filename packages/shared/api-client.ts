import type { RuntimeIdentity } from './agent-identity.js';
import { DEFAULT_API_URL } from './runtime-profile.js';

export { DEFAULT_API_URL } from './runtime-profile.js';

export interface ApiClientConfig {
  baseUrl?: string | undefined;
  authToken?: string | null | undefined;
  agentId?: string | null | undefined;
  runtimeIdentity?: RuntimeIdentity | null | undefined;
  userAgent?: string | null | undefined;
  timeoutMs?: number | undefined;
  maxRetryAttempts?: number | undefined;
  maxTimeoutRetryAttempts?: number | undefined;
  retryDelayMs?: number | undefined;
  timeoutRetryDelayMs?: number | undefined;
  retryableCodes?: string[] | undefined;
  parseErrorMessage?:
    | ((ctx: { method: string; path: string; status: number }) => string)
    | undefined;
  httpErrorMessage?:
    | ((ctx: { method: string; path: string; status: number; data: unknown }) => string)
    | undefined;
  timeoutErrorMessage?: ((ctx: { method: string; path: string }) => string) | undefined;
}

export interface JsonApiClient {
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  del<T = unknown>(path: string, body?: unknown): Promise<T>;
}

export type ApiError =
  | { kind: 'http'; status: number; message: string; data?: unknown }
  | { kind: 'network'; message: string; cause?: Error | undefined }
  | { kind: 'timeout'; message: string };

export class ApiRequestError extends Error {
  readonly kind: ApiError['kind'];
  readonly status?: number;
  readonly data?: unknown;
  readonly code?: string;

  constructor(
    apiError: ApiError,
    options?: { cause?: Error | undefined; code?: string | undefined },
  ) {
    super(apiError.message);
    this.name = 'ApiRequestError';
    this.kind = apiError.kind;
    if (apiError.kind === 'http') {
      this.status = apiError.status;
      this.data = apiError.data;
    }
    if (options?.cause) this.cause = options.cause;
    if (options?.code) this.code = options.code;
  }

  toApiError(): ApiError {
    switch (this.kind) {
      case 'http':
        return { kind: 'http', status: this.status!, message: this.message, data: this.data };
      case 'network':
        return {
          kind: 'network',
          message: this.message,
          cause: this.cause instanceof Error ? this.cause : undefined,
        };
      case 'timeout':
        return { kind: 'timeout', message: this.message };
    }
  }
}

/** @deprecated Use ApiRequestError. Kept for internal compatibility within the request function. */
interface LegacyApiError extends Error {
  status?: number;
  data?: unknown;
  code?: string;
}

const DEFAULT_RETRYABLE_CODES = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ETIMEDOUT',
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createJsonApiClient({
  baseUrl = DEFAULT_API_URL,
  authToken = null,
  agentId = null,
  runtimeIdentity = null,
  userAgent = null,
  timeoutMs = 10_000,
  maxRetryAttempts = 0,
  maxTimeoutRetryAttempts = 0,
  retryDelayMs = 200,
  timeoutRetryDelayMs = 1_000,
  retryableCodes = DEFAULT_RETRYABLE_CODES,
  parseErrorMessage = ({ status }) => `HTTP ${status} (non-JSON response)`,
  httpErrorMessage = ({ method, path, status, data }) =>
    typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
      ? data.error
      : `${method} ${path} → HTTP ${status}`,
  timeoutErrorMessage = ({ method, path }) => `Request timed out: ${method} ${path}`,
}: ApiClientConfig = {}): JsonApiClient {
  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken) defaultHeaders.Authorization = `Bearer ${authToken}`;
  if (userAgent) defaultHeaders['User-Agent'] = userAgent;
  if (agentId) defaultHeaders['X-Agent-Id'] = agentId;
  if (runtimeIdentity?.hostTool) defaultHeaders['X-Agent-Host-Tool'] = runtimeIdentity.hostTool;
  if (runtimeIdentity?.agentSurface)
    defaultHeaders['X-Agent-Surface'] = runtimeIdentity.agentSurface;
  if (runtimeIdentity?.transport) defaultHeaders['X-Agent-Transport'] = runtimeIdentity.transport;
  if (runtimeIdentity?.tier) defaultHeaders['X-Agent-Tier'] = runtimeIdentity.tier;

  async function request<T = unknown>(
    method: string,
    path: string,
    body: unknown = null,
    attempt = 0,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const opts: RequestInit = {
        method,
        headers: { ...defaultHeaders },
        signal: controller.signal,
      };

      if (body !== null) {
        opts.body = JSON.stringify(body);
      }

      const res = await fetch(`${baseUrl}${path}`, opts);

      if ((res.status >= 500 || res.status === 429) && attempt < maxRetryAttempts) {
        clearTimeout(timeout);
        const backoff =
          res.status === 429
            ? Math.max(1000, parseInt(res.headers.get('retry-after') || '1', 10) * 1000)
            : retryDelayMs * Math.pow(2, attempt);
        await sleep(backoff);
        return request<T>(method, path, body, attempt + 1);
      }

      let data: unknown;
      try {
        data = await res.json();
      } catch {
        throw new ApiRequestError({
          kind: 'http',
          status: res.status,
          message: parseErrorMessage({ method, path, status: res.status }),
        });
      }

      if (!res.ok) {
        throw new ApiRequestError({
          kind: 'http',
          status: res.status,
          message: httpErrorMessage({ method, path, status: res.status, data }),
          data,
        });
      }

      return data as T;
    } catch (error: unknown) {
      // Re-throw our own errors directly
      if (error instanceof ApiRequestError) throw error;

      const legacyErr: LegacyApiError =
        error instanceof Error
          ? (error as LegacyApiError)
          : (new Error(String(error)) as LegacyApiError);

      if (legacyErr.name === 'AbortError') {
        if (attempt < maxTimeoutRetryAttempts) {
          await sleep(timeoutRetryDelayMs);
          return request<T>(method, path, body, attempt + 1);
        }
        throw new ApiRequestError({
          kind: 'timeout',
          message: timeoutErrorMessage({ method, path }),
        });
      }

      if (legacyErr.code && retryableCodes.includes(legacyErr.code) && attempt < maxRetryAttempts) {
        await sleep(retryDelayMs * Math.pow(2, attempt));
        return request<T>(method, path, body, attempt + 1);
      }

      throw new ApiRequestError(
        {
          kind: 'network',
          message: legacyErr.message,
          cause: legacyErr instanceof Error ? legacyErr : undefined,
        },
        { code: legacyErr.code },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    request,
    get: <T = unknown>(path: string) => request<T>('GET', path),
    post: <T = unknown>(path: string, body?: unknown) => request<T>('POST', path, body),
    put: <T = unknown>(path: string, body?: unknown) => request<T>('PUT', path, body),
    del: <T = unknown>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  };
}
