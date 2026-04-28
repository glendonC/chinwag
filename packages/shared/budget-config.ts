// Per-session context budget controls.
//
// Agents call MCP tools during a session, and every call returns text that
// lands in the agent's context window. Memory searches can return thousands
// of chars; activity broadcasts add coordination traffic. Power users on a
// tight context budget (compaction imminent, small model, focused task) want
// to throttle this. Teams may also want defaults that match their workflow.
//
// Precedence, strongest wins:
//   runtime override  (MCP tool call this session)
//   user override     (~/.chinmeister/config.json "budgets")
//   team default      (.chinmeister "budgets")
//   hardcoded default (below)
//
// The resolver is a pure function so it's trivially unit-testable and callable
// from either the CLI or the MCP server.

import { MEMORY_SEARCH_DEFAULT_LIMIT, MEMORY_SEARCH_MAX_LIMIT } from './constants.js';

export type CoordinationBroadcast = 'full' | 'silent';

export interface BudgetConfig {
  /** Max memories returned per search. Capped at MEMORY_SEARCH_MAX_LIMIT. */
  memoryResultCap: number;
  /**
   * Max chars per memory body in search responses. 0 means unlimited.
   * Tag list and metadata are never truncated.
   */
  memoryContentTruncation: number;
  /**
   * Whether activity updates are broadcast to teammates.
   * 'silent' skips the backend call entirely - the agent's local state still
   * reflects its work, but teammates see no file or summary update.
   */
  coordinationBroadcast: CoordinationBroadcast;
}

export const BUDGET_DEFAULTS: Readonly<BudgetConfig> = Object.freeze({
  memoryResultCap: MEMORY_SEARCH_DEFAULT_LIMIT,
  memoryContentTruncation: 500,
  coordinationBroadcast: 'full',
});

function isBroadcastMode(value: unknown): value is CoordinationBroadcast {
  return value === 'full' || value === 'silent';
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Parse an unknown value (e.g. parsed JSON) into a partial BudgetConfig.
 * Unknown or ill-typed fields are dropped silently - a malformed config
 * should never block the agent from running.
 *
 * Returns null when the input is not an object.
 */
export function parseBudgetConfig(value: unknown): Partial<BudgetConfig> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const result: Partial<BudgetConfig> = {};

  if (isNonNegativeFiniteNumber(obj.memoryResultCap)) {
    // Clamp to max - a team config requesting 1000 shouldn't exceed the hard cap.
    result.memoryResultCap = Math.min(Math.floor(obj.memoryResultCap), MEMORY_SEARCH_MAX_LIMIT);
  }
  if (isNonNegativeFiniteNumber(obj.memoryContentTruncation)) {
    result.memoryContentTruncation = Math.floor(obj.memoryContentTruncation);
  }
  if (isBroadcastMode(obj.coordinationBroadcast)) {
    result.coordinationBroadcast = obj.coordinationBroadcast;
  }

  return result;
}

/**
 * Resolve a concrete BudgetConfig from the four layers.
 *
 * Any layer may be null/undefined. Partial overrides are merged field-by-field,
 * so a user overriding only `memoryResultCap` keeps the team's other settings.
 */
export function resolveBudgets(layers: {
  team?: Partial<BudgetConfig> | null;
  user?: Partial<BudgetConfig> | null;
  runtime?: Partial<BudgetConfig> | null;
}): BudgetConfig {
  return {
    ...BUDGET_DEFAULTS,
    ...(layers.team || {}),
    ...(layers.user || {}),
    ...(layers.runtime || {}),
  };
}

/**
 * Truncate memory body text per the configured budget.
 * Returns the input unchanged when truncation is 0 (unlimited) or the text
 * already fits. Adds a single ellipsis character on truncation so the agent
 * can see the cut is synthetic.
 */
export function truncateMemoryText(text: string, truncation: number): string {
  if (truncation <= 0) return text;
  if (text.length <= truncation) return text;
  return text.slice(0, truncation) + '\u2026';
}
