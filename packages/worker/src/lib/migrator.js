// Versioned migration runner for Durable Object schemas.
//
// Each DO defines an ordered array of named migrations. The runner tracks
// applied migrations in a `_migrations` table and only executes new ones.
// Each migration runs inside a transaction so partial application can't
// leave the schema in a broken state.

import { createLogger } from './logger.js';
import { getErrorMessage } from './errors.js';

const log = createLogger('migrator');

/**
 * Ensure the `_migrations` bookkeeping table exists.
 * @param {object} sql - ctx.storage.sql handle
 */
function ensureMigrationsTable(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Return the set of migration names already applied.
 * @param {object} sql
 * @returns {Set<string>}
 */
function getAppliedMigrations(sql) {
  const rows = sql.exec('SELECT name FROM _migrations ORDER BY id').toArray();
  return new Set(rows.map((r) => r.name));
}

/**
 * Run an ordered list of named migrations, skipping any that have already
 * been applied. Each new migration is wrapped in a transaction.
 *
 * @param {object} sql               - ctx.storage.sql handle
 * @param {<T>(fn: () => T) => T} transact - ctx.storage.transactionSync
 * @param {Array<{ name: string, up: (sql: object) => void }>} migrations
 * @returns {number} count of newly applied migrations
 */
export function runMigrations(sql, transact, migrations) {
  ensureMigrationsTable(sql);
  const applied = getAppliedMigrations(sql);
  let count = 0;

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;

    try {
      transact(() => {
        migration.up(sql);
        sql.exec('INSERT INTO _migrations (name) VALUES (?)', migration.name);
      });
      count++;
    } catch (err) {
      log.error('migration failed', {
        name: migration.name,
        error: getErrorMessage(err),
      });
      // Stop on first failure — don't skip and run later migrations
      // that might depend on this one
      throw err;
    }
  }

  return count;
}
