// Schema DDL and migrations for DatabaseDO.
// Called once per DO instance to ensure tables exist and run migrations.

import type { Migration } from '../../lib/migrator.js';
import { runMigrations } from '../../lib/migrator.js';
import { getErrorMessage } from '../../lib/errors.js';

// -- Migrations --

const migrations: Migration[] = [
  {
    name: '001_initial_schema',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          handle TEXT UNIQUE NOT NULL,
          color TEXT NOT NULL,
          token TEXT UNIQUE NOT NULL,
          status TEXT,
          created_at TEXT NOT NULL,
          last_active TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS account_limits (
          ip TEXT NOT NULL,
          date TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (ip, date)
        );

        CREATE TABLE IF NOT EXISTS agent_profiles (
          user_id TEXT PRIMARY KEY REFERENCES users(id),
          framework TEXT,
          languages TEXT,
          frameworks TEXT,
          tools TEXT,
          platforms TEXT,
          registered_at TEXT DEFAULT (datetime('now')),
          last_active TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS user_teams (
          user_id TEXT NOT NULL REFERENCES users(id),
          team_id TEXT NOT NULL,
          team_name TEXT,
          joined_at TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, team_id)
        );

        CREATE TABLE IF NOT EXISTS tool_evaluations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          tagline TEXT,
          category TEXT,
          mcp_support INTEGER,
          has_cli INTEGER,
          hooks_support INTEGER,
          channel_support INTEGER,
          process_detectable INTEGER,
          open_source INTEGER,
          verdict TEXT NOT NULL,
          integration_tier TEXT,
          blocking_issues TEXT DEFAULT '[]',
          metadata TEXT NOT NULL DEFAULT '{}',
          sources TEXT NOT NULL DEFAULT '[]',
          in_registry INTEGER DEFAULT 0,
          evaluated_at TEXT NOT NULL,
          confidence TEXT NOT NULL DEFAULT 'medium',
          evaluated_by TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_eval_category ON tool_evaluations(category);
        CREATE INDEX IF NOT EXISTS idx_eval_verdict ON tool_evaluations(verdict);

        CREATE TABLE IF NOT EXISTS web_sessions (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          last_used TEXT DEFAULT (datetime('now')),
          user_agent TEXT,
          revoked INTEGER DEFAULT 0
        );
      `);
    },
  },
  {
    name: '002_add_columns',
    up(sql) {
      // team_name column for tables created before this column existed
      try {
        sql.exec('ALTER TABLE user_teams ADD COLUMN team_name TEXT');
      } catch (err) {
        if (!getErrorMessage(err).toLowerCase().includes('duplicate column name')) throw err;
      }

      // GitHub OAuth columns
      try {
        sql.exec('ALTER TABLE users ADD COLUMN github_id TEXT');
      } catch (err) {
        if (!getErrorMessage(err).toLowerCase().includes('duplicate column name')) throw err;
      }
      try {
        sql.exec('ALTER TABLE users ADD COLUMN github_login TEXT');
      } catch (err) {
        if (!getErrorMessage(err).toLowerCase().includes('duplicate column name')) throw err;
      }
      try {
        sql.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
      } catch (err) {
        if (!getErrorMessage(err).toLowerCase().includes('duplicate column name')) throw err;
      }
      sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id)');
    },
  },
  {
    name: '003_data_passes',
    up(sql) {
      // Track which evaluation passes (core/enrichment/credibility) have completed per tool.
      try {
        sql.exec("ALTER TABLE tool_evaluations ADD COLUMN data_passes TEXT DEFAULT '{}'");
      } catch (err) {
        if (!getErrorMessage(err).toLowerCase().includes('duplicate column name')) throw err;
      }

      // Backfill existing evaluations based on data heuristics.
      // All existing tools have at least core data (name, category, verdict exist).
      const now = new Date().toISOString();
      sql.exec(
        `UPDATE tool_evaluations
         SET data_passes = json_object('core', json_object('completed_at', evaluated_at, 'success', json('true')))
         WHERE data_passes = '{}'`,
      );

      // Tools with ai_summary in metadata had enrichment pass succeed.
      sql.exec(
        `UPDATE tool_evaluations
         SET data_passes = json_set(data_passes,
           '$.enrichment', json_object('completed_at', evaluated_at, 'success', json('true'))
         )
         WHERE json_extract(metadata, '$.ai_summary') IS NOT NULL
           AND json_extract(metadata, '$.ai_summary') != 'null'`,
      );

      // Tools with any credibility field had credibility pass succeed.
      sql.exec(
        `UPDATE tool_evaluations
         SET data_passes = json_set(data_passes,
           '$.credibility', json_object('completed_at', evaluated_at, 'success', json('true'))
         )
         WHERE json_extract(metadata, '$.founded_year') IS NOT NULL
           OR json_extract(metadata, '$.team_size') IS NOT NULL
           OR json_extract(metadata, '$.funding_status') IS NOT NULL
           OR json_extract(metadata, '$.update_frequency') IS NOT NULL
           OR json_extract(metadata, '$.documentation_quality') IS NOT NULL`,
      );
    },
  },
];

export function ensureSchema(sql: SqlStorage, transact: <T>(fn: () => T) => T): void {
  runMigrations(sql, transact, migrations);
}

/**
 * Prune stale data that should run on every startup (not a migration).
 * Cleans expired rate-limit buckets and revoked/expired web sessions.
 */
export function cleanup(sql: SqlStorage): void {
  sql.exec("DELETE FROM account_limits WHERE date < date('now', '-2 days')");
  sql.exec("DELETE FROM web_sessions WHERE expires_at < datetime('now') OR revoked = 1");
}
