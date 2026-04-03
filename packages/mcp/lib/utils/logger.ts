// Structured logging for the MCP server.
// CRITICAL: All output goes through console.error — never console.log.
// Stdout is reserved for JSON-RPC over stdio transport.
//
// Normal mode: plain human-readable lines with [chinwag] prefix.
// Debug mode (CHINWAG_DEBUG=1): adds source tag and JSON context.

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function isDebugMode(): boolean {
  return !!process.env.CHINWAG_DEBUG;
}

function formatMessage(
  source: string,
  level: Level,
  msg: string,
  ctx?: Record<string, unknown>,
): string {
  if (isDebugMode()) {
    const prefix = `[chinwag:${source}]`;
    const levelTag = level === 'info' ? '' : ` ${level.toUpperCase()}`;
    const ctxStr = ctx && Object.keys(ctx).length > 0 ? ` ${JSON.stringify(ctx)}` : '';
    return `${prefix}${levelTag} ${msg}${ctxStr}`;
  }
  return `[chinwag] ${msg}`;
}

/**
 * Create a scoped logger for a module.
 * All output uses console.error (stdio safety).
 * Debug messages only appear when CHINWAG_DEBUG is set.
 */
export function createLogger(source: string): Logger {
  return {
    debug(msg: string, ctx?: Record<string, unknown>): void {
      if (!isDebugMode()) return;
      console.error(formatMessage(source, 'debug', msg, ctx));
    },

    info(msg: string, ctx?: Record<string, unknown>): void {
      console.error(formatMessage(source, 'info', msg, ctx));
    },

    warn(msg: string, ctx?: Record<string, unknown>): void {
      console.error(formatMessage(source, 'warn', msg, ctx));
    },

    error(msg: string, ctx?: Record<string, unknown>): void {
      console.error(formatMessage(source, 'error', msg, ctx));
    },
  };
}
