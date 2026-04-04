import type { ParsedBody } from '../types.js';
import { MAX_BODY_SIZE } from './constants.js';

/** Create a JSON response. */
export function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

/**
 * Parse a JSON request body with Content-Type and size validation.
 * Returns the parsed object, or an object with `_parseError` on failure.
 */
export async function parseBody(request: Request): Promise<ParsedBody> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return { _parseError: 'Content-Type must be application/json' };
  }

  let raw: string;
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
