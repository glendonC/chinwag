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
  if (!columnName || hasColumn(sql, table, columnName)) return;
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
  {
    name: '018_edit_work_type',
    up(sql) {
      // Normalize work type on write: classify once in recordEdit() instead of
      // re-classifying on every analytics query. "other" is the safe default
      // for existing rows -- analytics queries that GROUP BY work_type will
      // bucket them correctly until they age out of the retention window.
      addColumnIfMissing(sql, 'edits', "work_type TEXT DEFAULT 'other'");
    },
  },
  {
    name: '019_conversation_per_message_data',
    up(sql) {
      // Per-message token counts, model, and stop reason enable burn rate
      // analysis, multi-model session tracking, and cost-per-turn.
      addColumnIfMissing(sql, 'conversation_events', 'input_tokens INTEGER DEFAULT NULL');
      addColumnIfMissing(sql, 'conversation_events', 'output_tokens INTEGER DEFAULT NULL');
      addColumnIfMissing(sql, 'conversation_events', 'cache_read_tokens INTEGER DEFAULT NULL');
      addColumnIfMissing(sql, 'conversation_events', 'cache_creation_tokens INTEGER DEFAULT NULL');
      addColumnIfMissing(sql, 'conversation_events', 'model TEXT DEFAULT NULL');
      addColumnIfMissing(sql, 'conversation_events', 'stop_reason TEXT DEFAULT NULL');
    },
  },
  {
    name: '020_memory_consolidation',
    up(sql) {
      // Soft-delete pointer for memories merged by consolidation. Search
      // filters WHERE merged_into IS NULL by default; the row stays in the
      // DB so unmerge_memory() can restore. Inspired by Graphiti's
      // recall-then-verify funnel: cosine recall, deterministic Jaccard
      // structural check, tag-set agreement, then propose-only review.
      addColumnIfMissing(sql, 'memories', 'merged_into TEXT DEFAULT NULL');
      addColumnIfMissing(sql, 'memories', 'merged_at TEXT DEFAULT NULL');
      sql.exec(
        'CREATE INDEX IF NOT EXISTS idx_memories_merged ON memories(merged_into) WHERE merged_into IS NOT NULL',
      );

      // Review queue. Consolidation proposes merges with all three signals
      // recorded so the reviewer can audit before applying. Status flow:
      // pending -> applied | rejected. proposed_at orders the queue;
      // resolved_at records review action.
      sql.exec(`
        CREATE TABLE IF NOT EXISTS consolidation_proposals (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          cosine REAL NOT NULL,
          jaccard REAL NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          proposed_at TEXT NOT NULL DEFAULT (datetime('now')),
          resolved_at TEXT DEFAULT NULL,
          resolved_by TEXT DEFAULT NULL,
          UNIQUE(source_id, target_id)
        )
      `);
      sql.exec(
        "CREATE INDEX IF NOT EXISTS idx_consolidation_proposals_status ON consolidation_proposals(status, proposed_at) WHERE status = 'pending'",
      );
    },
  },
  {
    name: '021_formation_observations',
    up(sql) {
      // Shadow-mode formation: after each save, an LLM classifies the new
      // memory as keep / merge / evolve / discard against top-K cosine-
      // similar neighbours and records the recommendation here. Nothing
      // ever auto-applies; the table is observability for tuning the
      // consolidation funnel and (eventually) for opt-in enforcement.
      // Mem0 v3 reversed write-time auto-merge for this exact reason.
      sql.exec(`
        CREATE TABLE IF NOT EXISTS formation_observations (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL,
          recommendation TEXT NOT NULL,
          target_id TEXT DEFAULT NULL,
          confidence REAL DEFAULT NULL,
          llm_reason TEXT DEFAULT NULL,
          model TEXT DEFAULT NULL,
          status TEXT NOT NULL DEFAULT 'observed',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      sql.exec(
        'CREATE INDEX IF NOT EXISTS idx_formation_obs_memory ON formation_observations(memory_id)',
      );
      sql.exec(
        "CREATE INDEX IF NOT EXISTS idx_formation_obs_recommendation ON formation_observations(recommendation, created_at) WHERE status = 'observed'",
      );
    },
  },
  {
    name: '022_memory_search_hits_per_session',
    up(sql) {
      // Per-session hit counter. Companion to memories_searched (count of
      // search calls); this counts calls that returned at least one result.
      // Needed so memory_outcome_correlation can distinguish "searched and
      // got something useful" from "searched and got nothing" — the latter
      // is a retrieval-quality signal, not a memory-usage signal.
      addColumnIfMissing(sql, 'sessions', 'memories_search_hits INTEGER DEFAULT 0');
    },
  },
  {
    name: '023_memory_bi_temporal_supersession',
    up(sql) {
      // Bi-temporal supersession, adapted from Graphiti
      // (edge_operations.py:537-572, MIT-licensed, Apache-2.0 core).
      //
      // `valid_at`   — when the real-world fact became true. Set at save
      //                time; backfilled to `created_at` for existing rows so
      //                every row has a non-null value and contradiction
      //                detection can rely on a full temporal interval.
      // `invalid_at` — when the fact stopped being true. Null means still
      //                valid. Set by `applyConsolidationProposal` when a
      //                newer superseding memory is applied with
      //                `kind='invalidate'` (see migration note on the
      //                `kind` column below).
      //
      // Dual-mode rollout: this ships ALONGSIDE the existing `merged_into`
      // soft-delete mechanism (migration 020). Nothing auto-migrates
      // `merged_into` rows to `invalid_at` — merge still absorbs content,
      // invalidate preserves both rows with the older one hidden from
      // default search. Different semantics, kept separate.
      //
      // We deliberately do NOT add `expired_at` (DB-action time) at this
      // point. Chinwag has no callers that distinguish ingestion time from
      // fact-validity time today; when one appears, add the column then.
      addColumnIfMissing(
        sql,
        'memories',
        'valid_at TEXT DEFAULT NULL',
        'UPDATE memories SET valid_at = created_at WHERE valid_at IS NULL',
      );
      addColumnIfMissing(sql, 'memories', 'invalid_at TEXT DEFAULT NULL');
      // Partial index so default search (WHERE invalid_at IS NULL) stays
      // cheap as the history of invalidated memories grows.
      sql.exec(
        'CREATE INDEX IF NOT EXISTS idx_memories_invalid_at ON memories(invalid_at) WHERE invalid_at IS NOT NULL',
      );

      // Proposal kind. `'merge'` (existing behaviour) absorbs source into
      // target via `merged_into`. `'invalidate'` sets
      // target.invalid_at = source.valid_at without touching merged_into —
      // the older fact stays queryable as history but falls out of default
      // search. Existing rows default to `'merge'` so legacy proposals
      // apply unchanged.
      addColumnIfMissing(sql, 'consolidation_proposals', "kind TEXT DEFAULT 'merge'");
    },
  },
  {
    name: '024_lock_glob_patterns_and_ttl',
    up(sql) {
      // Advisory locks gain glob-pattern intent claims + optional TTL,
      // adapted from mcp_agent_mail's `FileReservation` model. Motivation:
      // an agent refactoring `src/auth/**/*.ts` should be able to declare
      // the whole scope as one claim rather than hammering the lock table
      // with every touched file. Conflict detection then checks both
      // exact-path claims and glob claims before allowing an edit.
      //
      // `path_glob` is non-null when `file_path` is itself a glob pattern
      // (e.g. "src/auth/**") — the column exists so the conflict-check
      // fast path can filter `WHERE path_glob IS NOT NULL` and only run
      // the pattern matcher against genuine globs. Keeping `file_path`
      // as the primary key means concurrent identical glob claims still
      // conflict cleanly through the existing ON CONFLICT machinery.
      //
      // `expires_ts` is the wall-clock time after which the lock is stale
      // and may be reaped. NULL = no explicit TTL; the heartbeat-based
      // liveness check still governs cleanup. Claims with explicit TTLs
      // (e.g. "reserve this scope for 30 minutes while I refactor") are
      // the primary use case.
      addColumnIfMissing(sql, 'locks', 'path_glob TEXT DEFAULT NULL');
      addColumnIfMissing(sql, 'locks', 'expires_ts TEXT DEFAULT NULL');
      // Partial indexes so the hot path (concrete-file claim checking all
      // active globs, and periodic TTL sweeps) stays cheap.
      sql.exec(
        'CREATE INDEX IF NOT EXISTS idx_locks_glob ON locks(path_glob) WHERE path_glob IS NOT NULL',
      );
      sql.exec(
        'CREATE INDEX IF NOT EXISTS idx_locks_expires ON locks(expires_ts) WHERE expires_ts IS NOT NULL',
      );
    },
  },
  {
    name: '025_commit_noise_flag',
    up(sql) {
      // Commits gain an `is_noise` flag classified at write time. Lockfile
      // bumps, formatting passes, merge commits, and WIP checkpoints get
      // recorded with `is_noise = 1` so the audit trail stays intact, but
      // analytics queries filter them out by default. Without this, a
      // session whose only "commit" was `chore(deps): bump` shows up in
      // commit-rate analytics with the same weight as a substantive change,
      // diluting per-session and per-tool averages.
      //
      // Adapted from memorix's `noise-filter.ts` (Apache 2.0). See
      // `commit-noise.ts` for the classification rules.
      addColumnIfMissing(sql, 'commits', 'is_noise INTEGER DEFAULT 0');
      // Partial index keeps the analytics fast path (`WHERE is_noise = 0`)
      // cheap on tables where most commits are substantive.
      sql.exec(
        'CREATE INDEX IF NOT EXISTS idx_commits_substantive ON commits(created_at) WHERE is_noise = 0',
      );
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
