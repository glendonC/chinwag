// Shared display logic for formatting team context and conflict information.
// Used by both MCP tool handlers and hook handlers to avoid duplication.

import { formatToolTag, formatWho } from './formatting.js';

/**
 * Format conflict and lock check results into human-readable warning lines.
 * @param {Array} conflicts - Conflict objects from team.checkConflicts()
 * @param {Array} lockedFiles - Locked file objects from team.checkConflicts()
 * @returns {string[]} Warning lines (empty array = no conflicts)
 */
export function formatConflictsList(conflicts, lockedFiles) {
  const lines = [];
  if (conflicts?.length > 0) {
    for (const c of conflicts) {
      const who = formatWho(c.owner_handle, c.tool);
      lines.push(`\u26A0 ${who} is working on ${c.files.join(', ')} \u2014 "${c.summary}"`);
    }
  }
  if (lockedFiles?.length > 0) {
    for (const l of lockedFiles) {
      const who = formatWho(l.held_by, l.tool);
      lines.push(`\uD83D\uDD12 ${l.file} is locked by ${who}`);
    }
  }
  return lines;
}

/**
 * Format full team context into a multi-line display string.
 * @param {object} ctx - Team context object from team.getTeamContext()
 * @param {object} [options]
 * @param {boolean} [options.showInsights] - Whether to show stuckness insights (hook uses this)
 * @returns {string[]} Display lines
 */
export function formatTeamContextDisplay(ctx, options = {}) {
  const lines = [];

  if (!ctx.members || ctx.members.length === 0) {
    return lines;
  }

  for (const m of ctx.members) {
    const tool = m.host_tool || m.tool;
    const toolInfo = formatToolTag(tool) ? `, ${tool}` : '';
    const activity = m.activity?.files?.length
      ? `working on ${m.activity.files.join(', ')}${m.activity.summary ? ` \u2014 "${m.activity.summary}"` : ''}`
      : 'idle';
    lines.push(`  ${m.handle} (${m.status}${toolInfo}): ${activity}`);
  }

  if (ctx.locks && ctx.locks.length > 0) {
    lines.push('');
    lines.push('Locked files:');
    for (const l of ctx.locks) {
      const who = formatWho(l.owner_handle, l.tool);
      lines.push(`  ${l.file_path} \u2014 ${who} (${Math.round(l.minutes_held)}m)`);
    }
  }

  if (ctx.memories && ctx.memories.length > 0) {
    lines.push('');
    lines.push('Project knowledge:');
    for (const mem of ctx.memories) {
      const tagStr = mem.tags?.length ? ` [${mem.tags.join(', ')}]` : '';
      lines.push(`  ${mem.text}${tagStr}`);
    }
  }

  if (options.showInsights && ctx.members) {
    const insights = [];
    for (const m of ctx.members) {
      if (m.activity?.updated_at) {
        const mins =
          m.minutes_since_update != null
            ? m.minutes_since_update
            : (Date.now() - new Date(m.activity.updated_at).getTime()) / 60_000;
        if (mins > 15) {
          const stuckFile = m.activity?.files?.length > 0 ? m.activity.files[0] : 'a file';
          insights.push(
            `${m.handle} has been on ${stuckFile} for ${Math.round(mins)} min \u2014 may need help`,
          );
        }
      }
    }
    if (insights.length > 0) {
      lines.push('');
      lines.push('Insights:');
      for (const insight of insights) {
        lines.push(`  ${insight}`);
      }
    }
  }

  return lines;
}
