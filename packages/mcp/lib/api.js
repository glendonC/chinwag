const API_URL = process.env.CHINWAG_API_URL || 'https://chinwag-api.glendonchin.workers.dev';

export function api(config) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'chinwag-mcp/1.0',
  };

  if (config?.token) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }

  async function request(method, path, body = null) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const opts = { method, headers: { ...headers }, signal: controller.signal };
      if (body) {
        opts.body = JSON.stringify(body);
      }

      const res = await fetch(`${API_URL}${path}`, opts);
      const data = await res.json();

      if (!res.ok) {
        const err = new Error(data.error || `HTTP ${res.status}`);
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
