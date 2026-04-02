// Tool evaluation CRUD — manages the tool directory/catalog stored in DatabaseDO.
// Each evaluation records whether a tool is integrated, installable, or listed,
// along with metadata, sources, and confidence level.

/**
 * Upsert a tool evaluation.
 * @param {object} sql - DO SQL handle
 * @param {object} evaluation - Evaluation record
 */
export function saveEvaluation(sql, evaluation) {
  const metadata = typeof evaluation.metadata === 'string' ? evaluation.metadata : JSON.stringify(evaluation.metadata ?? {});
  const sources = typeof evaluation.sources === 'string' ? evaluation.sources : JSON.stringify(evaluation.sources ?? []);
  const blockingIssues = typeof evaluation.blocking_issues === 'string' ? evaluation.blocking_issues : JSON.stringify(evaluation.blocking_issues ?? []);

  sql.exec(
    `INSERT INTO tool_evaluations (id, name, tagline, category, mcp_support, has_cli, hooks_support, channel_support, process_detectable, open_source, verdict, integration_tier, blocking_issues, metadata, sources, in_registry, evaluated_at, confidence, evaluated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
       evaluated_by = excluded.evaluated_by`,
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
    evaluation.evaluated_by ?? null
  );

  return { ok: true };
}

export function getEvaluation(sql, toolId) {
  const rows = sql.exec('SELECT * FROM tool_evaluations WHERE id = ?', toolId).toArray();
  if (rows.length === 0) return { evaluation: null };
  return { evaluation: parseEvaluation(rows[0]) };
}

export function listEvaluations(sql, filters = {}) {
  const conditions = [];
  const params = [];

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

  const rows = sql.exec(
    `SELECT * FROM tool_evaluations ${where} ORDER BY name ASC LIMIT ? OFFSET ?`,
    ...params, limit, offset
  ).toArray();

  return { evaluations: rows.map(r => parseEvaluation(r)) };
}

export function searchEvaluations(sql, query, limit = 20) {
  const pattern = `%${query}%`;
  const rows = sql.exec(
    'SELECT * FROM tool_evaluations WHERE name LIKE ? OR tagline LIKE ? ORDER BY name ASC LIMIT ?',
    pattern, pattern, limit
  ).toArray();

  return { evaluations: rows.map(r => parseEvaluation(r)) };
}

export function deleteEvaluation(sql, toolId) {
  sql.exec('DELETE FROM tool_evaluations WHERE id = ?', toolId);
  const changed = sql.exec('SELECT changes() as c').toArray();
  return { ok: true, deleted: changed[0].c > 0 };
}

export function hasEvaluations(sql) {
  const rows = sql.exec('SELECT COUNT(*) as count FROM tool_evaluations').toArray();
  return { count: rows[0].count };
}

function parseEvaluation(row) {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || '{}'),
    sources: JSON.parse(row.sources || '[]'),
    blocking_issues: JSON.parse(row.blocking_issues || '[]'),
  };
}
