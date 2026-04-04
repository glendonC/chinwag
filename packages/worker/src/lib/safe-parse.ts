interface LogLike {
  warn: (msg: string, extra?: Record<string, unknown>) => void;
}

/** Parse JSON with structured warning logging. Returns defaultValue on failure. */
export function safeParse<T = unknown>(
  json: string,
  context: string,
  defaultValue: T = null as T,
  log: LogLike = console,
): T {
  try {
    return JSON.parse(json);
  } catch (err) {
    log.warn(`[safeParse] ${context}: ${(err as Error).message}`, {
      preview: String(json).slice(0, 100),
    });
    return defaultValue;
  }
}
