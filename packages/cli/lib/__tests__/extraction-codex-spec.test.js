// Verifies that the Codex spec's conversation-level tokenPaths extract
// per-message tokens, model, and stop_reason from the rollout JSONL shape
// documented in packages/cli/lib/extraction/specs/codex.json.
//
// The session-level token path already uses `payload.info.last_token_usage`
// and has been in production; this test locks the same path for per-message
// extraction so multi-model Codex sessions (should they arrive) get an
// accurate by-model breakdown instead of everything attributed to the
// session's primary agent_model.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { extract } from '../extraction/engine.js';

function fixtureRoot() {
  return join(
    tmpdir(),
    `chinmeister-codex-spec-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

const codexSpecPath = fileURLToPath(new URL('../extraction/specs/codex.json', import.meta.url));
const codexSpec = JSON.parse(readFileSync(codexSpecPath, 'utf8'));

// Override discovery so the test can write to a tmp dir - the production
// spec's glob-based discovery doesn't apply to fixture paths.
function specForFixture() {
  return {
    ...codexSpec,
    discovery: { strategy: 'fixed-path', relativePath: 'rollout.jsonl' },
  };
}

describe('codex spec: per-message token extraction', () => {
  let dir;
  beforeEach(() => {
    dir = fixtureRoot();
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('pulls per-message tokens from payload.info.last_token_usage at the expected paths', async () => {
    const log = join(dir, 'rollout.jsonl');
    const entry = {
      timestamp: '2026-04-21T10:30:00Z',
      payload: {
        role: 'assistant',
        content: 'ok here is the plan',
        model: 'gpt-5',
        stop_reason: 'end_turn',
        info: {
          last_token_usage: {
            input_tokens: 500,
            cached_input_tokens: 100,
            output_tokens: 80,
          },
        },
      },
    };
    writeFileSync(log, JSON.stringify(entry) + '\n');

    const result = await extract(specForFixture(), dir, 0);
    expect(result.conversations).toHaveLength(1);
    const msg = result.conversations[0];
    expect(msg.role).toBe('assistant');
    // OpenAI normalization applies on the per-message path too: input
    // becomes (raw_input − cached). Locks per-message token domain in sync
    // with session-level aggregation so downstream SQL can sum either
    // source without branching on model family.
    expect(msg.input_tokens).toBe(400);
    expect(msg.output_tokens).toBe(80);
    expect(msg.cache_read_tokens).toBe(100);
    expect(msg.cache_creation_tokens ?? 0).toBe(0);
    expect(msg.model).toBe('gpt-5');
    expect(msg.stop_reason).toBe('end_turn');
  });

  it('gracefully handles assistant messages without token metadata', async () => {
    // Not every assistant emission carries usage (e.g. streaming intermediate
    // chunks); the spec must not drop the conversation event just because
    // tokens are absent.
    const log = join(dir, 'rollout.jsonl');
    const entry = {
      timestamp: '2026-04-21T10:30:00Z',
      payload: { role: 'assistant', content: 'partial response' },
    };
    writeFileSync(log, JSON.stringify(entry) + '\n');

    const result = await extract(specForFixture(), dir, 0);
    expect(result.conversations).toHaveLength(1);
    const msg = result.conversations[0];
    expect(msg.role).toBe('assistant');
    expect(msg.input_tokens ?? 0).toBe(0);
    expect(msg.output_tokens ?? 0).toBe(0);
  });

  it('still emits user messages even without tokenPaths data', async () => {
    const log = join(dir, 'rollout.jsonl');
    writeFileSync(
      log,
      JSON.stringify({
        timestamp: '2026-04-21T10:29:00Z',
        payload: { role: 'user', content: 'please plan the migration' },
      }) + '\n',
    );
    const result = await extract(specForFixture(), dir, 0);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0].role).toBe('user');
  });
});
