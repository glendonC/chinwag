import type { ZodTypeAny } from 'zod';
import type { ParsedBody } from '../types.js';
import { MAX_BODY_SIZE } from './constants.js';
import { createLogger } from './logger.js';

const log = createLogger('http');

interface JsonOptions {
  /** Optional schema to validate the response body against. */
  schema?: ZodTypeAny;
  /** Extra response headers. */
  headers?: Record<string, string>;
  /** Treat mismatches as errors (dev default). When false (prod), log + ship. */
  strictSchema?: boolean;
}

/**
 * Decide whether schema mismatches should hard-fail. Strict on anything that
 * isn't clearly production, so local dev, preview workers, and CI all catch
 * drift immediately. Production keeps serving the original payload and logs
 * the diff so a schema bug can never nuke user traffic.
 */
function isStrictEnv(): boolean {
  const env = (globalThis as { CHINMEISTER_ENV?: string }).CHINMEISTER_ENV;
  return env !== 'production';
}

/** Create a JSON response, optionally runtime-validated against a Zod schema. */
export function json(data: unknown, status = 200, options: JsonOptions = {}): Response {
  let payload = data;

  if (options.schema) {
    const result = options.schema.safeParse(data);
    if (!result.success) {
      const strict = options.strictSchema ?? isStrictEnv();
      const issues = result.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      }));
      log.error('response schema mismatch', { issues });
      if (strict) {
        return new Response(JSON.stringify({ error: 'Response schema violation', issues }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else {
      // Use parsed data so defaults apply and unknown keys strip cleanly.
      payload = result.data;
    }
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
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
