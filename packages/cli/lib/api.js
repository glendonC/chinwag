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
        await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt)));
        return request(method, path, body, attempt + 1);
      }

      const data = await res.json();

      if (!res.ok) {
        const err = new Error(data.error || `${method} ${path} → HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }

      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`Request timed out: ${method} ${path}`);
        timeoutErr.status = 408;
        throw timeoutErr;
      }
      // Retry on network errors
      if (err.code === 'ECONNREFUSED' && attempt < 2) {
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
    del: (path) => request('DELETE', path),
  };
}

export async function initAccount() {
  const client = api(null);
  return client.post('/auth/init', {});
}
