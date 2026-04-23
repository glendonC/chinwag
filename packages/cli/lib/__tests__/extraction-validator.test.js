import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { validateSpec, checkConsensus } from '../extraction/validator.js';

function fixtureRoot() {
  return join(
    tmpdir(),
    `chinmeister-validator-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

function goodSpec() {
  return {
    version: 1,
    tool: 'test',
    format: 'jsonl',
    discovery: { strategy: 'fixed-path', relativePath: 'session.jsonl' },
    extractions: {
      tokens: {
        usagePath: 'usage',
        fieldMapping: { input_tokens: 'input_tokens', output_tokens: 'output_tokens' },
        normalization: 'anthropic',
      },
    },
    generatedAt: '2026-04-17T00:00:00Z',
    source: 'manual',
  };
}

describe('validateSpec', () => {
  let dir;
  let sample;

  beforeEach(() => {
    dir = fixtureRoot();
    mkdirSync(dir, { recursive: true });
    sample = join(dir, 'session.jsonl');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('rejects unsupported spec version', async () => {
    const spec = { ...goodSpec(), version: 99 };
    writeFileSync(sample, JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }) + '\n');
    const result = await validateSpec(spec, sample, dir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('version'))).toBe(true);
  });

  it('rejects spec missing required structural fields', async () => {
    const spec = { ...goodSpec(), format: undefined };
    writeFileSync(sample, JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }) + '\n');
    const result = await validateSpec(spec, sample, dir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('format'))).toBe(true);
  });

  it('rejects when sample file cannot be read', async () => {
    const result = await validateSpec(goodSpec(), join(dir, 'missing.jsonl'), dir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('cannot read'))).toBe(true);
  });

  it('rejects empty sample file', async () => {
    writeFileSync(sample, '');
    const result = await validateSpec(goodSpec(), sample, dir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('empty'))).toBe(true);
  });

  it('rejects spec that declares tokens but produces none from non-empty data', async () => {
    const spec = goodSpec();
    writeFileSync(sample, JSON.stringify({ unrelated: 'shape' }) + '\n');
    const result = await validateSpec(spec, sample, dir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('token extraction'))).toBe(true);
  });

  it('accepts a healthy spec + sample', async () => {
    const spec = goodSpec();
    writeFileSync(
      sample,
      JSON.stringify({ usage: { input_tokens: 100, output_tokens: 50 } }) + '\n',
    );
    const result = await validateSpec(spec, sample, dir);
    expect(result.valid).toBe(true);
    expect(result.tokensExtracted).toBe(true);
  });

  it('rejects spec that declares conversation but extracts zero events', async () => {
    const spec = {
      version: 1,
      tool: 'test',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'session.jsonl' },
      extractions: {
        conversation: {
          roleDetection: { field: 'role', userValues: ['user'], assistantValues: ['assistant'] },
          contentPaths: ['content'],
        },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };
    writeFileSync(sample, JSON.stringify({ unrelated: 'shape' }) + '\n');
    const result = await validateSpec(spec, sample, dir);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('conversation extraction'))).toBe(true);
  });

  it('counts conversations and tool calls when both are extracted', async () => {
    const spec = {
      version: 1,
      tool: 'test',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'session.jsonl' },
      extractions: {
        conversation: {
          roleDetection: { field: 'role', userValues: ['user'], assistantValues: ['assistant'] },
          contentPaths: ['content'],
        },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };
    writeFileSync(
      sample,
      [
        JSON.stringify({ role: 'user', content: 'hi' }),
        JSON.stringify({ role: 'assistant', content: 'hello' }),
        JSON.stringify({ role: 'user', content: 'how are you' }),
      ].join('\n') + '\n',
    );
    const result = await validateSpec(spec, sample, dir);
    expect(result.valid).toBe(true);
    expect(result.conversationsExtracted).toBe(3);
  });
});

describe('checkConsensus', () => {
  const base = {
    valid: true,
    conversationsExtracted: 0,
    tokensExtracted: false,
    toolCallsExtracted: 0,
    errors: [],
  };

  it('rejects when either side is invalid', () => {
    const a = { ...base, valid: false };
    const b = { ...base, valid: true };
    expect(checkConsensus(a, b)).toBe(false);
    expect(checkConsensus(b, a)).toBe(false);
  });

  it('accepts identical counts', () => {
    const a = {
      ...base,
      conversationsExtracted: 42,
      tokensExtracted: true,
      toolCallsExtracted: 10,
    };
    const b = {
      ...base,
      conversationsExtracted: 42,
      tokensExtracted: true,
      toolCallsExtracted: 10,
    };
    expect(checkConsensus(a, b)).toBe(true);
  });

  it('accepts up to 10% variance on conversation counts', () => {
    const a = { ...base, conversationsExtracted: 100 };
    const b = { ...base, conversationsExtracted: 92 }; // 8% off
    expect(checkConsensus(a, b)).toBe(true);
  });

  it('rejects more than 10% variance on conversation counts', () => {
    const a = { ...base, conversationsExtracted: 100 };
    const b = { ...base, conversationsExtracted: 85 }; // 15% off
    expect(checkConsensus(a, b)).toBe(false);
  });

  it('rejects when one side has tokens and the other does not', () => {
    const a = { ...base, tokensExtracted: true };
    const b = { ...base, tokensExtracted: false };
    expect(checkConsensus(a, b)).toBe(false);
  });

  it('rejects more than 10% variance on tool call counts', () => {
    const a = { ...base, toolCallsExtracted: 50 };
    const b = { ...base, toolCallsExtracted: 30 };
    expect(checkConsensus(a, b)).toBe(false);
  });
});
