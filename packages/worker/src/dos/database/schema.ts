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
  {
    name: '004_tool_suggestions',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS tool_suggestions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          url TEXT,
          note TEXT,
          suggested_by TEXT NOT NULL,
          suggested_by_handle TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          reject_reason TEXT,
          reviewed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_suggestions_status ON tool_suggestions(status);
      `);
    },
  },
  {
    name: '005_global_user_metrics',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS user_metrics (
          handle TEXT PRIMARY KEY,
          total_sessions INTEGER DEFAULT 0,
          completed_sessions INTEGER DEFAULT 0,
          abandoned_sessions INTEGER DEFAULT 0,
          failed_sessions INTEGER DEFAULT 0,
          total_edits INTEGER DEFAULT 0,
          total_lines_added INTEGER DEFAULT 0,
          total_lines_removed INTEGER DEFAULT 0,
          total_duration_min REAL DEFAULT 0,
          total_input_tokens INTEGER DEFAULT 0,
          total_output_tokens INTEGER DEFAULT 0,
          total_stuck INTEGER DEFAULT 0,
          total_memories_saved INTEGER DEFAULT 0,
          total_memories_searched INTEGER DEFAULT 0,
          total_first_edit_s REAL DEFAULT 0,
          sessions_with_first_edit INTEGER DEFAULT 0,
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS user_tools (
          handle TEXT NOT NULL,
          tool TEXT NOT NULL,
          PRIMARY KEY (handle, tool)
        );

        CREATE TABLE IF NOT EXISTS user_models (
          handle TEXT NOT NULL,
          model TEXT NOT NULL,
          PRIMARY KEY (handle, model)
        );
      `);
    },
  },
  {
    name: '006_model_pricing',
    up(sql) {
      // Canonical model pricing snapshot, refreshed every 6h from LiteLLM.
      // Keyed by LiteLLM canonical name (e.g. `claude-sonnet-4-5-20250929`,
      // `gpt-5`, `xai/grok-4`) — the resolver in lib/litellm-resolver.ts
      // maps raw agent_model strings to these keys.
      //
      // Prices are per 1,000,000 tokens (display convention). Cache fields
      // are nullable because not every model supports prompt caching, and
      // `raw` stores the full LiteLLM entry as JSON so future price tiers
      // (above_500k, audio, image) can be read without a schema migration.
      sql.exec(`
        CREATE TABLE IF NOT EXISTS model_prices (
          canonical_name TEXT PRIMARY KEY,
          input_per_1m REAL NOT NULL,
          output_per_1m REAL NOT NULL,
          cache_creation_per_1m REAL,
          cache_read_per_1m REAL,
          input_per_1m_above_200k REAL,
          output_per_1m_above_200k REAL,
          max_input_tokens INTEGER,
          max_output_tokens INTEGER,
          raw TEXT,
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS pricing_metadata (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          source TEXT NOT NULL,
          source_sha TEXT,
          etag TEXT,
          fetched_at TEXT NOT NULL,
          models_count INTEGER NOT NULL,
          last_attempt_at TEXT,
          last_failure_at TEXT,
          last_failure_reason TEXT
        );
      `);

      // Extend user_metrics with lifetime cache token counters. Anthropic
      // prompt caching can account for 10x+ the uncached input volume, so
      // omitting these would permanently undercount total tokens for every
      // Claude Code user.
      try {
        sql.exec('ALTER TABLE user_metrics ADD COLUMN total_cache_read_tokens INTEGER DEFAULT 0');
      } catch (err) {
        if (!getErrorMessage(err).toLowerCase().includes('duplicate column name')) throw err;
      }
      try {
        sql.exec(
          'ALTER TABLE user_metrics ADD COLUMN total_cache_creation_tokens INTEGER DEFAULT 0',
        );
      } catch (err) {
        if (!getErrorMessage(err).toLowerCase().includes('duplicate column name')) throw err;
      }
    },
  },
  {
    name: '007_user_budgets',
    up(sql) {
      // Per-user context budgets (memory result cap, content truncation,
      // coordination broadcast mode). Stored as JSON text so the shape can
      // evolve without a migration. Parsed on read via parseBudgetConfig
      // (packages/shared/budget-config.ts) which drops unknown or malformed
      // fields silently.
      try {
        sql.exec('ALTER TABLE users ADD COLUMN budgets TEXT');
      } catch (err) {
        if (!getErrorMessage(err).toLowerCase().includes('duplicate column name')) throw err;
      }
    },
  },
  {
    name: '008_defensible_rank_axes',
    up(sql) {
      // Three rollup columns so the radar's Reliability and Focus axes stop
      // being proxies for shutdown-discipline and session-open-time:
      //
      //   total_tool_calls / total_errored_tool_calls: Reliability blends
      //     stuck_rate with the share of tool calls that errored. Stuck
      //     alone captures only "did MCP die" — errored calls capture
      //     "did the agent actually fail at its work."
      //
      //   total_active_min: Focus now measures active work — minutes
      //     bracketing real activity (edits, tool calls, memory ops).
      //     Idle minutes with the agent open no longer inflate the axis.
      //
      // Each column is additive, defaults to 0, and rolls up on session end
      // (clean path + orphan sweep + historical backfill) alongside the
      // existing token/edit totals.
      const adds = [
        'ALTER TABLE user_metrics ADD COLUMN total_tool_calls INTEGER DEFAULT 0',
        'ALTER TABLE user_metrics ADD COLUMN total_errored_tool_calls INTEGER DEFAULT 0',
        'ALTER TABLE user_metrics ADD COLUMN total_active_min REAL DEFAULT 0',
      ];
      for (const stmt of adds) {
        try {
          sql.exec(stmt);
        } catch (err) {
          if (!getErrorMessage(err).toLowerCase().includes('duplicate column name')) throw err;
        }
      }
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
