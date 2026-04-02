/**
 * @typedef {Object} ApiClientConfig
 * @property {string} [baseUrl] - Base URL (default: DEFAULT_API_URL)
 * @property {string} [authToken] - Bearer token
 * @property {string} [agentId] - X-Agent-Id header value
 * @property {import('./agent-identity.js').RuntimeIdentity} [runtimeIdentity]
 * @property {string} [userAgent] - User-Agent header value
 * @property {number} [timeoutMs] - Request timeout in ms (default: 10000)
 * @property {number} [maxRetryAttempts] - Max retries for server/network errors (default: 0)
 * @property {number} [maxTimeoutRetryAttempts] - Max retries for timeouts (default: 0)
 * @property {number} [retryDelayMs] - Base retry delay in ms (default: 200)
 * @property {number} [timeoutRetryDelayMs] - Timeout retry delay in ms (default: 1000)
 * @property {string[]} [retryableCodes] - Network error codes to retry
 * @property {(ctx: {status: number}) => string} [parseErrorMessage]
 * @property {(ctx: {method: string, path: string, status: number, data: *}) => string} [httpErrorMessage]
 * @property {(ctx: {method: string, path: string}) => string} [timeoutErrorMessage]
 */

/**
 * @typedef {Object} JsonApiClient
 * @property {(method: string, path: string, body?: *) => Promise<*>} request
 * @property {(path: string) => Promise<*>} get
 * @property {(path: string, body?: *) => Promise<*>} post
 * @property {(path: string, body?: *) => Promise<*>} put
 * @property {(path: string, body?: *) => Promise<*>} del
 */

/** @type {string} */
export const DEFAULT_API_URL = 'https://chinwag-api.glendonchin.workers.dev';

const DEFAULT_RETRYABLE_CODES = ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ETIMEDOUT'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @param {ApiClientConfig} [config]
 * @returns {JsonApiClient}
 */
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
  httpErrorMessage = ({ method, path, status, data }) => data?.error || `${method} ${path} → HTTP ${status}`,
  timeoutErrorMessage = ({ method, path }) => `Request timed out: ${method} ${path}`,
} = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json',
  };

  if (authToken) defaultHeaders.Authorization = `Bearer ${authToken}`;
  if (userAgent) defaultHeaders['User-Agent'] = userAgent;
  if (agentId) defaultHeaders['X-Agent-Id'] = agentId;
  if (runtimeIdentity?.hostTool) defaultHeaders['X-Agent-Host-Tool'] = runtimeIdentity.hostTool;
  if (runtimeIdentity?.agentSurface) defaultHeaders['X-Agent-Surface'] = runtimeIdentity.agentSurface;
  if (runtimeIdentity?.transport) defaultHeaders['X-Agent-Transport'] = runtimeIdentity.transport;
  if (runtimeIdentity?.tier) defaultHeaders['X-Agent-Tier'] = runtimeIdentity.tier;

  async function request(method, path, body = null, attempt = 0) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const opts = {
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
        const backoff = res.status === 429
          ? Math.max(1000, parseInt(res.headers.get('retry-after') || '1', 10) * 1000)
          : retryDelayMs * Math.pow(2, attempt);
        await sleep(backoff);
        return request(method, path, body, attempt + 1);
      }

      let data;
      try {
        data = await res.json();
      } catch {
        const parseErr = new Error(parseErrorMessage({ method, path, status: res.status }));
        parseErr.status = res.status;
        throw parseErr;
      }

      if (!res.ok) {
        const err = new Error(httpErrorMessage({ method, path, status: res.status, data }));
        err.status = res.status;
        err.data = data;
        throw err;
      }

      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        if (attempt < maxTimeoutRetryAttempts) {
          await sleep(timeoutRetryDelayMs);
          return request(method, path, body, attempt + 1);
        }
        const timeoutErr = new Error(timeoutErrorMessage({ method, path }));
        timeoutErr.status = 408;
        throw timeoutErr;
      }

      if (retryableCodes.includes(err.code) && attempt < maxRetryAttempts) {
        await sleep(retryDelayMs * Math.pow(2, attempt));
        return request(method, path, body, attempt + 1);
      }

      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    request,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path, body) => request('DELETE', path, body),
  };
}
