// Compact format - verifies that searchMemories returns trimmed
// {id, tags, preview, updated_at} when format='compact', and falls back
// to full Memory shape otherwise.

import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id) {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

describe('Memory search - compact format', () => {
  const team = () => getTeam('memory-compact');
  const agentId = 'cursor:cmp1';
  const ownerId = 'user-cmp1';
  const longText =
    'This is a long memory body that should be truncated in compact mode. ' +
    'It contains multiple sentences. ' +
    'The first sentence should ideally appear in the preview. ' +
    'After that, additional context follows that the agent can fetch via detail mode if needed. ' +
    'Compact mode caps the preview at 160 characters total to balance signal with token cost.';

  it('setup: join and save a long memory', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
    await team().saveMemory(agentId, longText, ['compact-test'], null, 'alice', ownerId);
  });

  it('default format returns full Memory shape', async () => {
    const res = await team().searchMemories(agentId, 'compact mode', null, null, 10, ownerId);
    expect(res.memories.length).toBe(1);
    expect(res.memories[0]).toHaveProperty('text');
    expect(res.memories[0].text).toBe(longText);
    // No format flag in default response
    expect(res.format).toBeUndefined();
  });

  it('compact format strips to {id, tags, preview, updated_at}', async () => {
    const res = await team().searchMemories(agentId, 'compact mode', null, null, 10, ownerId, {
      format: 'compact',
    });
    expect(res.format).toBe('compact');
    expect(res.memories.length).toBe(1);
    const m = res.memories[0];
    expect(m).toHaveProperty('id');
    expect(m).toHaveProperty('tags');
    expect(m).toHaveProperty('preview');
    expect(m).toHaveProperty('updated_at');
    expect(m).not.toHaveProperty('text');
    expect(m).not.toHaveProperty('agent_model');
  });

  it('compact preview is capped at ~160 chars', async () => {
    const res = await team().searchMemories(agentId, 'compact mode', null, null, 10, ownerId, {
      format: 'compact',
    });
    const preview = res.memories[0].preview;
    expect(preview.length).toBeLessThanOrEqual(200); // sentence-mode allows up to 200, word-boundary stays <= 161
    expect(preview.length).toBeGreaterThan(20);
  });

  it('compact preview prefers the first sentence when one is present', async () => {
    const res = await team().searchMemories(agentId, 'compact mode', null, null, 10, ownerId, {
      format: 'compact',
    });
    const preview = res.memories[0].preview;
    // The first sentence in longText ends with "." after "compact mode."
    // The preview should end at a sentence-final punctuation when possible
    expect(preview).toMatch(/[.!?]$|…$/);
  });

  it('short memories are returned in full (no truncation)', async () => {
    await team().saveMemory(
      agentId,
      'short note about deploys',
      ['compact-test', 'short'],
      null,
      'alice',
      ownerId,
    );
    const res = await team().searchMemories(agentId, 'short note', null, null, 10, ownerId, {
      format: 'compact',
    });
    const short = res.memories.find((m) => m.preview.includes('short note'));
    expect(short.preview).toBe('short note about deploys');
  });
});
