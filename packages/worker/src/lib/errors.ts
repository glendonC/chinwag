import type { DOError } from '../types.js';

/** Normalize unknown thrown values into a readable message. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Identify the standard Durable Object error return shape. */
export function isDOError(value: unknown): value is DOError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as DOError).error === 'string'
  );
}
