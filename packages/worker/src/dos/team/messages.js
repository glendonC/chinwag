// Ephemeral agent messages — sendMessage, getMessages.
// Messages auto-expire after 1 hour.
// Each function takes `sql` as the first parameter.

import { normalizeRuntimeMetadata } from './runtime.js';

export function sendMessage(sql, resolvedAgentId, handle, runtimeOrTool, text, targetAgent, recordMetric) {
  const runtime = normalizeRuntimeMetadata(runtimeOrTool, resolvedAgentId);
  const id = crypto.randomUUID();
  sql.exec(
    `INSERT INTO messages (id, from_agent, from_handle, from_tool, from_host_tool, from_agent_surface, target_agent, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    id, resolvedAgentId, handle || 'unknown', runtime.tool, runtime.hostTool, runtime.agentSurface, targetAgent || null, text
  );
  recordMetric('messages_sent');
  return { ok: true, id };
}

export function getMessages(sql, resolvedAgentId, since) {
  const messages = sql.exec(
    `SELECT id, from_handle, from_tool, from_host_tool, from_agent_surface, target_agent, text, created_at
     FROM messages
     WHERE created_at > COALESCE(?, datetime('now', '-1 hour'))
       AND (target_agent IS NULL OR target_agent = ?)
     ORDER BY created_at DESC
     LIMIT 50`,
    since || null, resolvedAgentId
  ).toArray();

  return { messages };
}
