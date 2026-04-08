// Tool evaluation CRUD -- manages the tool directory/catalog stored in DatabaseDO.
// Each evaluation records whether a tool is integrated, installable, or listed,
// along with metadata, sources, and confidence level.

import { sqlChanges } from '../../lib/validation.js';

interface EvaluationInput {
  id: string;
  name: string;
  tagline?: string | null;
  category?: string | null;
  mcp_support?: number | null;
  has_cli?: number | null;
  hooks_support?: number | null;
  channel_support?: number | null;
  process_detectable?: number | null;
  open_source?: number | null;
  verdict: string;
  integration_tier?: string | null;
  blocking_issues?: string | string[] | null;
  metadata?: string | Record<string, unknown>;
  sources?: string | unknown[];
  in_registry?: number;
  evaluated_at: string;
  confidence?: string;
  evaluated_by?: string | null;
  data_passes?: string | Record<string, unknown>;
}

interface ParsedEvaluation {
  id: string;
  name: string;
  tagline: string | null;
  category: string | null;
  mcp_support: number | null;
  has_cli: number | null;
  hooks_support: number | null;
  channel_support: number | null;
  process_detectable: number | null;
  open_source: number | null;
  verdict: string;
  integration_tier: string | null;
  blocking_issues: unknown[];
  metadata: Record<string, unknown>;
  sources: unknown[];
  in_registry: number;
  evaluated_at: string;
  confidence: string;
  evaluated_by: string | null;
  data_passes: Record<string, unknown>;
}

/** Upsert a tool evaluation. */
export function saveEvaluation(sql: SqlStorage, evaluation: EvaluationInput): { ok: true } {
  const metadata =
    typeof evaluation.metadata === 'string'
      ? evaluation.metadata
      : JSON.stringify(evaluation.metadata ?? {});
  const sources =
    typeof evaluation.sources === 'string'
      ? evaluation.sources
      : JSON.stringify(evaluation.sources ?? []);
  const blockingIssues =
    typeof evaluation.blocking_issues === 'string'
      ? evaluation.blocking_issues
      : JSON.stringify(evaluation.blocking_issues ?? []);
  const dataPasses =
    typeof evaluation.data_passes === 'string'
      ? evaluation.data_passes
      : JSON.stringify(evaluation.data_passes ?? {});

  sql.exec(
    `INSERT INTO tool_evaluations (id, name, tagline, category, mcp_support, has_cli, hooks_support, channel_support, process_detectable, open_source, verdict, integration_tier, blocking_issues, metadata, sources, in_registry, evaluated_at, confidence, evaluated_by, data_passes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       tagline = excluded.tagline,
       category = excluded.category,
       mcp_support = excluded.mcp_support,
       has_cli = excluded.has_cli,
       hooks_support = excluded.hooks_support,
       channel_support = excluded.channel_support,
       process_detectable = excluded.process_detectable,
       open_source = excluded.open_source,
       verdict = excluded.verdict,
       integration_tier = excluded.integration_tier,
       blocking_issues = excluded.blocking_issues,
       metadata = excluded.metadata,
       sources = excluded.sources,
       in_registry = excluded.in_registry,
       evaluated_at = excluded.evaluated_at,
       confidence = excluded.confidence,
       evaluated_by = excluded.evaluated_by,
       data_passes = excluded.data_passes`,
    evaluation.id,
    evaluation.name,
    evaluation.tagline ?? null,
    evaluation.category ?? null,
    evaluation.mcp_support ?? null,
    evaluation.has_cli ?? null,
    evaluation.hooks_support ?? null,
    evaluation.channel_support ?? null,
    evaluation.process_detectable ?? null,
    evaluation.open_source ?? null,
    evaluation.verdict,
    evaluation.integration_tier ?? null,
    blockingIssues,
    metadata,
    sources,
    evaluation.in_registry ?? 0,
    evaluation.evaluated_at,
    evaluation.confidence ?? 'medium',
    evaluation.evaluated_by ?? null,
    dataPasses,
  );

  return { ok: true };
}

export function getEvaluation(
  sql: SqlStorage,
  toolId: string,
): { ok: true; evaluation: ParsedEvaluation | null } {
  const rows = sql.exec('SELECT * FROM tool_evaluations WHERE id = ?', toolId).toArray();
  if (rows.length === 0) return { ok: true, evaluation: null };
  return { ok: true, evaluation: parseEvaluation(rows[0] as Record<string, unknown>) };
}

interface ListFilters {
  verdict?: string | null;
  category?: string | null;
  mcp_support?: number | null;
  in_registry?: number | null;
  limit?: number;
  offset?: number;
}

export function listEvaluations(
  sql: SqlStorage,
  filters: ListFilters = {},
): { ok: true; evaluations: ParsedEvaluation[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.verdict != null) {
    conditions.push('verdict = ?');
    params.push(filters.verdict);
  }
  if (filters.category != null) {
    conditions.push('category = ?');
    params.push(filters.category);
  }
  if (filters.mcp_support != null) {
    conditions.push('mcp_support = ?');
    params.push(filters.mcp_support);
  }
  if (filters.in_registry != null) {
    conditions.push('in_registry = ?');
    params.push(filters.in_registry);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(filters.limit || 100, 200);
  const offset = filters.offset || 0;

  const rows = sql
    .exec(
      `SELECT * FROM tool_evaluations ${where} ORDER BY name ASC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    )
    .toArray();

  return { ok: true, evaluations: rows.map((r) => parseEvaluation(r as Record<string, unknown>)) };
}

export function searchEvaluations(
  sql: SqlStorage,
  query: string,
  limit = 20,
): { ok: true; evaluations: ParsedEvaluation[] } {
  const pattern = `%${query}%`;
  const rows = sql
    .exec(
      'SELECT * FROM tool_evaluations WHERE name LIKE ? OR tagline LIKE ? ORDER BY name ASC LIMIT ?',
      pattern,
      pattern,
      limit,
    )
    .toArray();

  return { ok: true, evaluations: rows.map((r) => parseEvaluation(r as Record<string, unknown>)) };
}

export function deleteEvaluation(sql: SqlStorage, toolId: string): { ok: true; deleted: boolean } {
  sql.exec('DELETE FROM tool_evaluations WHERE id = ?', toolId);
  return { ok: true, deleted: sqlChanges(sql) > 0 };
}

export function hasEvaluations(sql: SqlStorage): { ok: true; count: number } {
  const rows = sql.exec('SELECT COUNT(*) as count FROM tool_evaluations').toArray();
  return { ok: true, count: (rows[0] as { count: number }).count };
}

function parseEvaluation(row: Record<string, unknown>): ParsedEvaluation {
  return {
    ...row,
    metadata: JSON.parse((row.metadata as string) || '{}'),
    sources: JSON.parse((row.sources as string) || '[]'),
    blocking_issues: JSON.parse((row.blocking_issues as string) || '[]'),
    data_passes: JSON.parse((row.data_passes as string) || '{}'),
  } as ParsedEvaluation;
}
