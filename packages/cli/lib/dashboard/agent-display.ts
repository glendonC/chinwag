import { formatFiles } from './view.js';
import type { CombinedAgentRow } from './view.js';

export function isAgentAddressable(agent: CombinedAgentRow | null | undefined): boolean {
  if (!agent?.agent_id) return false;
  if (agent._managed) return agent.status === 'running';
  return agent.status === 'active';
}

export function getAgentTargetLabel(agent: CombinedAgentRow | null | undefined): string {
  if (!agent) return 'agent';
  if (agent.handle && agent._display) return `${agent.handle} (${agent._display})`;
  return agent.handle || agent._display || 'agent';
}

export function getAgentIntent(agent: CombinedAgentRow | null | undefined): string | null {
  if (!agent) return null;
  if (agent._managed && agent._dead && agent.outputPreview) return agent.outputPreview;
  if (agent._summary) return agent._summary;
  const files = formatFiles(agent.activity?.files || []);
  if (files) return files;
  if (agent._managed && agent.task) return agent.task;
  return 'Idle';
}

export function getAgentOriginLabel(agent: CombinedAgentRow | null | undefined): string | null {
  if (!agent) return null;
  if (agent._managed) {
    return agent._connected ? 'started here' : 'starting here';
  }
  return 'joined automatically';
}

export function getAgentDisplayLabel(
  agent: CombinedAgentRow | null | undefined,
  nameCounts?: Map<string, number>,
  allAgents?: CombinedAgentRow[],
): string {
  if (!agent) return 'agent';
  const baseLabel = agent._display || agent.toolName || agent.tool || 'agent';
  if (!allAgents) {
    if ((nameCounts?.get(baseLabel) || 0) <= 1) return baseLabel;
    return baseLabel;
  }
  const sameNameAgents = allAgents.filter(
    (a) => (a._display || a.toolName || a.tool || 'agent') === baseLabel,
  );
  if (sameNameAgents.length <= 1) return baseLabel;
  const agentKey = agent.agent_id || String(agent.id);
  const idx = sameNameAgents.findIndex((a) => (a.agent_id || String(a.id)) === agentKey);
  return idx <= 0 ? baseLabel : `${baseLabel} #${idx + 1}`;
}

export function getIntentColor(intent: string | null | undefined): string {
  if (!intent) return 'gray';
  if (/idle/i.test(intent)) return 'yellow';
  if (/error|failed|blocked|conflict/i.test(intent)) return 'red';
  return 'cyan';
}

export function getAgentMeta(agent: CombinedAgentRow | null | undefined): string | null {
  if (!agent) return null;

  const parts: string[] = [];
  const origin = getAgentOriginLabel(agent);
  if (origin) parts.push(origin);

  const files = formatFiles(agent.activity?.files || []);
  if (files) parts.push(files);

  if (agent.minutes_since_update != null && agent.minutes_since_update > 0) {
    parts.push(`updated ${Math.round(agent.minutes_since_update)}m ago`);
  }

  return parts.join(' \u00b7 ');
}

export function getRecentResultSummary(
  agent: CombinedAgentRow,
  toolState?: { detail?: string } | null,
): string {
  if (agent._failed && toolState?.detail) return toolState.detail;
  if (agent.outputPreview) return agent.outputPreview;
  if (agent.task) return agent.task;
  return agent._failed ? 'Task failed' : 'Task completed';
}
