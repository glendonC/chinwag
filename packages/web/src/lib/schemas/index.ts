// Barrel re-export of all schema modules + validateResponse helper.

export * from './common.js';
export * from './analytics.js';
export * from './conversation.js';

// ── Safe parse wrapper ──────────────────────────────

import { type z } from 'zod';

interface ValidateOptions<F> {
  fallback?: F | (() => F);
  throwOnError?: boolean;
}

/**
 * Validate an API response against a schema. On success, returns the parsed
 * data. On failure, either throws or returns a caller-provided safe fallback.
 */
export function validateResponse<T, F = undefined>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  data: unknown,
  label: string,
  options: ValidateOptions<F> = {},
): T | F {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  console.warn(`[chinmeister] API response validation warning (${label}):`, detail);

  if (options.throwOnError) {
    const error = new Error(`Invalid API response (${label})`);
    error.name = 'SchemaValidationError';
    (error as Error & { details: string }).details = detail;
    throw error;
  }

  return typeof options.fallback === 'function'
    ? (options.fallback as () => F)()
    : (options.fallback as F);
}
