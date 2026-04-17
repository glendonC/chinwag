// Tool suggestion queue -- users submit a tool name/URL/note; admins approve
// or reject. Approved suggestions are promoted to tool_evaluations via the
// evaluations module; rejections keep the row with a reason for audit.
//
// Each function takes `sql` as the first parameter.

import type { DOResult } from '../../types.js';

export interface SuggestionInput {
  name: string;
  url?: string | null;
  note?: string | null;
}

export function saveSuggestion(
  sql: SqlStorage,
  suggestion: SuggestionInput,
  userId: string,
  userHandle: string,
): DOResult<{ ok: true; suggestion_id: string }> {
  const name = suggestion.name.trim();

  // Duplicate check against existing tool evaluations (case-insensitive)
  const existingTool = sql
    .exec('SELECT 1 FROM tool_evaluations WHERE LOWER(name) = LOWER(?)', name)
    .toArray();
  if (existingTool.length > 0) {
    return { error: 'This tool already exists in the directory', code: 'CONFLICT' };
  }

  // Duplicate check against pending suggestions (case-insensitive)
  const existingSuggestion = sql
    .exec(
      "SELECT 1 FROM tool_suggestions WHERE LOWER(name) = LOWER(?) AND status = 'pending'",
      name,
    )
    .toArray();
  if (existingSuggestion.length > 0) {
    return {
      error: 'This tool has already been suggested and is pending review',
      code: 'CONFLICT',
    };
  }

  const id = crypto.randomUUID();
  sql.exec(
    `INSERT INTO tool_suggestions (id, name, url, note, suggested_by, suggested_by_handle)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    name,
    suggestion.url || null,
    suggestion.note || null,
    userId,
    userHandle,
  );

  return { ok: true, suggestion_id: id };
}

export function listSuggestions(
  sql: SqlStorage,
  status = 'pending',
  limit = 50,
): { ok: true; suggestions: Record<string, unknown>[]; total: number } {
  const suggestions = sql
    .exec(
      `SELECT id, name, url, note, suggested_by_handle, status, reject_reason, reviewed_at, created_at
       FROM tool_suggestions WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
      status,
      limit,
    )
    .toArray() as unknown as Record<string, unknown>[];

  const totalRows = sql
    .exec('SELECT COUNT(*) as count FROM tool_suggestions WHERE status = ?', status)
    .toArray();
  const total = ((totalRows[0] as Record<string, unknown>)?.count as number) || 0;

  return { ok: true, suggestions, total };
}

export function reviewSuggestion(
  sql: SqlStorage,
  id: string,
  action: 'approve' | 'reject',
  rejectReason?: string | null,
): DOResult<{ ok: true }> {
  const rows = sql.exec('SELECT status FROM tool_suggestions WHERE id = ?', id).toArray();
  if (rows.length === 0) {
    return { error: 'Suggestion not found', code: 'NOT_FOUND' };
  }
  if ((rows[0] as Record<string, unknown>).status !== 'pending') {
    return { error: 'Suggestion has already been reviewed', code: 'CONFLICT' };
  }

  const status = action === 'approve' ? 'approved' : 'rejected';
  sql.exec(
    `UPDATE tool_suggestions SET status = ?, reject_reason = ?, reviewed_at = datetime('now') WHERE id = ?`,
    status,
    action === 'reject' ? rejectReason || null : null,
    id,
  );

  return { ok: true };
}
