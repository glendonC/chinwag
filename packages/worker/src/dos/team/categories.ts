// Memory categories - per-project classification for memories.
// Categories are admin-defined; agents assign them on save via MCP enum.
// Each category stores a precomputed embedding for future semantic validation.

import type { DOResult, MemoryCategory } from '../../types.js';
import { MEMORY_CATEGORY_MAX_COUNT } from '../../lib/constants.js';
import { row, rows as mapRows } from '../../lib/row.js';
import { sqlChanges } from '../../lib/validation.js';

export interface CategoryWithEmbedding extends MemoryCategory {
  embedding: ArrayBuffer | null;
}

export function createCategory(
  sql: SqlStorage,
  name: string,
  description: string,
  color: string | null,
  embedding: ArrayBuffer | null,
): DOResult<{ ok: true; id: string }> {
  // Check capacity
  const countRow = sql.exec('SELECT COUNT(*) as cnt FROM memory_categories').one();
  if (row(countRow).number('cnt') >= MEMORY_CATEGORY_MAX_COUNT) {
    return {
      error: `Maximum ${MEMORY_CATEGORY_MAX_COUNT} categories per project`,
      code: 'VALIDATION',
    };
  }

  // Check uniqueness (case-insensitive)
  const existing = sql
    .exec('SELECT id FROM memory_categories WHERE LOWER(name) = LOWER(?)', name)
    .toArray();
  if (existing.length > 0) {
    return { error: `Category "${name}" already exists`, code: 'CONFLICT' };
  }

  const id = crypto.randomUUID();
  sql.exec(
    `INSERT INTO memory_categories (id, name, description, color, embedding, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    id,
    name.trim(),
    description.trim(),
    color,
    embedding,
  );

  return { ok: true, id };
}

export function listCategories(sql: SqlStorage): { ok: true; categories: MemoryCategory[] } {
  const rows = sql
    .exec(
      `SELECT id, name, description, color, created_at
       FROM memory_categories ORDER BY name ASC`,
    )
    .toArray();

  return {
    ok: true,
    categories: mapRows<MemoryCategory>(rows, (r) => ({
      id: r.string('id'),
      name: r.string('name'),
      description: r.string('description'),
      color: r.nullableString('color'),
      created_at: r.string('created_at'),
    })),
  };
}

/** List categories with embeddings (for internal use - semantic matching). */
export function listCategoriesWithEmbeddings(sql: SqlStorage): {
  ok: true;
  categories: CategoryWithEmbedding[];
} {
  const rows = sql
    .exec(
      `SELECT id, name, description, color, embedding, created_at
       FROM memory_categories ORDER BY name ASC`,
    )
    .toArray();

  return {
    ok: true,
    categories: mapRows<CategoryWithEmbedding>(rows, (r) => {
      const embedding = r.raw('embedding');
      return {
        id: r.string('id'),
        name: r.string('name'),
        description: r.string('description'),
        color: r.nullableString('color'),
        created_at: r.string('created_at'),
        embedding: embedding instanceof ArrayBuffer ? embedding : null,
      };
    }),
  };
}

export function updateCategory(
  sql: SqlStorage,
  categoryId: string,
  name: string | undefined,
  description: string | undefined,
  color: string | undefined,
  embedding: ArrayBuffer | null | undefined,
): DOResult<{ ok: true }> {
  const existing = sql.exec('SELECT id FROM memory_categories WHERE id = ?', categoryId).toArray();
  if (existing.length === 0) return { error: 'Category not found', code: 'NOT_FOUND' };

  // Check name uniqueness if changing name
  if (name !== undefined) {
    const conflict = sql
      .exec(
        'SELECT id FROM memory_categories WHERE LOWER(name) = LOWER(?) AND id != ?',
        name,
        categoryId,
      )
      .toArray();
    if (conflict.length > 0) {
      return { error: `Category "${name}" already exists`, code: 'CONFLICT' };
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (name !== undefined) {
    sets.push('name = ?');
    params.push(name.trim());
  }
  if (description !== undefined) {
    sets.push('description = ?');
    params.push(description.trim());
  }
  if (color !== undefined) {
    sets.push('color = ?');
    params.push(color);
  }
  if (embedding !== undefined) {
    sets.push('embedding = ?');
    params.push(embedding);
  }
  if (sets.length === 0) return { ok: true };

  params.push(categoryId);
  sql.exec(`UPDATE memory_categories SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return { ok: true };
}

export function deleteCategory(sql: SqlStorage, categoryId: string): DOResult<{ ok: true }> {
  sql.exec('DELETE FROM memory_categories WHERE id = ?', categoryId);
  if (sqlChanges(sql) === 0) return { error: 'Category not found', code: 'NOT_FOUND' };
  return { ok: true };
}

/** Get category names as a simple list (for MCP tool enum injection). */
export function getCategoryNames(sql: SqlStorage): string[] {
  const rows = sql.exec('SELECT name FROM memory_categories ORDER BY name ASC').toArray();
  return mapRows(rows, (r) => r.string('name'));
}

/** Increment tag usage stats (called on memory save). */
export function recordTagUsage(sql: SqlStorage, tags: string[]): void {
  for (const tag of tags) {
    sql.exec(
      `INSERT INTO tag_stats (tag, use_count, first_seen, last_seen)
       VALUES (?, 1, datetime('now'), datetime('now'))
       ON CONFLICT(tag) DO UPDATE SET
         use_count = use_count + 1,
         last_seen = datetime('now')`,
      tag,
    );
  }
}

/** Get tags that cross the promotion threshold (candidates for becoming categories). */
export function getPromotableTags(
  sql: SqlStorage,
  threshold: number,
): { tag: string; use_count: number; first_seen: string; last_seen: string }[] {
  // Exclude tags that are already category names
  const rows = sql
    .exec(
      `SELECT ts.tag, ts.use_count, ts.first_seen, ts.last_seen
       FROM tag_stats ts
       WHERE ts.use_count >= ?
         AND LOWER(ts.tag) NOT IN (SELECT LOWER(name) FROM memory_categories)
       ORDER BY ts.use_count DESC`,
      threshold,
    )
    .toArray();
  return mapRows(rows, (r) => ({
    tag: r.string('tag'),
    use_count: r.number('use_count'),
    first_seen: r.string('first_seen'),
    last_seen: r.string('last_seen'),
  }));
}
