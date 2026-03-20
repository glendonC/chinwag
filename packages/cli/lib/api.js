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

  async function request(method, path, body = null) {
    const opts = { method, headers };
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
