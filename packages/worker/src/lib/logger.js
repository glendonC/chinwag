// Structured logging for Cloudflare Workers.
// Outputs JSON to console.log (worker context, not MCP stdio).
// Supports levels: debug, info, warn, error.
// Debug level only outputs when LOG_LEVEL === 'debug'.
//
// Usage:
//   const log = createLogger('TeamDO');
//   log.info('member joined', { agentId, teamId });
//   log.error('lock release failed', { agentId, error: err.message });

/** @type {'debug' | 'info' | 'warn' | 'error'} */
let globalLogLevel = 'info';

const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Set the global log level. Call once at request start if env.LOG_LEVEL is set.
 * @param {string} level
 */
export function setLogLevel(level) {
  if (level && LEVEL_RANK[level] !== undefined) {
    globalLogLevel = level;
  }
}

/**
 * Create a scoped logger instance.
 * @param {string} source - Component name (e.g. 'TeamDO', 'moderation', 'membership')
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
export function createLogger(source) {
  function emit(level, msg, extra) {
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
