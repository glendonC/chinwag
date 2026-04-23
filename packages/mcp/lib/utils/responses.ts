// Standard MCP tool response builders and error extraction helpers.
// Centralizes the response shape so tool handlers stay focused on logic.

import { formatError, getHttpStatus } from '@chinmeister/shared/error-utils.js';

export { getHttpStatus };

export interface McpToolContent {
  type: 'text';
  text: string;
}

export interface McpToolResult {
  [key: string]: unknown;
  content: McpToolContent[];
  isError?: boolean;
}

/** Extract a message string from an unknown error. */
export function getErrorMessage(err: unknown): string {
  return formatError(err);
}

/**
 * Error response for tools that require team membership.
 * Accepts optional context to surface specific failure reasons.
 */
export function noTeam(context?: {
  teamJoinError?: string | null;
  heartbeatDead?: boolean;
}): McpToolResult {
  if (context?.heartbeatDead) {
    return {
      content: [
        {
          type: 'text',
          text: 'Connection to team lost after repeated failures. Try leaving and rejoining the team.',
        },
      ],
      isError: true,
    };
  }
  if (context?.teamJoinError) {
    return {
      content: [{ type: 'text', text: `Not in a team. ${context.teamJoinError}` }],
      isError: true,
    };
  }
  return {
    content: [{ type: 'text', text: 'Not in a team. Join one first with chinmeister_join_team.' }],
    isError: true,
  };
}

/**
 * Error response from a caught exception.
 * Returns a user-friendly message for 401 auth errors.
 * Accepts unknown to support `catch (err: unknown)` in callers.
 */
export function errorResult(err: unknown): McpToolResult {
  const status = getHttpStatus(err);
  const message = getErrorMessage(err);
  const msg =
    status === 401 ? 'Authentication expired. Please restart your editor to reconnect.' : message;
  return { content: [{ type: 'text', text: msg }], isError: true };
}

/**
 * Success text content response.
 */
export function textResult(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

/**
 * Append a degraded-presence warning to a tool result when heartbeat is dead.
 * Returns the same result object (mutated) for convenience.
 */
export function appendDegradedWarning(
  result: McpToolResult,
  heartbeatDead: boolean,
): McpToolResult {
  if (heartbeatDead && result.content?.length) {
    result.content.push({
      type: 'text',
      text: '\n⚠ Presence degraded: heartbeat lost. Other agents may not see you. Recovery is in progress.',
    });
  }
  return result;
}

// --- Timeout ---

/**
 * Race a promise against a timeout. Rejects with a descriptive error if
 * the timeout fires first. The timer is always cleaned up.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer!));
}

// --- API response validation helpers ---
// Lightweight type guards for degrading gracefully on malformed API responses.
// Avoids adding Zod to the MCP package while preventing unhandled TypeErrors
// when the API returns unexpected shapes.

/** Safely check that a value is a non-null object. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Safely extract an array field from an API response, defaulting to empty. */
export function safeArray<T = unknown>(obj: unknown, key: string): T[] {
  if (!isObject(obj)) return [];
  const val = (obj as Record<string, unknown>)[key];
  return Array.isArray(val) ? (val as T[]) : [];
}

/** Safely extract a string field from an API response. */
export function safeString(obj: unknown, key: string, fallback = ''): string {
  if (!isObject(obj)) return fallback;
  const val = (obj as Record<string, unknown>)[key];
  return typeof val === 'string' ? val : fallback;
}
