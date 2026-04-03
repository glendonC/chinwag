/** @import { DOError } from '../types.js' */

/**
 * Normalize unknown thrown values into a readable message.
 * @param {unknown} error
 * @returns {string}
 */
export function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Identify the standard Durable Object error return shape.
 * @param {unknown} value
 * @returns {value is DOError}
 */
export function isDOError(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'string'
  );
}
