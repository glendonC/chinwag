// Structured logging for Cloudflare Workers.
// Outputs JSON to console.log (worker context, not MCP stdio).
// Supports levels: debug, info, warn, error.
// Debug level only outputs when LOG_LEVEL === 'debug'.
//
// Usage:
//   const log = createLogger('TeamDO');
//   log.info('member joined', { agentId, teamId });
//   log.error('lock release failed', { agentId, error: err.message });

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let globalLogLevel: LogLevel = 'info';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Set the global log level. Call once at request start if env.LOG_LEVEL is set. */
export function setLogLevel(level: string): void {
  const normalized = typeof level === 'string' ? level.toLowerCase() : '';
  if (normalized && normalized in LEVEL_RANK) {
    globalLogLevel = normalized as LogLevel;
  }
}

export interface Logger {
  debug: (msg: string, extra?: Record<string, unknown>) => void;
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, extra?: Record<string, unknown>) => void;
}

/** Create a scoped logger instance. */
export function createLogger(source: string): Logger {
  function emit(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[globalLogLevel]) return;

    const entry = {
      level,
      source,
      msg,
      ts: new Date().toISOString(),
      ...extra,
    };
    console.log(JSON.stringify(entry));
  }

  return {
    debug: (msg, extra) => emit('debug', msg, extra),
    info: (msg, extra) => emit('info', msg, extra),
    warn: (msg, extra) => emit('warn', msg, extra),
    error: (msg, extra) => emit('error', msg, extra),
  };
}
