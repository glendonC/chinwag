// Schema DDL and migrations for TeamDO.
// Called once per DO instance to ensure tables exist and reconcile legacy schemas.

import type { Migration } from '../../lib/migrator.js';
import { createLogger } from '../../lib/logger.js';
import { runMigrations } from '../../lib/migrator.js';

const log = createLogger('TeamDO.schema');

// -- Helpers (used by reconciliation migration) --

function logMigrationError(statement: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  log.error('migration failed', { error: message, sql: statement.replace(/\s+/g, ' ').trim() });
}

function getColumns(sql: SqlStorage, table: string): Set<string> {
  try {
    return new Set(
      sql
        .exec(`PRAGMA table_info(${table})`)
        .toArray()
        .map((row) => (row as { name: string }).name),
    );
  } catch {
    return new Set();
  }
}

function hasColumn(sql: SqlStorage, table: string, column: string): boolean {
  return getColumns(sql, table).has(column);
}

function renameColumnIfNeeded(
  sql: SqlStorage,
  table: string,
  fromColumn: string,
  toColumn: string,
): void {
  if (hasColumn(sql, table, toColumn) || !hasColumn(sql, table, fromColumn)) return;
  const statement = `ALTER TABLE ${table} RENAME COLUMN ${fromColumn} TO ${toColumn}`;
  try {
    sql.exec(statement);
  } catch (error) {
    logMigrationError(statement, error);
  }
}

function addColumnIfMissing(
  sql: SqlStorage,
  table: string,
  definition: string,
  backfill: string | null = null,
): void {
  const columnName = definition.trim().split(/\s+/, 1)[0];
  if (hasColumn(sql, table, columnName)) return;
  const statement = `ALTER TABLE ${table} ADD COLUMN ${definition}`;
  try {
    sql.exec(statement);
    if (backfill) sql.exec(backfill);
  } catch (error) {
    logMigrationError(statement, error);
  }
}

// -- Migrations --

// -- Edit log retention --
// Edits follow the same retention as sessions (30 days).
// Cleanup runs in cleanup.ts alongside session pruning.

const migrations: Migration[] = [
  {
    name: '001_initial_schema',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS members (
          agent_id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          handle TEXT NOT NULL,
          host_tool TEXT DEFAULT 'unknown',
          agent_surface TEXT,
          transport TEXT,
          agent_model TEXT,
          joined_at TEXT DEFAULT (datetime('now')),
          last_heartbeat TEXT DEFAULT (datetime('now')),
          last_tool_use TEXT
        );

        CREATE TABLE IF NOT EXISTS activities (
          agent_id TEXT PRIMARY KEY,
          files TEXT NOT NULL DEFAULT '[]',
          summary TEXT NOT NULL DEFAULT '',
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          tags TEXT DEFAULT '[]',
          agent_id TEXT NOT NULL,
          handle TEXT,
          host_tool TEXT DEFAULT 'unknown',
          agent_surface TEXT,
          agent_model TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          handle TEXT NOT NULL,
          framework TEXT DEFAULT 'unknown',
          host_tool TEXT DEFAULT 'unknown',
          agent_surface TEXT,
          transport TEXT,
          agent_model TEXT,
          started_at TEXT DEFAULT (datetime('now')),
          ended_at TEXT,
          edit_count INTEGER DEFAULT 0,
          files_touched TEXT DEFAULT '[]',
          conflicts_hit INTEGER DEFAULT 0,
          memories_saved INTEGER DEFAULT 0
        );
      `);

      sql.exec(`
        CREATE TABLE IF NOT EXISTS locks (
          file_path TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          handle TEXT NOT NULL,
          host_tool TEXT DEFAULT 'unknown',
          agent_surface TEXT,
          claimed_at TEXT DEFAULT (datetime('now'))
        );
      `);

      sql.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          handle TEXT NOT NULL,
          host_tool TEXT DEFAULT 'unknown',
          agent_surface TEXT,
          target_agent TEXT,
          text TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);

      sql.exec(`
        CREATE TABLE IF NOT EXISTS telemetry (
          metric TEXT PRIMARY KEY,
          count INTEGER DEFAULT 0,
          last_at TEXT DEFAULT (datetime('now'))
        );
      `);

      sql.exec('CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id, ended_at)');
      sql.exec('CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at)');
      sql.exec('CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)');
      sql.exec('CREATE INDEX IF NOT EXISTS idx_locks_agent ON locks(agent_id)');
      sql.exec('CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at)');
    },
  },
  {
    name: '002_reconcile_legacy',
    up(sql) {
      // Column renames and additions for members
      renameColumnIfNeeded(sql, 'members', 'owner_handle', 'handle');
      addColumnIfMissing(
        sql,
        'members',
        "host_tool TEXT DEFAULT 'unknown'",
        'UPDATE members SET host_tool = tool WHERE host_tool IS NULL',
      );
      addColumnIfMissing(sql, 'members', 'agent_surface TEXT');
      addColumnIfMissing(sql, 'members', 'transport TEXT');
      addColumnIfMissing(sql, 'members', 'agent_model TEXT');
      addColumnIfMissing(sql, 'members', 'last_tool_use TEXT');

      // Memories reconciliation
      const memoryColumns = getColumns(sql, 'memories');
      const memoryHostSource = memoryColumns.has('source_host_tool')
        ? 'source_host_tool'
        : memoryColumns.has('source_tool')
          ? 'source_tool'
          : "'unknown'";
      renameColumnIfNeeded(sql, 'memories', 'source_agent', 'agent_id');
      renameColumnIfNeeded(sql, 'memories', 'source_handle', 'handle');
      renameColumnIfNeeded(sql, 'memories', 'source_agent_surface', 'agent_surface');
      renameColumnIfNeeded(sql, 'memories', 'source_model', 'agent_model');
      addColumnIfMissing(
        sql,
        'memories',
        "host_tool TEXT DEFAULT 'unknown'",
        `UPDATE memories SET host_tool = COALESCE(${memoryHostSource}, 'unknown') WHERE host_tool IS NULL`,
      );

      // Sessions reconciliation
      renameColumnIfNeeded(sql, 'sessions', 'owner_handle', 'handle');
      addColumnIfMissing(
        sql,
        'sessions',
        "host_tool TEXT DEFAULT 'unknown'",
        "UPDATE sessions SET host_tool = CASE WHEN instr(agent_id, ':') > 0 THEN substr(agent_id, 1, instr(agent_id, ':') - 1) ELSE 'unknown' END WHERE host_tool IS NULL",
      );
      addColumnIfMissing(sql, 'sessions', 'agent_surface TEXT');
      addColumnIfMissing(sql, 'sessions', 'transport TEXT');
      addColumnIfMissing(sql, 'sessions', 'agent_model TEXT');

      // Locks reconciliation
      renameColumnIfNeeded(sql, 'locks', 'owner_handle', 'handle');
      addColumnIfMissing(
        sql,
        'locks',
        "host_tool TEXT DEFAULT 'unknown'",
        'UPDATE locks SET host_tool = tool WHERE host_tool IS NULL',
      );
      addColumnIfMissing(sql, 'locks', 'agent_surface TEXT');

      // Messages reconciliation
      const messageColumns = getColumns(sql, 'messages');
      const messageHostSource = messageColumns.has('from_host_tool')
        ? 'from_host_tool'
        : messageColumns.has('from_tool')
          ? 'from_tool'
          : "'unknown'";
      renameColumnIfNeeded(sql, 'messages', 'from_agent', 'agent_id');
      renameColumnIfNeeded(sql, 'messages', 'from_handle', 'handle');
      renameColumnIfNeeded(sql, 'messages', 'from_agent_surface', 'agent_surface');
      addColumnIfMissing(
        sql,
        'messages',
        "host_tool TEXT DEFAULT 'unknown'",
        `UPDATE messages SET host_tool = COALESCE(${messageHostSource}, 'unknown') WHERE host_tool IS NULL`,
      );
    },
  },
  {
    name: '003_additional_indexes',
    up(sql) {
      // Compound index for active session lookups (context queries filter on agent_id + ended_at)
      // Note: idx_sessions_agent was created in 001 but we recreate with IF NOT EXISTS for safety
      sql.exec('CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id, ended_at)');
      // File-level conflict detection in locks
      sql.exec('CREATE INDEX IF NOT EXISTS idx_locks_file_path ON locks(file_path)');
      // Activity queries filter/sort by agent_id + updated_at
      sql.exec(
        'CREATE INDEX IF NOT EXISTS idx_activities_agent_updated ON activities(agent_id, updated_at)',
      );
      // Memory pruning and search order by created_at
      sql.exec('CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at)');
      // Member heartbeat checks (stale eviction, active window filtering)
      sql.exec('CREATE INDEX IF NOT EXISTS idx_members_heartbeat ON members(last_heartbeat)');
      // Member ownership lookups (leave, identity resolution)
      sql.exec('CREATE INDEX IF NOT EXISTS idx_members_owner ON members(owner_id)');
      // Messages target_agent + created_at for per-agent inbox queries
      sql.exec(
        'CREATE INDEX IF NOT EXISTS idx_messages_target_created ON messages(target_agent, created_at)',
      );
    },
  },
  {
    name: '004_commands_table',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS commands (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          payload TEXT NOT NULL DEFAULT '{}',
          sender_id TEXT NOT NULL,
          sender_handle TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          claimed_by TEXT,
          result TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          claimed_at TEXT,
          completed_at TEXT
        )
      `);
      sql.exec('CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status, created_at)');
    },
  },
  {
    name: '005_intelligence_foundation',
    up(sql) {
      // Session outcome tracking
      addColumnIfMissing(sql, 'sessions', 'outcome TEXT DEFAULT NULL');
      addColumnIfMissing(sql, 'sessions', 'outcome_summary TEXT DEFAULT NULL');

      // Edit diff stats (accumulated per session, not per edit)
      addColumnIfMissing(sql, 'sessions', 'lines_added INTEGER DEFAULT 0');
      addColumnIfMissing(sql, 'sessions', 'lines_removed INTEGER DEFAULT 0');

      // Time-bucketed telemetry for trend analysis
      sql.exec(`
        CREATE TABLE IF NOT EXISTS daily_metrics (
          date TEXT NOT NULL,
          metric TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (date, metric)
        )
      `);
      sql.exec('CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(date)');
    },
  },
  {
    name: '006_memory_categories',
    up(sql) {
      // Per-project memory categories — admin-defined, agent-assigned on save.
      // Each category has a precomputed embedding (bge-small-en-v1.5, 384 dims)
      // for future semantic matching and dedup validation.
      sql.exec(`
        CREATE TABLE IF NOT EXISTS memory_categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          color TEXT DEFAULT NULL,
          embedding BLOB DEFAULT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      // Add categories column to memories table for agent-assigned classification
      addColumnIfMissing(sql, 'memories', "categories TEXT DEFAULT '[]'");

      // Track tag frequency for tag-to-category promotion suggestions
      sql.exec(`
        CREATE TABLE IF NOT EXISTS tag_stats (
          tag TEXT PRIMARY KEY,
          use_count INTEGER DEFAULT 1,
          first_seen TEXT DEFAULT (datetime('now')),
          last_seen TEXT DEFAULT (datetime('now'))
        )
      `);

      // last_accessed_at for memory decay/lifecycle (throttled updates)
      addColumnIfMissing(sql, 'memories', 'last_accessed_at TEXT DEFAULT NULL');
    },
  },
  {
    name: '007_edit_log',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS edits (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          handle TEXT NOT NULL,
          host_tool TEXT DEFAULT 'unknown',
          file_path TEXT NOT NULL,
          lines_added INTEGER DEFAULT 0,
          lines_removed INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      sql.exec('CREATE INDEX IF NOT EXISTS idx_edits_session ON edits(session_id)');
      sql.exec('CREATE INDEX IF NOT EXISTS idx_edits_file ON edits(file_path, created_at)');
      sql.exec('CREATE INDEX IF NOT EXISTS idx_edits_created ON edits(created_at)');
    },
  },
  {
    name: '008_memory_session_and_filters',
    up(sql) {
      // Link memories to the session that created them
      addColumnIfMissing(sql, 'memories', 'session_id TEXT DEFAULT NULL');
      // Indexes for richer query filters (agent_id, handle already used in WHERE)
      sql.exec('CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id)');
      sql.exec('CREATE INDEX IF NOT EXISTS idx_memories_handle ON memories(handle)');
      sql.exec('CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id)');
    },
  },
  {
    name: '009_memory_fts5_dedup_embedding',
    up(sql) {
      // Hash for exact dedup (SHA-256 of normalized text)
      addColumnIfMissing(sql, 'memories', 'text_hash TEXT DEFAULT NULL');

      // Embedding for near-dedup and future semantic search (bge-small-en-v1.5, 384 dims)
      addColumnIfMissing(sql, 'memories', 'embedding BLOB DEFAULT NULL');

      // Unique index on text_hash — fast exact dedup lookup
      sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_text_hash ON memories(text_hash)');

      // FTS5 virtual table for full-text search with BM25 ranking.
      // External content table pointing at memories — FTS5 doesn't store data,
      // it indexes the memories table and uses triggers to stay in sync.
      // tokenize: unicode61 with underscores and dots as token characters
      // so snake_case and dotted.paths are indexed as single tokens.
      sql.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          text,
          tags,
          content=memories,
          content_rowid=rowid,
          tokenize="unicode61 tokenchars '_.'"
        )
      `);

      // Sync triggers — keep FTS5 index in sync with memories table
      sql.exec(`
        CREATE TRIGGER IF NOT EXISTS memories_fts_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, text, tags) VALUES (new.rowid, new.text, new.tags);
        END
      `);
      sql.exec(`
        CREATE TRIGGER IF NOT EXISTS memories_fts_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, text, tags) VALUES ('delete', old.rowid, old.text, old.tags);
        END
      `);
      sql.exec(`
        CREATE TRIGGER IF NOT EXISTS memories_fts_au AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, text, tags) VALUES ('delete', old.rowid, old.text, old.tags);
          INSERT INTO memories_fts(rowid, text, tags) VALUES (new.rowid, new.text, new.tags);
        END
      `);

      // Backfill FTS5 index from existing memories
      sql.exec(
        `INSERT INTO memories_fts(rowid, text, tags) SELECT rowid, text, tags FROM memories`,
      );
    },
  },
  {
    name: '010_conversation_events',
    up(sql) {
      // Conversation events — parsed messages from managed agent sessions.
      // Captures user and assistant messages for interaction analytics:
      // sentiment tracking, message length trends, topic classification,
      // and correlation with session outcomes.
      sql.exec(`
        CREATE TABLE IF NOT EXISTS conversation_events (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          handle TEXT NOT NULL,
          host_tool TEXT DEFAULT 'unknown',
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          char_count INTEGER NOT NULL DEFAULT 0,
          sentiment TEXT DEFAULT NULL,
          topic TEXT DEFAULT NULL,
          sequence INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      sql.exec(
        'CREATE INDEX IF NOT EXISTS idx_conversation_session ON conversation_events(session_id, sequence)',
      );
      sql.exec(
        'CREATE INDEX IF NOT EXISTS idx_conversation_agent ON conversation_events(agent_id, created_at)',
      );
      sql.exec(
        'CREATE INDEX IF NOT EXISTS idx_conversation_sentiment ON conversation_events(sentiment)',
      );
    },
  },
  {
    name: '011_extended_analytics_columns',
    up(sql) {
      // Time-to-first-edit: set on first recordEdit() call per session
      addColumnIfMissing(sql, 'sessions', 'first_edit_at TEXT DEFAULT NULL');

      // Stuckness flag: set when 15-min heartbeat gap detected
      addColumnIfMissing(sql, 'sessions', 'got_stuck INTEGER DEFAULT 0');

      // Per-session memory search counter (mirrors memories_saved pattern)
      addColumnIfMissing(sql, 'sessions', 'memories_searched INTEGER DEFAULT 0');

      // Structured outcome reasons for aggregation
      addColumnIfMissing(sql, 'sessions', "outcome_tags TEXT DEFAULT '[]'");

      // Memory access frequency counter
      addColumnIfMissing(sql, 'memories', 'access_count INTEGER DEFAULT 0');
    },
  },
  {
    name: '012_token_tracking',
    up(sql) {
      // Per-session token usage — nullable means "data not available for this tool"
      // (distinct from 0 which means "measured zero tokens")
      addColumnIfMissing(sql, 'sessions', 'input_tokens INTEGER DEFAULT NULL');
      addColumnIfMissing(sql, 'sessions', 'output_tokens INTEGER DEFAULT NULL');
    },
  },
  {
    name: '013_normalize_model_names',
    up(sql) {
      // Backfill: strip date suffixes from stored model names for consistent grouping.
      // E.g. "claude-sonnet-4-5-20250514" → "claude-sonnet-4-5"
      // Only affects rows with an 8-digit date suffix pattern.
      try {
        for (const table of ['sessions', 'members'] as const) {
          sql.exec(
            `UPDATE ${table}
             SET agent_model = SUBSTR(agent_model, 1, LENGTH(agent_model) - 9)
             WHERE agent_model IS NOT NULL
               AND LENGTH(agent_model) > 9
               AND SUBSTR(agent_model, LENGTH(agent_model) - 8, 1) = '-'
               AND CAST(SUBSTR(agent_model, LENGTH(agent_model) - 7) AS INTEGER) > 20200000`,
          );
        }
        // Also normalize the telemetry model:* keys
        sql.exec(
          `UPDATE telemetry
           SET metric = 'model:' || SUBSTR(SUBSTR(metric, 7), 1, LENGTH(SUBSTR(metric, 7)) - 9)
           WHERE metric LIKE 'model:%'
             AND LENGTH(metric) > 15
             AND SUBSTR(metric, LENGTH(metric) - 8, 1) = '-'
             AND CAST(SUBSTR(metric, LENGTH(metric) - 7) AS INTEGER) > 20200000`,
        );
      } catch (error) {
        logMigrationError('013_normalize_model_names', error);
      }
    },
  },
  {
    name: '014_tool_calls',
    up(sql) {
      try {
        sql.exec(`
          CREATE TABLE IF NOT EXISTS tool_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            handle TEXT NOT NULL,
            host_tool TEXT DEFAULT 'unknown',
            tool TEXT NOT NULL,
            called_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
          )
        `);
        sql.exec(
          'CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id, called_at)',
        );
        sql.exec('CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool, created_at)');
      } catch (error) {
        logMigrationError('014_tool_calls', error);
      }
    },
  },
  {
    name: '015_tool_calls_enrich',
    up(sql) {
      try {
        sql.exec('ALTER TABLE tool_calls ADD COLUMN is_error INTEGER DEFAULT 0');
        sql.exec('ALTER TABLE tool_calls ADD COLUMN error_preview TEXT DEFAULT NULL');
        sql.exec('ALTER TABLE tool_calls ADD COLUMN input_preview TEXT DEFAULT NULL');
        sql.exec('ALTER TABLE tool_calls ADD COLUMN duration_ms INTEGER DEFAULT NULL');
      } catch (error) {
        logMigrationError('015_tool_calls_enrich', error);
      }
    },
  },
  {
    name: '016_commits',
    up(sql) {
      try {
        sql.exec(`
          CREATE TABLE IF NOT EXISTS commits (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            handle TEXT NOT NULL,
            host_tool TEXT DEFAULT 'unknown',
            sha TEXT NOT NULL,
            branch TEXT DEFAULT NULL,
            message_preview TEXT DEFAULT NULL,
            files_changed INTEGER DEFAULT 0,
            lines_added INTEGER DEFAULT 0,
            lines_removed INTEGER DEFAULT 0,
            committed_at TEXT DEFAULT (datetime('now')),
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(session_id, sha)
          )
        `);
        sql.exec('CREATE INDEX IF NOT EXISTS idx_commits_session ON commits(session_id)');
        sql.exec('CREATE INDEX IF NOT EXISTS idx_commits_sha ON commits(sha)');
        sql.exec('CREATE INDEX IF NOT EXISTS idx_commits_created ON commits(created_at)');
      } catch (error) {
        logMigrationError('016_commits', error);
      }

      // Per-session commit count for fast aggregation (mirrors edit_count)
      addColumnIfMissing(sql, 'sessions', 'commit_count INTEGER DEFAULT 0');

      // Time-to-first-commit for analytics (mirrors first_edit_at)
      addColumnIfMissing(sql, 'sessions', 'first_commit_at TEXT DEFAULT NULL');
    },
  },
  {
    name: '017_cache_token_tracking',
    up(sql) {
      // Anthropic prompt-cached sessions report usage with four token fields:
      // input_tokens (non-cached), output_tokens, cache_creation_input_tokens,
      // cache_read_input_tokens. Without the latter two, heavy-cache workloads
      // (the Claude Code default) show ~7% of the real token volume and a
      // materially wrong cost number. NULL = CLI didn't send the field,
      // distinct from 0 = CLI sent a measured zero (no cache activity this
      // session). Aggregations should COALESCE(col, 0).
      addColumnIfMissing(sql, 'sessions', 'cache_read_tokens INTEGER DEFAULT NULL');
      addColumnIfMissing(sql, 'sessions', 'cache_creation_tokens INTEGER DEFAULT NULL');
    },
  },
];

export function ensureSchema(
  sql: SqlStorage,
  tablesCreated: boolean,
  transact: <T>(fn: () => T) => T,
): void {
  if (tablesCreated) return;

  // If no transact provided (back-compat), wrap each migration body directly
  const txn = transact || (<T>(fn: () => T): T => fn());
  runMigrations(sql, txn, migrations);
}
