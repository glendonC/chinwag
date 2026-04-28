// Lobby Durable Object -- tracks global presence (handles + countries) and
// surfaces aggregate counts for the public /stats endpoint.
//
// Originally also assigned chat rooms; the chat feature was removed and the
// `rooms` table is dropped by migration 003. Name kept to avoid a DO rename.
// Uses DO RPC for direct method calls.

import { DurableObject } from 'cloudflare:workers';
import type { Env } from './types.js';
import type { Migration } from './lib/migrator.js';
import { PRESENCE_TTL_MS } from './lib/constants.js';
import { runMigrations } from './lib/migrator.js';

const lobbyMigrations: Migration[] = [
  {
    name: '001_initial_schema',
    up(sql) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
          room_id TEXT PRIMARY KEY,
          count INTEGER NOT NULL DEFAULT 0,
          last_updated TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS presence (
          handle TEXT PRIMARY KEY,
          last_seen INTEGER NOT NULL
        );
      `);
    },
  },
  {
    name: '002_presence_country',
    up(sql) {
      sql.exec(`ALTER TABLE presence ADD COLUMN country TEXT`);
    },
  },
  {
    name: '003_drop_rooms',
    up(sql) {
      sql.exec(`DROP TABLE IF EXISTS rooms`);
    },
  },
];

export class LobbyDO extends DurableObject<Env> {
  sql: SqlStorage;
  presence: Map<string, { lastSeen: number; country: string | null }>;
  #schemaReady = false;
  #lastPresenceCleanup = 0;

  #transact: <T>(fn: () => T) => T;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.#transact = <T>(fn: () => T): T => ctx.storage.transactionSync(fn);
    this.presence = new Map();
  }

  #ensureSchema(): void {
    if (this.#schemaReady) return;

    runMigrations(this.sql, this.#transact, lobbyMigrations);

    for (const row of this.sql.exec('SELECT handle, last_seen, country FROM presence')) {
      const r = row as { handle: string; last_seen: number; country: string | null };
      this.presence.set(r.handle, { lastSeen: r.last_seen, country: r.country });
    }

    this.#schemaReady = true;
  }

  /** Evict stale presence entries -- at most once per PRESENCE_TTL_MS. */
  #maybeCleanupPresence(): void {
    const now = Date.now();
    if (now - this.#lastPresenceCleanup < PRESENCE_TTL_MS) return;
    this.#lastPresenceCleanup = now;

    const staleHandles: string[] = [];
    for (const [handle, entry] of this.presence) {
      if (now - entry.lastSeen > PRESENCE_TTL_MS) {
        this.presence.delete(handle);
        staleHandles.push(handle);
      }
    }
    if (staleHandles.length > 0) {
      const placeholders = staleHandles.map(() => '?').join(', ');
      this.sql.exec(`DELETE FROM presence WHERE handle IN (${placeholders})`, ...staleHandles);
    }
  }

  async heartbeat(handle: string, country?: string | null): Promise<{ ok: true }> {
    this.#ensureSchema();
    const now = Date.now();
    const cc = country || null;
    this.presence.set(handle, { lastSeen: now, country: cc });
    this.sql.exec(
      'INSERT INTO presence (handle, last_seen, country) VALUES (?, ?, ?) ON CONFLICT(handle) DO UPDATE SET last_seen = excluded.last_seen, country = excluded.country',
      handle,
      now,
      cc,
    );
    this.#maybeCleanupPresence();
    return { ok: true };
  }

  async getStats(): Promise<{
    ok: true;
    online: number;
    countries: Record<string, number>;
  }> {
    this.#ensureSchema();
    this.#maybeCleanupPresence();

    const countries: Record<string, number> = {};
    for (const [, entry] of this.presence) {
      const cc = entry.country || 'XX';
      countries[cc] = (countries[cc] || 0) + 1;
    }

    return { ok: true, online: this.presence.size, countries };
  }
}
