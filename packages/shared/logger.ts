// Structured logging for Node.js packages (MCP, CLI, shared).
// All output goes through console.error — never console.log.
// This is critical for MCP (stdout is JSON-RPC) and safe for CLI (Ink owns stdout).
//
// Normal mode: plain human-readable lines with [chinmeister] prefix.
// Debug mode (CHINMEISTER_DEBUG=1): adds source tag, level, and JSON context.

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function isDebugMode(): boolean {
  return typeof process !== 'undefined' && !!process.env?.CHINMEISTER_DEBUG;
}

function formatMessage(
  source: string,
  level: Level,
  msg: string,
  ctx?: Record<string, unknown>,
): string {
  if (isDebugMode()) {
    const prefix = `[chinmeister:${source}]`;
    const levelTag = level === 'info' ? '' : ` ${level.toUpperCase()}`;
    const ctxStr = ctx && Object.keys(ctx).length > 0 ? ` ${JSON.stringify(ctx)}` : '';
    return `${prefix}${levelTag} ${msg}${ctxStr}`;
  }
  return `[chinmeister] ${msg}`;
}

/**
 * Create a scoped logger for a module.
 * All output uses console.error (stdio safety for MCP, Ink safety for CLI).
 * Debug messages only appear when CHINMEISTER_DEBUG is set.
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
