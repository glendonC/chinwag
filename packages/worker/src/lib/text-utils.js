// Pure text utilities used by TeamDO for path normalization and date formatting.

// Strip leading ./ and trailing /, collapse //, remove .. segments — so paths can never escape the project root.
export function normalizePath(p) {
  let result = p.replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
  // Remove any ".." path segments to prevent path traversal
  result = result.split('/').filter(seg => seg !== '..').join('/');
  // Clean up any leading slash that may result from stripping
  result = result.replace(/^\/+/, '');
  return result;
}

// Convert a JS Date (or now) to SQLite-compatible datetime string: "YYYY-MM-DD HH:MM:SS"
export function toSQLDateTime(date) {
  return (date || new Date()).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}
