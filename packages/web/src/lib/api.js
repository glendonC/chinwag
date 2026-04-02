// chinwag API client
// Pure utility — no store imports to avoid circular deps.

import { createJsonApiClient, DEFAULT_API_URL } from '@chinwag/shared/api-client.js';

const LOCAL_DEV_API_PORT = '8787';

function isLoopbackHostname(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function getLoopbackApiUrl() {
  if (typeof window === 'undefined') return null;
  const hostname = window.location?.hostname || '';
  if (!isLoopbackHostname(hostname)) return null;
  const normalizedHost = hostname === '::1' ? '[::1]' : hostname;
  return `http://${normalizedHost}:${LOCAL_DEV_API_PORT}`;
}

export function getApiUrl() {
  return import.meta.env.VITE_CHINWAG_API_URL || getLoopbackApiUrl() || DEFAULT_API_URL;
}

/**
 * Make an authenticated API request.
 * @param {string} method - HTTP method
 * @param {string} path - API path (e.g. '/me')
 * @param {object|null} body - JSON body
 * @param {string|null} authToken - Bearer token
 * @returns {Promise<object>} parsed JSON response
 */
export async function api(method, path, body = null, authToken = null) {
  return createJsonApiClient({
    baseUrl: getApiUrl(),
    authToken,
    timeoutMs: 15_000,
    parseErrorMessage: ({ status }) => `HTTP ${status} (server error)`,
    httpErrorMessage: ({ status, data }) => data?.error || `HTTP ${status}`,
    timeoutErrorMessage: () => 'Request timed out',
  }).request(method, path, body);
}
