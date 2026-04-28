// Integration wiring for the billing-blocks DO RPC. Exhaustive
// algorithm coverage lives in billing-blocks.test.js; this suite just
// makes sure the DO method + ownership gate return the contract shape
// clients expect, even when there are no events yet.

import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function getTeam(id) {
  return env.TEAM.get(env.TEAM.idFromName(id));
}

describe('TeamDO.getBillingBlocks - wiring', () => {
  const team = () => getTeam('billing-blocks-wiring');
  const agentId = 'cursor:bb1';
  const ownerId = 'user-bb1';

  it('setup: join team', async () => {
    await team().join(agentId, ownerId, 'alice', 'cursor');
  });

  it('returns the full contract shape even when there are no events', async () => {
    const res = await team().getBillingBlocks(ownerId);
    expect(res.error).toBeUndefined();
    expect(res.session_duration_hours).toBe(5);
    expect(Array.isArray(res.blocks)).toBe(true);
    expect(res.blocks).toHaveLength(0);
    expect(res.active).toBeNull();
    expect(res.burn_rate).toBeNull();
    expect(res.projection).toBeNull();
  });

  it('rejects callers whose ownerId does not match any team member', async () => {
    const res = await team().getBillingBlocks('unknown-user');
    expect(res.error).toBeTruthy();
  });
});
