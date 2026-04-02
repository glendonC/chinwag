// Pure text utilities used by TeamDO for path normalization.

// Strip leading ./ and trailing /, collapse //, remove .. segments — so paths can never escape the project root.
export function normalizePath(p) {
  let result = p.replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
  // Remove any ".." path segments to prevent path traversal
  result = result.split('/').filter(seg => seg !== '..').join('/');
  // Clean up any leading slash that may result from stripping
  result = result.replace(/^\/+/, '');
  return result;
}
