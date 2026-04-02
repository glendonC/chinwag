// Schema DDL and migrations for TeamDO.
// Called once per DO instance to ensure tables exist and run any pending migrations.
// Migrations are idempotent ALTERs that always run; CREATE TABLE is gated by caller.

import { runMigrations } from '../../lib/migrate.js';

const MIGRATIONS = [
  ["ALTER TABLE members ADD COLUMN host_tool TEXT DEFAULT 'unknown'", "UPDATE members SET host_tool = tool WHERE host_tool IS NULL"],
  ["ALTER TABLE members ADD COLUMN agent_surface TEXT", null],
  ["ALTER TABLE members ADD COLUMN transport TEXT", null],
  ["ALTER TABLE locks ADD COLUMN host_tool TEXT DEFAULT 'unknown'", "UPDATE locks SET host_tool = tool WHERE host_tool IS NULL"],
  ["ALTER TABLE locks ADD COLUMN agent_surface TEXT", null],
  ["ALTER TABLE messages ADD COLUMN from_host_tool TEXT DEFAULT 'unknown'", "UPDATE messages SET from_host_tool = from_tool WHERE from_host_tool IS NULL"],
  ["ALTER TABLE messages ADD COLUMN from_agent_surface TEXT", null],
  ["ALTER TABLE memories ADD COLUMN source_host_tool TEXT DEFAULT 'unknown'", "UPDATE memories SET source_host_tool = source_tool WHERE source_host_tool IS NULL"],
  ["ALTER TABLE memories ADD COLUMN source_agent_surface TEXT", null],
  ["ALTER TABLE sessions ADD COLUMN host_tool TEXT DEFAULT 'unknown'", "UPDATE sessions SET host_tool = CASE WHEN instr(agent_id, ':') > 0 THEN substr(agent_id, 1, instr(agent_id, ':') - 1) ELSE 'unknown' END WHERE host_tool IS NULL"],
  ["ALTER TABLE sessions ADD COLUMN agent_surface TEXT", null],
  ["ALTER TABLE sessions ADD COLUMN transport TEXT", null],
  ["ALTER TABLE sessions ADD COLUMN agent_model TEXT", null],
  ["ALTER TABLE members ADD COLUMN agent_model TEXT", null],
  ["ALTER TABLE members ADD COLUMN signal_level INTEGER DEFAULT 1", null],
  ["ALTER TABLE members ADD COLUMN last_tool_use TEXT", null],
  ["ALTER TABLE memories ADD COLUMN source_model TEXT", null],
];

/**
 * Run migrations (always) and create tables + indexes (only if not yet created).
 * @param {object} sql - DO SQL handle (ctx.storage.sql)
 * @param {boolean} tablesCreated - true if CREATE TABLE has already run this instance
 */
export function ensureSchema(sql, tablesCreated) {
  runMigrations(sql, MIGRATIONS, 'TeamDO');

  if (tablesCreated) return;

  sql.exec(`
    CREATE TABLE IF NOT EXISTS members (
      agent_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      owner_handle TEXT NOT NULL,
      tool TEXT DEFAULT 'unknown',
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
      source_agent TEXT NOT NULL,
      source_handle TEXT,
      source_tool TEXT DEFAULT 'unknown',
      source_host_tool TEXT DEFAULT 'unknown',
      source_agent_surface TEXT,
      source_model TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      owner_handle TEXT NOT NULL,
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
      owner_handle TEXT NOT NULL,
      tool TEXT DEFAULT 'unknown',
      host_tool TEXT DEFAULT 'unknown',
      agent_surface TEXT,
      claimed_at TEXT DEFAULT (datetime('now'))
    );
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_agent TEXT NOT NULL,
      from_handle TEXT NOT NULL,
      from_tool TEXT DEFAULT 'unknown',
      from_host_tool TEXT DEFAULT 'unknown',
      from_agent_surface TEXT,
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
}
