// API_URL will point to the deployed Cloudflare Worker
// During development, use wrangler dev's local URL
const API_URL = process.env.CHINWAG_API_URL || 'https://chinwag-api.glendonchin.workers.dev';

export function api(config) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (config?.token) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }

  async function request(method, path, body = null, attempt = 0) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const opts = { method, headers: { ...headers }, signal: controller.signal };
      if (body) {
        opts.body = JSON.stringify(body);
      }

      const res = await fetch(`${API_URL}${path}`, opts);

      // Retry on server errors (up to 2 retries with backoff)
      if (res.status >= 500 && attempt < 2) {
        clearTimeout(timeout);
        await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt)));
        return request(method, path, body, attempt + 1);
      }

      let data;
      try { data = await res.json(); } catch {
        const parseErr = new Error(`HTTP ${res.status} (non-JSON response)`);
        parseErr.status = res.status;
        throw parseErr;
      }

      if (!res.ok) {
        const err = new Error(data.error || `${method} ${path} → HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }

      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        if (attempt < 1) {
          await new Promise(r => setTimeout(r, 1000));
          return request(method, path, body, attempt + 1);
        }
        const timeoutErr = new Error(`Request timed out: ${method} ${path}`);
        timeoutErr.status = 408;
        throw timeoutErr;
      }
      // Retry on transient network errors
      const RETRYABLE = ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ETIMEDOUT'];
      if (RETRYABLE.includes(err.code) && attempt < 2) {
        await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt)));
        return request(method, path, body, attempt + 1);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path, body) => request('DELETE', path, body),
  };
}

export async function initAccount() {
  const client = api(null);
  return client.post('/auth/init', {});
}
