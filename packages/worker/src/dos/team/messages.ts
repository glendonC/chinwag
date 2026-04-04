// Ephemeral agent messages -- sendMessage, getMessages.
// Messages auto-expire after 1 hour.
// Each function takes `sql` as the first parameter.

import type { AgentMessage } from '../../types.js';
import { METRIC_KEYS } from '../../lib/constants.js';
import { normalizeRuntimeMetadata } from './runtime.js';

export function sendMessage(
  sql: SqlStorage,
  resolvedAgentId: string,
  handle: string,
  runtimeOrTool: string | Record<string, unknown> | null | undefined,
  text: string,
  targetAgent: string | null | undefined,
  recordMetric: (metric: string) => void,
): { ok: true; id: string } {
  const runtime = normalizeRuntimeMetadata(runtimeOrTool, resolvedAgentId);
  const id = crypto.randomUUID();
  sql.exec(
    `INSERT INTO messages (id, agent_id, handle, host_tool, agent_surface, target_agent, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    id,
    resolvedAgentId,
    handle || 'unknown',
    runtime.hostTool,
    runtime.agentSurface,
    targetAgent || null,
    text,
  );
  recordMetric(METRIC_KEYS.MESSAGES_SENT);
  return { ok: true, id };
}

export function getMessages(
  sql: SqlStorage,
  resolvedAgentId: string,
  since: string | null | undefined,
): { ok: true; messages: AgentMessage[] } {
  const messages = sql
    .exec(
      `SELECT id, handle, host_tool, agent_surface, target_agent, text, created_at
     FROM messages
     WHERE created_at > COALESCE(?, datetime('now', '-1 hour'))
       AND (target_agent IS NULL OR target_agent = ?)
     ORDER BY created_at DESC
     LIMIT 50`,
      since || null,
      resolvedAgentId,
    )
    .toArray() as unknown as AgentMessage[];

  return { ok: true, messages };
}
