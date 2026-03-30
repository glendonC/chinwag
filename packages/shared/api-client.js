export const DEFAULT_API_URL = 'https://chinwag-api.glendonchin.workers.dev';

const DEFAULT_RETRYABLE_CODES = ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ETIMEDOUT'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

      if (res.status >= 500 && attempt < maxRetryAttempts) {
        clearTimeout(timeout);
        await sleep(retryDelayMs * Math.pow(2, attempt));
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
