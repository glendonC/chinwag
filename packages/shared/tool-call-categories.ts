/**
 * Tool-call category classifier — the single source of truth.
 *
 * Classifies an internal tool (e.g. Claude Code's Read/Edit/Bash) into
 * one of five behavior categories. Used by both the worker (to compute
 * research-to-edit ratio in SQL) and the web (to color and group tool
 * calls in drill-in visualizations).
 *
 * Adding a new tool → add it to TOOL_CALL_CATEGORIES.
 * Changing the ratio definition → update RESEARCH_TOOLS / EDIT_TOOLS.
 *
 * Keep this file dependency-free. It's imported by Cloudflare Workers
 * and a browser bundle both.
 */

export type ToolCallCategory = 'research' | 'edit' | 'exec' | 'memory' | 'other';

/**
 * Canonical classification of every tool we've seen from Claude Code
 * and MCP servers. Any tool name *not* in this map classifies as 'other'.
 *
 * Tool names are case-sensitive and must match exactly what the agent
 * emits (e.g. Claude Code emits 'Read', not 'read').
 */
export const TOOL_CALL_CATEGORIES: Record<string, ToolCallCategory> = {
  // ── Research ──────────────────────────────────────
  Read: 'research',
  Grep: 'research',
  Glob: 'research',
  WebSearch: 'research',
  WebFetch: 'research',
  Agent: 'research',
  Task: 'research',
  ToolSearch: 'research',

  // ── Edit ──────────────────────────────────────────
  Edit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',

  // ── Exec (side-effectful shell / process operations) ──
  Bash: 'exec',
  BashOutput: 'exec',
  KillShell: 'exec',

  // ── Memory (chinmeister's MCP namespace) ──────────────
  chinmeister_save_memory: 'memory',
  chinmeister_search_memory: 'memory',
  chinmeister_update_memory: 'memory',
  chinmeister_delete_memory: 'memory',
  chinmeister_delete_memories_batch: 'memory',
};

/**
 * Tools that count toward the "research" side of research-to-edit ratio.
 * Kept as a sorted array so the worker can splat it into a SQL IN clause
 * deterministically (query cache-friendly).
 */
export const RESEARCH_TOOLS: readonly string[] = Object.freeze(
  Object.entries(TOOL_CALL_CATEGORIES)
    .filter(([, cat]) => cat === 'research')
    .map(([name]) => name)
    .sort(),
);

/**
 * Tools that count toward the "edit" side of research-to-edit ratio.
 */
export const EDIT_TOOLS: readonly string[] = Object.freeze(
  Object.entries(TOOL_CALL_CATEGORIES)
    .filter(([, cat]) => cat === 'edit')
    .map(([name]) => name)
    .sort(),
);

/**
 * Classify a single tool name into its category. Unknown tools return 'other'.
 *
 * Safe for high-volume call sites (no allocations, no regex).
 */
export function classifyToolCall(toolName: string | null | undefined): ToolCallCategory {
  if (!toolName) return 'other';
  return TOOL_CALL_CATEGORIES[toolName] ?? 'other';
}

/**
 * SQL IN-list helper for the worker. Produces a quoted, comma-joined
 * literal list usable inside a `WHERE tool IN (...)` clause. The list
 * is deterministic and safe to interpolate directly — tool names in
 * RESEARCH_TOOLS/EDIT_TOOLS are static constants, not user input.
 *
 * Example: sqlInList(RESEARCH_TOOLS) → "'Agent', 'Glob', 'Grep', ..."
 */
export function sqlInList(tools: readonly string[]): string {
  return tools.map((t) => `'${t}'`).join(', ');
}
