// Standard MCP tool response builders.
// Centralizes the response shape so tool handlers stay focused on logic.

export interface McpToolContent {
  type: 'text';
  text: string;
}

export interface McpToolResult {
  content: McpToolContent[];
  isError?: boolean;
}

interface HttpError extends Error {
  status?: number;
}

/**
 * Error response for tools that require team membership.
 */
export function noTeam(): McpToolResult {
  return {
    content: [{ type: 'text', text: 'Not in a team. Join one first with chinwag_join_team.' }],
    isError: true,
  };
}

/**
 * Error response from a caught exception.
 * Returns a user-friendly message for 401 auth errors.
 */
export function errorResult(err: HttpError): McpToolResult {
  const msg =
    err.status === 401
      ? 'Authentication expired. Please restart your editor to reconnect.'
      : err.message;
  return { content: [{ type: 'text', text: msg }], isError: true };
}

/**
 * Success text content response.
 */
export function textResult(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}
