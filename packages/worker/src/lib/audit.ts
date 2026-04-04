// Structured audit logging for critical worker operations.
// Outputs JSON to console.log (worker context, not MCP).
// Covers: auth events, team membership changes, session lifecycle.

interface AuditDetails {
  actor?: string;
  outcome?: string;
  meta?: Record<string, unknown>;
}

/** Log a structured audit event. */
export function auditLog(
  action: string,
  { actor = 'unknown', outcome = 'success', meta = {} }: AuditDetails = {},
): void {
  const entry = {
    audit: true,
    action,
    actor,
    outcome,
    ts: new Date().toISOString(),
    ...meta,
  };
  console.log(JSON.stringify(entry));
}
