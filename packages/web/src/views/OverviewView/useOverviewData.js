import { useMemo } from 'react';
import { buildHostJoinShare, buildSurfaceJoinShare } from '../../lib/toolAnalytics.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { arcPath, CX, CY, R, SW, GAP, DEG } from '../../lib/svgArcs.js';

export { arcPath, CX, CY, R, SW, GAP, DEG };

export function useOverviewData(summaries) {
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

  const toolUsage = useMemo(() => {
    const totals = new Map();
    for (const team of summaries)
      for (const { host_tool, joins } of team.hosts_configured || [])
        if (getToolMeta(host_tool).icon)
          totals.set(host_tool, (totals.get(host_tool) || 0) + joins);
    const entries = [...totals.entries()]
      .map(([tool, joins]) => ({ tool, joins }))
      .sort((a, b) => b.joins - a.joins);
    const total = entries.reduce((s, e) => s + e.joins, 0);
    return entries.map((e) => ({ ...e, share: total > 0 ? e.joins / total : 0 }));
  }, [summaries]);

  const uniqueTools = toolUsage.length;

  const arcs = useMemo(() => {
    if (!toolUsage.length) return [];
    const totalGap = GAP * toolUsage.length,
      available = 360 - totalGap;
    let offset = 0;
    return toolUsage.map((entry) => {
      const sweep = Math.max(entry.share * available, 4);
      const midDeg = (offset + sweep / 2 - 90) * DEG;
      const labelR = R + SW / 2 + 22;
      const anchorR = R + SW / 2 + 5;
      const arc = {
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

  const agentRows = useMemo(() => {
    const rows = [];
    for (const team of summaries)
      for (const t of (team.hosts_configured || []).filter(
        (t) => getToolMeta(t.host_tool).icon && t.joins > 0,
      ))
        rows.push({
          tool: t.host_tool,
          teamName: team.team_name || team.team_id,
          teamId: team.team_id,
          joins: t.joins,
        });
    return rows.sort((a, b) => b.joins - a.joins);
  }, [summaries]);

  return {
    totalActive,
    totalMemories,
    hostShare,
    surfaceShare,
    toolUsage,
    uniqueTools,
    arcs,
    agentRows,
  };
}
