/**
 * Type guard utilities to replace `as unknown as` casts throughout the CLI package.
 */

/**
 * Checks whether a value is an object with an `error` string property.
 * Used for API responses that may return `{ error: string }` instead of expected data.
 */
export function hasError(value: unknown): value is { error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as Record<string, unknown>).error === 'string'
  );
}

/**
 * Checks whether a value is an object with an optional `error` string property.
 */
export function mayHaveError(value: unknown): value is { error?: string } {
  if (typeof value !== 'object' || value === null) return false;
  if (!('error' in value)) return true;
  return typeof (value as Record<string, unknown>).error === 'string';
}
