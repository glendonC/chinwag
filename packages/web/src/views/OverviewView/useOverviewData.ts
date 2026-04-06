import { useMemo } from 'react';
import {
  buildHostJoinShare,
  buildSurfaceJoinShare,
  type JoinShareEntry,
} from '../../lib/toolAnalytics.js';
import { isKnownTool } from '../../lib/toolMeta.js';
import { arcPath, CX, CY, R, SW, GAP, DEG } from '../../lib/svgArcs.js';

export { arcPath, CX, CY, R, SW, GAP, DEG };

interface TeamSummary {
  team_id?: string;
  team_name?: string;
  active_agents?: number;
  memory_count?: number;
  active_members?: Array<{
    agent_id: string;
    handle: string;
    host_tool: string;
    agent_surface: string | null;
    files: string[];
    summary: string | null;
    session_minutes: number | null;
  }>;
  hosts_configured?: Array<{ host_tool?: string; joins: number }>;
  [key: string]: unknown;
}

interface ToolUsageEntry {
  tool: string;
  joins: number;
  share: number;
}

export interface ArcEntry extends ToolUsageEntry {
  startDeg: number;
  sweepDeg: number;
  labelX: number;
  labelY: number;
  anchorX: number;
  anchorY: number;
  side: 'left' | 'right';
}

export interface LiveAgent {
  agent_id: string;
  handle: string;
  host_tool: string;
  agent_surface: string | null;
  files: string[];
  summary: string | null;
  session_minutes: number | null;
  teamName: string;
  teamId: string;
}

interface UseOverviewDataReturn {
  totalActive: number;
  totalMemories: number;
  hostShare: JoinShareEntry[];
  surfaceShare: JoinShareEntry[];
  toolUsage: ToolUsageEntry[];
  uniqueTools: number;
  arcs: ArcEntry[];
  liveAgents: LiveAgent[];
}

export function useOverviewData(summaries: TeamSummary[]): UseOverviewDataReturn {
  const totalActive = useMemo(
    () => summaries.reduce((s, t) => s + (t.active_agents || 0), 0),
    [summaries],
  );
  const totalMemories = useMemo(
    () => summaries.reduce((s, t) => s + (t.memory_count || 0), 0),
    [summaries],
  );
  const hostShare = useMemo(() => buildHostJoinShare(summaries), [summaries]);
  const surfaceShare = useMemo(() => buildSurfaceJoinShare(summaries), [summaries]);

  // Ring chart: only known tools (no "unknown", "daemon", etc.)
  const toolUsage = useMemo((): ToolUsageEntry[] => {
    const totals = new Map<string, number>();
    for (const team of summaries)
      for (const { host_tool, joins } of team.hosts_configured || []) {
        if (!host_tool || !isKnownTool(host_tool)) continue;
        totals.set(host_tool, (totals.get(host_tool) || 0) + joins);
      }
    const entries = [...totals.entries()]
      .map(([tool, joins]) => ({ tool, joins }))
      .sort((a, b) => b.joins - a.joins);
    const total = entries.reduce((s, e) => s + e.joins, 0);
    return entries.map((e) => ({ ...e, share: total > 0 ? e.joins / total : 0 }));
  }, [summaries]);

  // Stat count: all unique tool identifiers (including unidentified)
  const uniqueTools = useMemo(() => {
    const all = new Set<string>();
    for (const team of summaries)
      for (const { host_tool } of team.hosts_configured || []) {
        if (host_tool) all.add(host_tool);
      }
    return all.size;
  }, [summaries]);

  const arcs = useMemo((): ArcEntry[] => {
    if (!toolUsage.length) return [];
    const totalGap = GAP * toolUsage.length,
      available = 360 - totalGap;
    let offset = 0;
    return toolUsage.map((entry) => {
      const sweep = Math.max(entry.share * available, 4);
      const midDeg = (offset + sweep / 2 - 90) * DEG;
      const labelR = R + SW / 2 + 22;
      const anchorR = R + SW / 2 + 5;
      const arc: ArcEntry = {
        ...entry,
        startDeg: offset,
        sweepDeg: sweep,
        labelX: CX + labelR * Math.cos(midDeg),
        labelY: CY + labelR * Math.sin(midDeg),
        anchorX: CX + anchorR * Math.cos(midDeg),
        anchorY: CY + anchorR * Math.sin(midDeg),
        side: Math.cos(midDeg) >= 0 ? 'right' : 'left',
      };
      offset += sweep + GAP;
      return arc;
    });
  }, [toolUsage]);

  // Live agents from active_members — real member data, not telemetry aggregates
  const liveAgents = useMemo((): LiveAgent[] => {
    const agents: LiveAgent[] = [];
    for (const team of summaries) {
      const teamName = team.team_name || team.team_id || '';
      const teamId = team.team_id || '';
      for (const member of team.active_members || []) {
        agents.push({
          ...member,
          teamName,
          teamId,
        });
      }
    }
    return agents;
  }, [summaries]);

  return {
    totalActive,
    totalMemories,
    hostShare,
    surfaceShare,
    toolUsage,
    uniqueTools,
    arcs,
    liveAgents,
  };
}
