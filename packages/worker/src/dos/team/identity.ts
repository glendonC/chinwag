// Identity resolution -- maps an agent ID (possibly partial) to the canonical
// agent_id stored in the members table, with ownership verification.
//
// Resolution chain:
//   1. Exact match on agent_id
//   2. Prefix match (agentId LIKE 'input:%') -- supports tool-scoped IDs
// Both steps verify owner_id when provided.

interface MemberRow {
  agent_id: string;
  owner_id: string;
}

/**
 * Resolve an agent ID to its canonical form, verifying ownership if ownerId is provided.
 */
export function resolveOwnedAgentId(
  sql: SqlStorage,
  agentId: string,
  ownerId: string | null = null,
): string | null {
  // 1. Exact match
  const exact = sql
    .exec('SELECT agent_id, owner_id FROM members WHERE agent_id = ?', agentId)
    .toArray()[0] as unknown as MemberRow | undefined;
  if (exact) {
    return !ownerId || exact.owner_id === ownerId ? exact.agent_id : null;
  }

  // 2. Prefix match -- find most-recently-active member whose ID starts with the input
  const prefixed = sql
    .exec(
      "SELECT agent_id, owner_id FROM members WHERE agent_id LIKE ? || ':%' ORDER BY last_heartbeat DESC LIMIT 1",
      agentId,
    )
    .toArray()[0] as unknown as MemberRow | undefined;
  if (prefixed) {
    return !ownerId || prefixed.owner_id === ownerId ? prefixed.agent_id : null;
  }

  return null;
}
