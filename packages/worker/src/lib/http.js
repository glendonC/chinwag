export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

import { MAX_BODY_SIZE } from './constants.js';

export async function parseBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return { _parseError: 'Content-Type must be application/json' };
  }

  let raw;
  try {
    raw = await request.text();
  } catch {
    return { _parseError: 'Could not read body' };
  }

  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_SIZE) {
    return { _parseError: 'Request body too large' };
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { _parseError: 'Invalid JSON body' };
  }
}
