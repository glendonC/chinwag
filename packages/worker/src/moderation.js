// Basic word filter for v1 moderation.
// Checks messages against a blocklist of harmful terms.
// This is intentionally simple — a text file of blocked words.

// Blocklist: slurs, hate speech, explicit content.
// Keep this list maintained. It's the first line of defense.
const BLOCKED_PATTERNS = [
  // This should be populated with actual blocked terms.
  // Keeping it empty here to avoid including slurs in source code.
  // In production, load from a separate file or KV.
];

export function isBlocked(text) {
  const lower = text.toLowerCase();
  return BLOCKED_PATTERNS.some(pattern => lower.includes(pattern));
}

// Rate limiting using DO SQLite or in-memory counters
// For v1: simple in-memory rate tracking per worker instance
const rateLimits = new Map();

export function checkRateLimit(handle, action, maxPerMinute = 10) {
  const key = `${handle}:${action}`;
  const now = Date.now();
  const windowMs = 60 * 1000;

  let entry = rateLimits.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { windowStart: now, count: 0 };
    rateLimits.set(key, entry);
  }

  entry.count++;

  if (entry.count > maxPerMinute) {
    return false; // Rate limited
  }

  return true; // Allowed
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now - entry.windowStart > 120000) {
      rateLimits.delete(key);
    }
  }
}, 60000);
