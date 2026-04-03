/**
 * Parse JSON with structured warning logging. Returns defaultValue on failure.
 * @param {string} json - The JSON string to parse
 * @param {string} context - Description of what's being parsed (e.g., 'member.files')
 * @param {*} defaultValue - Fallback value on parse failure
 * @param {object} [log] - Logger with .warn method (defaults to console)
 * @returns {*} Parsed value or defaultValue
 */
export function safeParse(json, context, defaultValue = null, log = console) {
  try {
    return JSON.parse(json);
  } catch (err) {
    log.warn(`[safeParse] ${context}: ${err.message}`, {
      preview: String(json).slice(0, 100),
    });
    return defaultValue;
  }
}
