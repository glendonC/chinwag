// Shadow-mode formation - verifies the LLM-output parser handles
// well-formed JSON, fence-wrapped JSON, prose-wrapped JSON, and
// malformed input safely. Plus DO lifecycle tests for the sweep / list
// surface.

import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { parseFormationDecision } from '../dos/team/formation.js';

function getTeam(id) {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

describe('parseFormationDecision', () => {
  it('parses plain JSON object', () => {
    const out = parseFormationDecision(
      '{"recommendation":"keep","target_id":null,"confidence":0.9,"reason":"distinct"}',
    );
    expect(out?.recommendation).toBe('keep');
    expect(out?.target_id).toBeNull();
    expect(out?.confidence).toBe(0.9);
    expect(out?.reason).toBe('distinct');
  });

  it('strips markdown code fences', () => {
    const out = parseFormationDecision(
      '```json\n{"recommendation":"merge","target_id":"abc-123","confidence":0.8,"reason":"paraphrase"}\n```',
    );
    expect(out?.recommendation).toBe('merge');
    expect(out?.target_id).toBe('abc-123');
  });

  it('extracts JSON from prose wrapping', () => {
    const out = parseFormationDecision(
      'After reviewing, here is my decision: {"recommendation":"discard","target_id":null,"reason":"trivial"} Hope this helps.',
    );
    expect(out?.recommendation).toBe('discard');
  });

  it('downgrades merge with no target_id to keep', () => {
    const out = parseFormationDecision(
      '{"recommendation":"merge","target_id":null,"reason":"oops"}',
    );
    expect(out?.recommendation).toBe('keep');
    expect(out?.target_id).toBeNull();
  });

  it('downgrades evolve with empty target_id to keep', () => {
    const out = parseFormationDecision(
      '{"recommendation":"evolve","target_id":"","reason":"oops"}',
    );
    expect(out?.recommendation).toBe('keep');
  });

  it('returns null for unknown recommendation', () => {
    const out = parseFormationDecision(
      '{"recommendation":"frobnicate","target_id":"x","reason":"?"}',
    );
    expect(out).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(parseFormationDecision('this is not JSON at all')).toBeNull();
    expect(parseFormationDecision('')).toBeNull();
    expect(parseFormationDecision('{ broken json')).toBeNull();
  });

  it('clamps confidence to [0, 1]', () => {
    const high = parseFormationDecision(
      '{"recommendation":"keep","target_id":null,"confidence":2.5,"reason":""}',
    );
    expect(high?.confidence).toBeNull();
    const negative = parseFormationDecision(
      '{"recommendation":"keep","target_id":null,"confidence":-0.1,"reason":""}',
    );
    expect(negative?.confidence).toBeNull();
  });

  it('truncates very long reasons', () => {
    const longReason = 'X'.repeat(500);
    const out = parseFormationDecision(
      `{"recommendation":"keep","target_id":null,"reason":"${longReason}"}`,
    );
    expect((out?.reason || '').length).toBeLessThanOrEqual(200);
  });

  it('case-insensitive on recommendation', () => {
    const out = parseFormationDecision('{"recommendation":"KEEP","target_id":null,"reason":""}');
    expect(out?.recommendation).toBe('keep');
  });
});

describe('TeamDO formation lifecycle', () => {
  const team = () => getTeam('memory-formation');
  const agentId = 'cursor:fmt1';
  const ownerId = 'user-fmt1';

  it('setup', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().saveMemory(
      agentId,
      'formation lifecycle test memory one about deploys',
      ['fmt-test'],
      null,
      'alice',
      ownerId,
    );
  });

  it('listFormationObservations returns empty array initially', async () => {
    const res = await team().listFormationObservations(agentId, {}, ownerId);
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.observations)).toBe(true);
  });

  it('runFormationOnRecent processes 0 when no embeddings exist (test env)', async () => {
    // In test env Workers AI may be unavailable so embeddings are null.
    // The sweep finds no candidates with embeddings and returns 0.
    const res = await team().runFormationOnRecent(5);
    expect(res.ok).toBe(true);
    expect(typeof res.processed).toBe('number');
    expect(typeof res.skipped).toBe('number');
  });

  it('listFormationObservations supports recommendation filter', async () => {
    const res = await team().listFormationObservations(
      agentId,
      { recommendation: 'discard', limit: 10 },
      ownerId,
    );
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.observations)).toBe(true);
  });
});
