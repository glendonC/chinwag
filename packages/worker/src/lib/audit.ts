// Structured audit logging for security-relevant worker operations.
//
// Output: a single line of JSON per event, prefixed with `audit: true` so
// downstream tooling can grep/filter cleanly. Routes through `console.log`,
// which Cloudflare Workers Observability captures and surfaces in the
// dashboard.
//
// Long-term retention / search goes through Cloudflare Logpush. Configure
// a sink (R2, S3, Splunk, etc.) once in the Cloudflare dashboard with a
// filter expression like:
//
//   ScriptName eq "chinmeister-api" AND $1 contains '"audit":true'
//
// No per-deploy config is required - Logpush is account-level. The audit
// payloads below are designed to survive the JSON-string round-trip through
// the workers logging pipeline (no nested objects deeper than 1 level, all
// IDs as plain strings, timestamps in ISO-8601).
//
// Coverage rules:
//   - Every mutation that changes another user's view of state.
//   - Every authentication and authorization decision (success and failure).
//   - Every irreversible operation: deletions, revocations, role changes.
//   - Skip read-only operations and idempotent counters.
// When in doubt: log it. Log volume is cheap; missing audit trail is not.

interface AuditDetails {
  /** Display handle of the acting user. Prefer this for human-readable logs. */
  actor?: string;
  /** Stable user ID. Survives handle changes and is the right join key. */
  actor_id?: string;
  /** Outcome enum: 'success' | 'failure' | 'denied'. */
  outcome?: string;
  /** Team scope when the event is team-scoped. */
  team_id?: string;
  /** Resource identifier (memory_id, session_id, etc.) the event acts on. */
  resource_id?: string;
  /** Free-form additional context. Avoid PII; this is retained per Logpush policy. */
  meta?: Record<string, unknown>;
}

/** Log a structured audit event. See module header for retention details. */
export function auditLog(
  action: string,
  {
    actor = 'unknown',
    actor_id,
    outcome = 'success',
    team_id,
    resource_id,
    meta = {},
  }: AuditDetails = {},
): void {
  const entry: Record<string, unknown> = {
    audit: true,
    action,
    actor,
    outcome,
    ts: new Date().toISOString(),
  };
  if (actor_id) entry.actor_id = actor_id;
  if (team_id) entry.team_id = team_id;
  if (resource_id) entry.resource_id = resource_id;
  // Spread meta last so domain fields don't get overwritten by accident.
  for (const [k, v] of Object.entries(meta)) {
    if (entry[k] === undefined) entry[k] = v;
  }
  console.log(JSON.stringify(entry));
}
