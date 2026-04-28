import { describe, it, expect, vi } from 'vitest';

// Shim cloudflare:workers so any transitive DO imports resolve outside
// the Workers runtime. litellm-transform has no DO dependency but vitest
// sometimes eagerly loads sibling modules.
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

import {
  isTextTokenModel,
  transformLiteLLMEntry,
  ALLOWED_MODES,
  PER_1M,
  perMillion,
} from '../lib/litellm-transform.js';

// --- ALLOWED_MODES ---

describe('ALLOWED_MODES', () => {
  it('includes the three text-token modes', () => {
    expect(ALLOWED_MODES.has('chat')).toBe(true);
    expect(ALLOWED_MODES.has('completion')).toBe(true);
    expect(ALLOWED_MODES.has('responses')).toBe(true);
  });

  it('excludes non-text modes', () => {
    expect(ALLOWED_MODES.has('image')).toBe(false);
    expect(ALLOWED_MODES.has('embedding')).toBe(false);
    expect(ALLOWED_MODES.has('audio_transcription')).toBe(false);
    expect(ALLOWED_MODES.has('rerank')).toBe(false);
  });
});

// --- perMillion ---

describe('perMillion', () => {
  it('returns null for null', () => {
    expect(perMillion(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(perMillion(undefined)).toBeNull();
  });

  it('converts per-token cost to per-1M', () => {
    expect(perMillion(3e-6)).toBeCloseTo(3, 10);
    expect(perMillion(15e-6)).toBeCloseTo(15, 10);
  });

  it('preserves zero', () => {
    expect(perMillion(0)).toBe(0);
  });

  it('returns null for NaN', () => {
    expect(perMillion(Number.NaN)).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(perMillion(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('returns null for non-number input', () => {
    // Forced cast - simulates malformed LiteLLM response
    expect(perMillion('3e-6' as unknown as number)).toBeNull();
  });

  it('PER_1M constant is 1,000,000', () => {
    expect(PER_1M).toBe(1_000_000);
  });
});

// --- isTextTokenModel ---

describe('isTextTokenModel', () => {
  it('rejects sample_spec by name', () => {
    const entry = {
      mode: 'chat',
      input_cost_per_token: 3e-6,
      output_cost_per_token: 15e-6,
    };
    expect(isTextTokenModel('sample_spec', entry)).toBe(false);
  });

  it('accepts a chat-mode model with both costs present', () => {
    expect(
      isTextTokenModel('claude-sonnet-4-5', {
        mode: 'chat',
        input_cost_per_token: 3e-6,
        output_cost_per_token: 15e-6,
      }),
    ).toBe(true);
  });

  it('accepts completion mode', () => {
    expect(
      isTextTokenModel('test-completion-model', {
        mode: 'completion',
        input_cost_per_token: 1e-6,
        output_cost_per_token: 2e-6,
      }),
    ).toBe(true);
  });

  it('accepts responses mode', () => {
    expect(
      isTextTokenModel('test-responses-model', {
        mode: 'responses',
        input_cost_per_token: 1e-6,
        output_cost_per_token: 2e-6,
      }),
    ).toBe(true);
  });

  it('accepts a model with no mode field set (assume text)', () => {
    expect(
      isTextTokenModel('legacy-model', {
        input_cost_per_token: 3e-6,
        output_cost_per_token: 15e-6,
      }),
    ).toBe(true);
  });

  it('rejects image mode', () => {
    expect(
      isTextTokenModel('dall-e-3', {
        mode: 'image',
        input_cost_per_token: 1e-6,
        output_cost_per_token: 2e-6,
      }),
    ).toBe(false);
  });

  it('rejects embedding mode', () => {
    expect(
      isTextTokenModel('text-embedding-3-small', {
        mode: 'embedding',
        input_cost_per_token: 0.02e-6,
        output_cost_per_token: 0,
      }),
    ).toBe(false);
  });

  it('rejects when input_cost_per_token is missing', () => {
    expect(
      isTextTokenModel('broken-model', {
        mode: 'chat',
        output_cost_per_token: 15e-6,
      }),
    ).toBe(false);
  });

  it('rejects when output_cost_per_token is missing', () => {
    expect(
      isTextTokenModel('broken-model', {
        mode: 'chat',
        input_cost_per_token: 3e-6,
      }),
    ).toBe(false);
  });

  it('KEEPS a free-tier model with input_cost_per_token: 0 (nullish, not falsy)', () => {
    // This was the CodeBurn bug - using `!entry.input_cost_per_token` drops
    // legitimate free-tier models. Our check uses nullish comparison.
    expect(
      isTextTokenModel('free-model', {
        mode: 'chat',
        input_cost_per_token: 0,
        output_cost_per_token: 0,
      }),
    ).toBe(true);
  });

  it('rejects null entry', () => {
    expect(isTextTokenModel('null-entry', null as never)).toBe(false);
  });

  it('rejects non-object entry', () => {
    expect(isTextTokenModel('string-entry', 'not an object' as never)).toBe(false);
  });
});

// --- transformLiteLLMEntry ---

describe('transformLiteLLMEntry', () => {
  it('converts full Claude-style entry with all fields', () => {
    const row = transformLiteLLMEntry('claude-sonnet-4-5-20250929', {
      mode: 'chat',
      input_cost_per_token: 3e-6,
      output_cost_per_token: 15e-6,
      cache_creation_input_token_cost: 3.75e-6,
      cache_read_input_token_cost: 0.3e-6,
      input_cost_per_token_above_200k_tokens: 6e-6,
      output_cost_per_token_above_200k_tokens: 22.5e-6,
      max_input_tokens: 200000,
      max_output_tokens: 64000,
    });

    expect(row.canonical_name).toBe('claude-sonnet-4-5-20250929');
    expect(row.input_per_1m).toBeCloseTo(3, 5);
    expect(row.output_per_1m).toBeCloseTo(15, 5);
    expect(row.cache_creation_per_1m).toBeCloseTo(3.75, 5);
    expect(row.cache_read_per_1m).toBeCloseTo(0.3, 5);
    expect(row.input_per_1m_above_200k).toBeCloseTo(6, 5);
    expect(row.output_per_1m_above_200k).toBeCloseTo(22.5, 5);
    expect(row.max_input_tokens).toBe(200000);
    expect(row.max_output_tokens).toBe(64000);
    expect(row.raw).toContain('"input_cost_per_token"');
  });

  it('nulls missing cache fields', () => {
    const row = transformLiteLLMEntry('gpt-4', {
      mode: 'chat',
      input_cost_per_token: 30e-6,
      output_cost_per_token: 60e-6,
    });

    expect(row.cache_creation_per_1m).toBeNull();
    expect(row.cache_read_per_1m).toBeNull();
    expect(row.input_per_1m_above_200k).toBeNull();
    expect(row.output_per_1m_above_200k).toBeNull();
  });

  it('nulls missing max_tokens fields', () => {
    const row = transformLiteLLMEntry('bare-model', {
      input_cost_per_token: 1e-6,
      output_cost_per_token: 2e-6,
    });

    expect(row.max_input_tokens).toBeNull();
    expect(row.max_output_tokens).toBeNull();
  });

  it('preserves zero prices (not converted to null)', () => {
    const row = transformLiteLLMEntry('free-model', {
      mode: 'chat',
      input_cost_per_token: 0,
      output_cost_per_token: 0,
    });

    expect(row.input_per_1m).toBe(0);
    expect(row.output_per_1m).toBe(0);
  });

  it('preserves the full LiteLLM entry as raw JSON string', () => {
    const entry = {
      mode: 'chat',
      input_cost_per_token: 3e-6,
      output_cost_per_token: 15e-6,
      some_future_field: 'preserved',
    };
    const row = transformLiteLLMEntry('future-model', entry);

    expect(row.raw).toBeTruthy();
    const parsed = JSON.parse(row.raw!);
    expect(parsed.some_future_field).toBe('preserved');
  });
});
