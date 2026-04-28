import { describe, it, expect, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

import { resolveLiteLLMKey, generateCandidates } from '../lib/litellm-resolver.js';

// A minimal fixture keyset that exercises every branch of the resolver's
// tiered candidate generation. Each test asserts the resolver picks the
// EXPECTED LiteLLM key for a raw `agent_model` string that might arrive
// from a captured session. A more exhaustive harness runs against the
// live LiteLLM JSON in scripts/litellm-resolver.test.ts - this suite
// exists so CI catches regressions on the tiering logic itself without
// fetching external data.
const FIXTURE_KEYS = new Set([
  // Claude dated and bare forms
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  'claude-opus-4-5',
  'claude-opus-4-6-20260205',
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-20250219',
  // Bedrock-style dated-with-version
  'claude-sonnet-4-5-20250929-v1:0',
  // Region-namespaced Bedrock
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  // OpenAI bare
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-codex',
  'gpt-4o',
  'gpt-4o-mini',
  'o3',
  'o3-mini',
  // Gemini bare AND gemini-prefixed
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini/gemini-2.5-pro',
  // Grok only exists with xai/ prefix
  'xai/grok-4',
  'xai/grok-3',
  'xai/grok-code-fast-1',
  // DeepSeek only exists with deepseek/ prefix
  'deepseek/deepseek-v3',
  'deepseek/deepseek-r1',
]);

describe('resolveLiteLLMKey - Claude', () => {
  it('resolves exact dated Claude Sonnet 4.5', () => {
    expect(resolveLiteLLMKey('claude-sonnet-4-5-20250929', FIXTURE_KEYS)).toBe(
      'claude-sonnet-4-5-20250929',
    );
  });

  it('resolves bare Claude Sonnet 4.6 via date strip (Sonnet 4.6 only has bare form)', () => {
    // A session reporting a hypothetical dated Sonnet 4.6 still resolves
    // because the resolver strips the date and finds the bare form.
    expect(resolveLiteLLMKey('claude-sonnet-4-6-20260301', FIXTURE_KEYS)).toBe('claude-sonnet-4-6');
  });

  it('prefers dated form when both bare and dated exist (specificity)', () => {
    // claude-sonnet-4-5-20250929 AND claude-sonnet-4-5 both in fixture.
    // Input is the dated form; resolver must return the dated form, not
    // silently collapse to base.
    expect(resolveLiteLLMKey('claude-sonnet-4-5-20250929', FIXTURE_KEYS)).toBe(
      'claude-sonnet-4-5-20250929',
    );
  });

  it('resolves Opus 4 dated', () => {
    expect(resolveLiteLLMKey('claude-opus-4-20250514', FIXTURE_KEYS)).toBe(
      'claude-opus-4-20250514',
    );
  });

  it('resolves 3.7 Sonnet dated', () => {
    expect(resolveLiteLLMKey('claude-3-7-sonnet-20250219', FIXTURE_KEYS)).toBe(
      'claude-3-7-sonnet-20250219',
    );
  });
});

describe('resolveLiteLLMKey - Bedrock variants', () => {
  it('resolves raw Bedrock dated-with-version key', () => {
    expect(resolveLiteLLMKey('claude-sonnet-4-5-20250929-v1:0', FIXTURE_KEYS)).toBe(
      'claude-sonnet-4-5-20250929-v1:0',
    );
  });

  it('strips bedrock/region/ prefix to find bare form', () => {
    expect(
      resolveLiteLLMKey('bedrock/us-west-2/claude-sonnet-4-5-20250929-v1:0', FIXTURE_KEYS),
    ).toBe('claude-sonnet-4-5-20250929-v1:0');
  });

  it('resolves region-prefixed anthropic. dot-namespace form', () => {
    expect(resolveLiteLLMKey('us.anthropic.claude-sonnet-4-5-20250929-v1:0', FIXTURE_KEYS)).toBe(
      'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    );
  });
});

describe('resolveLiteLLMKey - OpenAI / Codex', () => {
  it('resolves bare gpt-5', () => {
    expect(resolveLiteLLMKey('gpt-5', FIXTURE_KEYS)).toBe('gpt-5');
  });

  it('resolves gpt-5-codex', () => {
    expect(resolveLiteLLMKey('gpt-5-codex', FIXTURE_KEYS)).toBe('gpt-5-codex');
  });

  it('strips openai/ provider prefix', () => {
    expect(resolveLiteLLMKey('openai/gpt-5', FIXTURE_KEYS)).toBe('gpt-5');
  });

  it('resolves o3 reasoning models', () => {
    expect(resolveLiteLLMKey('o3-mini', FIXTURE_KEYS)).toBe('o3-mini');
  });
});

describe('resolveLiteLLMKey - Gemini', () => {
  it('resolves bare Gemini', () => {
    expect(resolveLiteLLMKey('gemini-2.5-pro', FIXTURE_KEYS)).toBe('gemini-2.5-pro');
  });

  it('strips google/ prefix to find bare form', () => {
    expect(resolveLiteLLMKey('google/gemini-2.5-pro', FIXTURE_KEYS)).toBe('gemini-2.5-pro');
  });

  it('strips models/ SDK prefix to find bare form', () => {
    expect(resolveLiteLLMKey('models/gemini-2.5-pro', FIXTURE_KEYS)).toBe('gemini-2.5-pro');
  });

  it('strips vertex_ai/ prefix (Vertex Gemini has no dedicated key)', () => {
    expect(resolveLiteLLMKey('vertex_ai/gemini-2.5-pro', FIXTURE_KEYS)).toBe('gemini-2.5-pro');
  });

  it('prefers gemini/ prefixed key when both exist (specificity)', () => {
    // Both 'gemini-2.5-pro' and 'gemini/gemini-2.5-pro' in fixture.
    // Raw input 'gemini/gemini-2.5-pro' is already a valid key; return as-is.
    expect(resolveLiteLLMKey('gemini/gemini-2.5-pro', FIXTURE_KEYS)).toBe('gemini/gemini-2.5-pro');
  });
});

describe('resolveLiteLLMKey - xAI / DeepSeek (prefix-required vendors)', () => {
  it('adds xai/ prefix for bare grok-4', () => {
    expect(resolveLiteLLMKey('grok-4', FIXTURE_KEYS)).toBe('xai/grok-4');
  });

  it('adds xai/ prefix for grok-3', () => {
    expect(resolveLiteLLMKey('grok-3', FIXTURE_KEYS)).toBe('xai/grok-3');
  });

  it('accepts xai/ prefix when already present', () => {
    expect(resolveLiteLLMKey('xai/grok-code-fast-1', FIXTURE_KEYS)).toBe('xai/grok-code-fast-1');
  });

  it('adds deepseek/ prefix for bare deepseek-v3', () => {
    // CRITICAL: this tests the Bedrock-version-regex fix. A naive `/-v\d+/`
    // would strip `-v3` and leave `deepseek`, which is not a key. The fix
    // requires the `:N` tail for version stripping, so `-v3` is preserved.
    expect(resolveLiteLLMKey('deepseek-v3', FIXTURE_KEYS)).toBe('deepseek/deepseek-v3');
  });

  it('adds deepseek/ prefix for bare deepseek-r1', () => {
    expect(resolveLiteLLMKey('deepseek-r1', FIXTURE_KEYS)).toBe('deepseek/deepseek-r1');
  });
});

describe('resolveLiteLLMKey - edge cases', () => {
  it('returns null for empty string', () => {
    expect(resolveLiteLLMKey('', FIXTURE_KEYS)).toBeNull();
  });

  it('returns null for whitespace', () => {
    expect(resolveLiteLLMKey('   ', FIXTURE_KEYS)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(resolveLiteLLMKey(null, FIXTURE_KEYS)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(resolveLiteLLMKey(undefined, FIXTURE_KEYS)).toBeNull();
  });

  it('returns null for unknown prefix vendor', () => {
    expect(resolveLiteLLMKey('foobar/something', FIXTURE_KEYS)).toBeNull();
  });

  it('returns null for deprecated bare Claude 3.5 (no bare form in LiteLLM)', () => {
    // Our fixture deliberately excludes bare claude-3-5-sonnet to match
    // LiteLLM reality. The resolver should return null and let the
    // telemetry path surface it via models_without_pricing, NOT silently
    // fall back to a family prefix.
    expect(resolveLiteLLMKey('claude-3-5-sonnet', FIXTURE_KEYS)).toBeNull();
  });

  it('does NOT fall back to family prefix for unknown variants', () => {
    // gpt-5.7 is not in the fixture. The resolver must return null rather
    // than silently matching `gpt-5`. This is the explicit "no family
    // prefix fallback" contract.
    expect(resolveLiteLLMKey('gpt-5.7-hypothetical', FIXTURE_KEYS)).toBeNull();
  });

  it('lowercases input (case-insensitive match)', () => {
    expect(resolveLiteLLMKey('CLAUDE-SONNET-4-5', FIXTURE_KEYS)).toBe('claude-sonnet-4-5');
  });

  it('trims leading/trailing whitespace', () => {
    expect(resolveLiteLLMKey('  gpt-5  ', FIXTURE_KEYS)).toBe('gpt-5');
  });
});

describe('generateCandidates', () => {
  it('produces the original input as the first candidate', () => {
    const candidates = generateCandidates('claude-sonnet-4-5-20250929');
    expect(candidates[0]).toBe('claude-sonnet-4-5-20250929');
  });

  it('produces a date-stripped candidate for dated input', () => {
    const candidates = generateCandidates('claude-sonnet-4-5-20250929');
    expect(candidates).toContain('claude-sonnet-4-5');
  });

  it('produces a provider-stripped candidate for prefixed input', () => {
    const candidates = generateCandidates('openai/gpt-5');
    expect(candidates).toContain('gpt-5');
  });

  it('produces prefix-added candidates for bare input', () => {
    const candidates = generateCandidates('grok-4');
    expect(candidates).toContain('xai/grok-4');
  });

  it('returns empty for empty input', () => {
    expect(generateCandidates('')).toEqual([]);
  });

  it('deduplicates identical candidates', () => {
    const candidates = generateCandidates('claude-sonnet-4-5');
    const unique = new Set(candidates);
    expect(candidates.length).toBe(unique.size);
  });
});
