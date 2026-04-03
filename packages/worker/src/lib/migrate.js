// Idempotent migration runner for Durable Object schemas.
//
// SQLite errors that indicate an already-applied migration (e.g. "duplicate
// column name") are expected and silenced. All other errors are logged with
// enough context to debug remotely via `wrangler tail`.

import { createLogger } from './logger.js';

const log = createLogger('migrate');

/**
 * Error messages that mean "this migration already ran" -- not real failures.
 * SQLite uses these exact phrases; we match case-insensitively for safety.
 * @type {string[]}
 */
const IDEMPOTENT_PATTERNS = [
  'duplicate column name', // ALTER TABLE ADD COLUMN that already exists
  'already exists', // CREATE TABLE/INDEX that already exists
];

function isExpectedError(message) {
  const lower = (message || '').toLowerCase();
  return IDEMPOTENT_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Run a single migration (DDL statement + optional backfill).
 *
 * @param {object} sql         - ctx.storage.sql handle
 * @param {string} ddl         - The ALTER/CREATE statement
 * @param {string|null} backfill - Optional follow-up statement (runs only if DDL succeeds)
 * @param {string} label       - Context label for logging (e.g. "TeamDO" or "DatabaseDO")
 * @returns {boolean} true if the DDL executed (new migration), false if already applied
 */
export function runMigration(sql, ddl, backfill, label) {
  try {
    sql.exec(ddl);
    if (backfill) sql.exec(backfill);
    return true;
  } catch (/** @type {any} */ err) {
    if (isExpectedError(err.message)) {
      return false; // Already applied — this is fine
    }
    // Real failure — log enough context to diagnose remotely
    log.error('migration failed', {
      label,
      error: err.message,
      sql: ddl.replace(/\s+/g, ' ').trim(),
    });
    return false;
  }
}

/**
 * Run a batch of migrations. Each entry is [ddlStatement, backfillOrNull].
 *
 * @param {object} sql           - ctx.storage.sql handle
 * @param {Array}  migrations    - Array of [ddl, backfill|null] tuples
 * @param {string} label         - Context label for logging
 */
export function runMigrations(sql, migrations, label) {
  for (const [ddl, backfill] of migrations) {
    runMigration(sql, ddl, backfill, label);
  }
}
