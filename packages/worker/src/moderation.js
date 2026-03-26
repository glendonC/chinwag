// Moderation — two-layer content filtering.
//
// Layer 1: Static blocklist — instant, zero-latency, catches obvious slurs.
//          This is the fallback, not the strategy.
// Layer 2: Llama Guard 3 on Cloudflare Workers AI — catches evasion, nuance, context.
//          Runs on CF edge (same network), no external API keys, customizable taxonomy.
//          Outperforms OpenAI Moderation API on real-world benchmarks (ToxicChat).

const BLOCKED_PATTERNS = [
  'nigger', 'nigga', 'niggers', 'niggas', 'chink', 'chinks', 'wetback',
  'spic', 'spics', 'kike', 'kikes', 'gook', 'gooks', 'coon', 'coons',
  'darkie', 'darkies', 'beaner', 'beaners', 'zipperhead',
  'faggot', 'faggots', 'fag', 'fags', 'dyke', 'dykes', 'tranny', 'trannies',
  'retard', 'retards', 'retarded',
  'kill yourself', 'kys',
  'buy followers', 'free crypto', 'dm me for',
];

const BLOCKED_REGEXES = BLOCKED_PATTERNS.map(
  p => new RegExp(`\\b${p.replace(/\s+/g, '\\s+')}\\b`, 'i')
);

// Layer 1: instant blocklist check (sync, <1ms)
export function isBlocked(text) {
  return BLOCKED_REGEXES.some(r => r.test(text));
}

// Layer 2: AI moderation via Llama Guard 3 on Cloudflare Workers AI.
// Categories: S1 (violent crimes), S2 (non-violent crimes), S3 (sex-related),
// S4 (child safety), S5 (defamation), S6 (specialized advice), S7 (privacy),
// S8 (IP), S9 (indiscriminate weapons), S10 (hate), S11 (suicide/self-harm),
// S12 (sexual content), S13 (elections), S14 (code interpreter abuse).
// Returns { flagged, categories } or null if AI binding unavailable.
export async function moderateWithAI(text, env) {
  if (!env.AI) return null;

  try {
    const response = await env.AI.run('@cf/meta/llama-guard-3-8b', {
      messages: [{ role: 'user', content: text }],
      max_tokens: 64,
    });

    const output = (response.response || '').trim().toLowerCase();

    // Llama Guard outputs "safe" or "unsafe\nS{category}"
    if (output.startsWith('safe')) {
      return { flagged: false };
    }

    // Parse violated categories from output like "unsafe\ns10,s11"
    const categories = [];
    const lines = output.split('\n');
    for (const line of lines) {
      const matches = line.match(/s\d+/gi);
      if (matches) categories.push(...matches.map(m => m.toUpperCase()));
    }

    return { flagged: true, categories };
  } catch (err) {
    console.error('AI moderation error:', err);
    return null; // AI unavailable — degrade gracefully, blocklist still active
  }
}

// Combined check: blocklist first (instant), then AI if available.
// Returns { blocked: boolean, reason?: string }
export async function checkContent(text, env) {
  // Layer 1: instant blocklist
  if (isBlocked(text)) {
    return { blocked: true, reason: 'blocked_term' };
  }

  // Layer 2: AI moderation
  const ai = await moderateWithAI(text, env);
  if (ai?.flagged) {
    return { blocked: true, reason: 'ai_flagged', categories: ai.categories };
  }

  return { blocked: false };
}
