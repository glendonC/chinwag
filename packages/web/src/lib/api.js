// chinwag API client
// Pure utility — no store imports to avoid circular deps.

const DEFAULT_API_URL = 'https://chinwag-api.glendonchin.workers.dev';

export const API_URL = import.meta.env.VITE_CHINWAG_API_URL || DEFAULT_API_URL;

/**
 * Make an authenticated API request.
 * @param {string} method - HTTP method
 * @param {string} path - API path (e.g. '/me')
 * @param {object|null} body - JSON body
 * @param {string|null} authToken - Bearer token
 * @returns {Promise<object>} parsed JSON response
 */
export async function api(method, path, body = null, authToken = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const opts = { method, headers, signal: controller.signal };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${API_URL}${path}`, opts);

    let data;
    try {
      data = await res.json();
    } catch {
      const parseErr = new Error(`HTTP ${res.status} (server error)`);
      parseErr.status = res.status;
      throw parseErr;
    }

    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }

    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Request timed out');
      timeoutErr.status = 408;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
