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
