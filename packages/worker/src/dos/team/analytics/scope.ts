// Analytics scope: the canonical filter object every analytics query accepts.
//
// Why this exists. Pre-scope, every query function in this directory was
// implicitly team-wide — `SELECT ... FROM sessions WHERE ...` returned data
// for every member of the team, regardless of which user asked. That broke
// STRATEGY.md's "developer-level data is private by default" direction the
// moment a second teammate joined: dev A could pull dev B's sentiment
// distribution, completion rate, edit count, etc.
//
// Closing the leak by threading `handle` through every function would have
// worked but locks the codebase into a one-axis filter. Future filters
// (host tool, project, date-bucket overrides) would each need another
// parameter, and every new query function added under analytics/ would
// have to remember to thread them. That's the recipe for the same bug
// returning under a different name.
//
// AnalyticsScope is the additive alternative. Every query takes a scope,
// builds its WHERE fragment from `buildScopeFilter`, and splices the
// fragment plus its params into its existing SQL. New filter axes become
// new optional fields on the type, never new parameters.
//
// Default contract: an empty scope (`{}`) returns team-wide aggregates —
// preserves existing semantics for the few endpoints that intentionally
// expose cross-user data (project view summaries, lead-style aggregates
// once team-tier ships). Routes that should be developer-scoped pass
// `{ handle: user.handle }` explicitly.

export interface AnalyticsScope {
  /**
   * When set, restrict the query to rows authored by this handle. Tables
   * carry `handle` directly (sessions, edits, memories, conversations,
   * tool_calls, commits, members, messages) so this is a simple equality
   * filter, not a join.
   *
   * Pass the *acting user's handle* for personal/dev-scoped views (the
   * /me/analytics route, /me/dashboard summaries). Leave empty for
   * intentional team-wide aggregates.
   */
  handle?: string;
}

/**
 * Where in a query the scope fragment should land. Most tables expose
 * `handle` directly; queries with multiple aliased tables need to disambiguate
 * (e.g., `s.handle` from sessions vs `m.handle` from members).
 */
export interface ScopeOptions {
  /**
   * Column reference for the handle filter, including any table alias.
   * Defaults to `handle` (no alias). Pass `s.handle`, `m.handle`, etc. when
   * the query has joined tables.
   */
  handleColumn?: string;
}

export interface ScopeFragment {
  /**
   * SQL fragment to splice into a WHERE clause. Always begins with a leading
   * space and `AND`, so the caller can append it after their existing
   * WHERE-clause tail without worrying about delimiter handling. Empty
   * string when no scope filters apply.
   */
  sql: string;
  /** Param values to spread into the parameter list, in fragment order. */
  params: unknown[];
}

/**
 * Build the SQL fragment + params for a scope. Always returns a fragment
 * starting with ` AND ...` (leading space) so call sites can do:
 *
 *   const scopeFilter = buildScopeFilter(scope);
 *   const rows = sql.exec(
 *     `SELECT ... FROM sessions WHERE ended_at IS NOT NULL${scopeFilter.sql}`,
 *     ...existingParams,
 *     ...scopeFilter.params,
 *   );
 *
 * Returning `{ sql: '', params: [] }` for an empty scope keeps the SQL
 * unchanged and avoids forcing every call site to branch.
 */
export function buildScopeFilter(
  scope: AnalyticsScope = {},
  options: ScopeOptions = {},
): ScopeFragment {
  const fragments: string[] = [];
  const params: unknown[] = [];

  if (scope.handle) {
    const col = options.handleColumn ?? 'handle';
    fragments.push(`${col} = ?`);
    params.push(scope.handle);
  }

  if (fragments.length === 0) return { sql: '', params: [] };
  return { sql: ` AND ${fragments.join(' AND ')}`, params };
}

/**
 * Convenience for queries that build their WHERE clause from scratch (no
 * existing AND chain to append to). Returns ` WHERE ...` when filters
 * apply, empty string otherwise.
 */
export function buildScopeWhere(
  scope: AnalyticsScope = {},
  options: ScopeOptions = {},
): ScopeFragment {
  const fragment = buildScopeFilter(scope, options);
  if (!fragment.sql) return { sql: '', params: [] };
  // Strip the leading ' AND ' and replace with ' WHERE '.
  return { sql: fragment.sql.replace(/^ AND /, ' WHERE '), params: fragment.params };
}

/**
 * Type guard for scoped vs unscoped — useful when a function wants to
 * skip an entire correlation step (e.g., team-wide cohort analysis) when
 * called with a personal scope.
 */
export function isScoped(scope: AnalyticsScope): boolean {
  return Boolean(scope.handle);
}
