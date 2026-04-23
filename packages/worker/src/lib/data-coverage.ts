// Data coverage: which tools in the active window support which analytics
// capabilities. Consumed by both the cross-team user route and the team DO's
// extended analytics — living as a shared lib keeps one source of truth for
// the shape the client expects under `UserAnalytics.data_coverage`.

import { getToolsWithCapability } from '@chinmeister/shared/tool-registry.js';

export interface DataCoverage {
  tools_reporting: string[];
  tools_without_data: string[];
  coverage_rate: number;
  capabilities_available: string[];
  capabilities_missing: string[];
}

/**
 * Compute the data_coverage slice from the set of tools active in the window.
 * "Active" means at least one session was observed under that host_tool; the
 * caller decides how to assemble the set (DO SQL scan, cross-team union, …).
 *
 * `tools_reporting` is the subset of active tools that can contribute
 * deep-capture data (token usage or conversation logs). The inverse,
 * `tools_without_data`, is everyone else — used by coverage notes so the UI
 * can attribute partial totals to the reporting subset.
 */
export function buildDataCoverage(activeToolsSet: Set<string>): DataCoverage {
  const allTools = [...activeToolsSet];
  const capConversation = new Set(getToolsWithCapability('conversationLogs'));
  const capTokens = new Set(getToolsWithCapability('tokenUsage'));
  const reporting = allTools.filter((t) => capConversation.has(t) || capTokens.has(t));
  const withoutData = allTools.filter((t) => !capConversation.has(t) && !capTokens.has(t));
  const capsAvailable: string[] = [];
  const capsMissing: string[] = [];
  if (allTools.some((t) => capConversation.has(t))) capsAvailable.push('conversationLogs');
  else if (allTools.length > 0) capsMissing.push('conversationLogs');
  if (allTools.some((t) => capTokens.has(t))) capsAvailable.push('tokenUsage');
  else if (allTools.length > 0) capsMissing.push('tokenUsage');
  return {
    tools_reporting: reporting,
    tools_without_data: withoutData,
    coverage_rate:
      allTools.length > 0 ? Math.round((reporting.length / allTools.length) * 100) / 100 : 0,
    capabilities_available: capsAvailable,
    capabilities_missing: capsMissing,
  };
}

/**
 * Standard active-tools query for a DO's session table over a day window.
 * Separated so both team DOs and any future scope can reuse the exact same
 * "what host_tools ran a session here" definition. Empty and 'unknown' are
 * filtered — those are sentinel values for sessions we couldn't attribute.
 */
export function queryActiveTools(sql: SqlStorage, days: number): Set<string> {
  const rows = sql
    .exec(
      `SELECT DISTINCT host_tool FROM sessions
       WHERE started_at > datetime('now', '-' || ? || ' days')
         AND host_tool IS NOT NULL
         AND host_tool != ''
         AND host_tool != 'unknown'`,
      days,
    )
    .toArray();
  return new Set(rows.map((r) => (r as { host_tool: string }).host_tool));
}
