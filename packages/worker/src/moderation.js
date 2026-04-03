// Moderation — two-layer content filtering.
//
// Layer 1: Static blocklist — instant, zero-latency, catches obvious slurs.
//          This is the fallback, not the strategy.
// Layer 2: Llama Guard 3 on Cloudflare Workers AI — catches evasion, nuance, context.
//          Runs on CF edge (same network), no external API keys, customizable taxonomy.
//          Outperforms OpenAI Moderation API on real-world benchmarks (ToxicChat).

const BLOCKED_PATTERNS = [
  'nigger',
  'nigga',
  'niggers',
  'niggas',
  'chink',
  'chinks',
  'wetback',
  'spic',
  'spics',
  'kike',
  'kikes',
  'gook',
  'gooks',
  'coon',
  'coons',
  'darkie',
  'darkies',
  'beaner',
  'beaners',
  'zipperhead',
  'faggot',
  'faggots',
  'fag',
  'fags',
  'dyke',
  'dykes',
  'tranny',
  'trannies',
  'retard',
  'retards',
  'retarded',
  'kill yourself',
  'kys',
  'buy followers',
  'free crypto',
  'dm me for',
];

const BLOCKED_REGEXES = BLOCKED_PATTERNS.map(
  (p) => new RegExp(`\\b${p.replace(/\s+/g, '\\s+')}\\b`, 'i'),
);

/**
 * Layer 1: instant blocklist check (sync, <1ms).
 * @param {string} text
 * @returns {boolean}
 */
export function isBlocked(text) {
  return BLOCKED_REGEXES.some((r) => r.test(text));
}

// Layer 2: AI moderation via Llama Guard 3 on Cloudflare Workers AI.
// Categories: S1 (violent crimes), S2 (non-violent crimes), S3 (sex-related),
// S4 (child safety), S5 (defamation), S6 (specialized advice), S7 (privacy),
// S8 (IP), S9 (indiscriminate weapons), S10 (hate), S11 (suicide/self-harm),
// S12 (sexual content), S13 (elections), S14 (code interpreter abuse).
// Returns { flagged, categories, degraded? }.
async function moderateWithAI(text, env) {
  if (!env.AI) {
    console.error('AI moderation degraded: env.AI binding unavailable');
    return { flagged: false, degraded: true };
  }

  try {
    const response = await env.AI.run('@cf/meta/llama-guard-3-8b', {
      messages: [{ role: 'user', content: text }],
      max_tokens: 64,
    });

    const output = (response.response || '').trim().toLowerCase();

    // Guard: empty or completely unexpected output — fail-safe (treat as flagged)
    if (!output) {
      console.error('[chinwag] AI moderation: empty response from model');
      return { flagged: true, categories: [], degraded: true };
    }

    // Llama Guard outputs "safe" or "unsafe\nS{category}"
    if (output.startsWith('safe')) {
      return { flagged: false };
    }

    if (!output.startsWith('unsafe')) {
      // Unexpected format — neither "safe" nor "unsafe". Fail-safe.
      console.error('[chinwag] AI moderation: unexpected output format:', output.slice(0, 100));
      return { flagged: true, categories: [], degraded: true };
    }

    // Parse violated categories from output like "unsafe\ns10,s11"
    const categories = [];
    const lines = output.split('\n');
    for (const line of lines) {
      const matches = line.match(/s\d+/gi);
      if (matches) categories.push(...matches.map((m) => m.toUpperCase()));
    }

    // If "unsafe" but no categories parsed, still treat as flagged (fail-safe)
    if (categories.length === 0) {
      console.error(
        '[chinwag] AI moderation: "unsafe" response but zero categories parsed:',
        output.slice(0, 100),
      );
    }

    return { flagged: true, categories };
  } catch (err) {
    console.error('[chinwag] AI moderation degraded:', err);
    return { flagged: false, degraded: true };
  }
}

/**
 * Combined check: blocklist first (instant), then AI if available.
 * @param {string} text
 * @param {import('./types.js').Env} env
 * @returns {Promise<import('./types.js').ModerationResult>}
 */
export async function checkContent(text, env) {
  // Layer 1: instant blocklist
  if (isBlocked(text)) {
    return { blocked: true, reason: 'blocked_term' };
  }

  // Layer 2: AI moderation
  const ai = await moderateWithAI(text, env);
  if (ai.flagged) {
    return { blocked: true, reason: 'ai_flagged', categories: ai.categories };
  }

  if (ai.degraded) {
    return { blocked: false, degraded: true };
  }

  return { blocked: false };
}
