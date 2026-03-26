// Pure text utilities used by TeamDO for path normalization and fuzzy memory dedup.

// Strip leading ./ and trailing /, collapse // — so "src/index.js" and "./src/index.js" match
export function normalizePath(p) {
  return p.replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
}

// Extract significant words for fuzzy dedup (lowercase, >2 chars, no stop words)
const STOP_WORDS = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'this', 'that', 'with', 'from', 'they', 'will', 'when', 'make', 'use', 'used', 'uses', 'using', 'must', 'need', 'needs']);

export function extractWords(text) {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

// Jaccard similarity between two word sets
export function wordSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) { if (b.has(w)) intersection++; }
  return intersection / (a.size + b.size - intersection);
}
