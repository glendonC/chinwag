// Database Durable Object — single instance holding all persistent data in SQLite.
// Uses DO RPC for direct method calls from the Worker.
// Users have UUID primary keys; handles are display names with a unique index.

import { DurableObject } from 'cloudflare:workers';

const COLORS = [
  'red', 'cyan', 'yellow', 'green', 'magenta', 'blue',
  'orange', 'lime', 'pink', 'sky', 'lavender', 'white',
];

const ADJECTIVES = [
  'swift', 'quiet', 'bold', 'keen', 'warm', 'cool', 'fair', 'deep',
  'bright', 'calm', 'dark', 'fast', 'glad', 'kind', 'live', 'neat',
  'pale', 'rare', 'safe', 'tall', 'vast', 'wise', 'zany', 'apt',
  'dry', 'fit', 'raw', 'shy', 'wry', 'odd', 'sly', 'coy',
  'deft', 'grim', 'hazy', 'icy', 'lazy', 'mild', 'nimble', 'plush',
  'rosy', 'snug', 'tidy', 'ultra', 'vivid', 'witty', 'airy', 'bumpy',
  'crisp', 'dizzy', 'eager', 'fuzzy', 'grumpy', 'hasty', 'itchy', 'jolly',
  'lumpy', 'merry', 'nifty', 'perky', 'quirky', 'rusty', 'shiny', 'tricky',
];

const NOUNS = [
  'fox', 'owl', 'elk', 'yak', 'ant', 'bee', 'cod', 'doe',
  'eel', 'gnu', 'hen', 'jay', 'kit', 'lynx', 'moth', 'newt',
  'pug', 'ram', 'seal', 'toad', 'vole', 'wasp', 'wren', 'crab',
  'crow', 'dart', 'echo', 'fern', 'glow', 'haze', 'iris', 'jade',
  'kelp', 'lark', 'mist', 'node', 'opal', 'pine', 'reed', 'sage',
  'tide', 'vine', 'wolf', 'pixel', 'spark', 'cloud', 'flint', 'brook',
  'crane', 'drift', 'flame', 'ghost', 'haven', 'ivory', 'jewel', 'knoll',
  'maple', 'nexus', 'orbit', 'prism', 'quartz', 'ridge', 'storm', 'thorn',
];

export class DatabaseDO extends DurableObject {
  #schemaReady = false;

  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  #ensureSchema() {
    if (this.#schemaReady) return;

    // Check if old v1 schema exists (handle as PK, no id column)
    const cols = this.sql.exec('PRAGMA table_info(users)').toArray();
    const hasTable = cols.length > 0;
    const hasId = cols.some(c => c.name === 'id');

    if (hasTable && !hasId) {
      this.#migrateV1ToV2();
    }

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        handle TEXT UNIQUE NOT NULL,
        color TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        status TEXT,
        created_at TEXT NOT NULL,
        last_active TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        author_id TEXT NOT NULL,
        message TEXT NOT NULL,
        date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notes_author ON notes(author_id, date);

      CREATE TABLE IF NOT EXISTS exchanges (
        date TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        note_id TEXT NOT NULL,
        PRIMARY KEY (date, recipient_id)
      );

      CREATE TABLE IF NOT EXISTS account_limits (
        ip TEXT NOT NULL,
        date TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ip, date)
      );
    `);

    this.#schemaReady = true;
  }

  #migrateV1ToV2() {
    // Migrate from handle-as-PK to UUID-as-PK schema.
    // Load old data, generate IDs, recreate tables.
    const oldUsers = this.sql.exec('SELECT * FROM users').toArray();
    const oldNotes = this.sql.exec('SELECT * FROM notes').toArray();

    let oldExchanges = [];
    try {
      oldExchanges = this.sql.exec('SELECT * FROM exchanges').toArray();
    } catch { /* table might not exist */ }

    // Build handle → new UUID mapping
    const handleToId = new Map();
    for (const u of oldUsers) {
      handleToId.set(u.handle, crypto.randomUUID());
    }

    // Drop old tables
    this.sql.exec('DROP TABLE IF EXISTS exchanges');
    this.sql.exec('DROP TABLE IF EXISTS notes');
    this.sql.exec('DROP TABLE IF EXISTS users');
    this.sql.exec('DROP TABLE IF EXISTS account_limits');
    this.sql.exec('DROP INDEX IF EXISTS idx_notes_date');
    this.sql.exec('DROP INDEX IF EXISTS idx_notes_author_date');

    // Create new schema
    this.sql.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        handle TEXT UNIQUE NOT NULL,
        color TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        status TEXT,
        created_at TEXT NOT NULL,
        last_active TEXT NOT NULL
      );

      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        author_id TEXT NOT NULL,
        message TEXT NOT NULL,
        date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_notes_date ON notes(date, created_at DESC);
      CREATE INDEX idx_notes_author ON notes(author_id, date);

      CREATE TABLE exchanges (
        date TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        note_id TEXT NOT NULL,
        PRIMARY KEY (date, recipient_id)
      );

      CREATE TABLE account_limits (
        ip TEXT NOT NULL,
        date TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ip, date)
      );
    `);

    // Re-insert users with new IDs
    for (const u of oldUsers) {
      this.sql.exec(
        `INSERT INTO users (id, handle, color, token, status, created_at, last_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        handleToId.get(u.handle), u.handle, u.color, u.token, u.status, u.created_at, u.last_active
      );
    }

    // Re-insert notes with author_id
    for (const n of oldNotes) {
      const authorId = handleToId.get(n.author_handle);
      if (!authorId) continue;
      this.sql.exec(
        `INSERT INTO notes (id, author_id, message, date, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        n.id, authorId, n.message, n.date, n.created_at
      );
    }

    // Re-insert exchanges with sender_id/recipient_id
    for (const e of oldExchanges) {
      const senderId = handleToId.get(e.sender_handle);
      const recipientId = handleToId.get(e.recipient_handle);
      if (!senderId || !recipientId) continue;
      this.sql.exec(
        `INSERT INTO exchanges (date, sender_id, recipient_id, note_id)
         VALUES (?, ?, ?, ?)`,
        e.date, senderId, recipientId, e.note_id
      );
    }
  }

  // --- User operations ---

  async createUser() {
    this.#ensureSchema();

    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const now = new Date().toISOString();

    let handle = this.#generateHandle();
    let attempts = 0;
    while (this.#handleExists(handle) && attempts < 10) {
      handle = this.#generateHandle() + Math.floor(Math.random() * 100);
      attempts++;
    }

    if (this.#handleExists(handle)) {
      return { error: 'Could not generate unique handle, please try again' };
    }

    this.sql.exec(
      `INSERT INTO users (id, handle, color, token, status, created_at, last_active)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      id, handle, color, token, now, now
    );

    return { id, handle, color, token };
  }

  async getUser(id) {
    this.#ensureSchema();
    const rows = this.sql.exec(
      'SELECT id, handle, color, status, created_at, last_active FROM users WHERE id = ?', id
    ).toArray();
    return rows[0] || null;
  }

  async getUserByHandle(handle) {
    this.#ensureSchema();
    const rows = this.sql.exec(
      'SELECT id, handle, color, status, created_at, last_active FROM users WHERE handle = ?', handle
    ).toArray();
    return rows[0] || null;
  }

  async getUserByToken(token) {
    this.#ensureSchema();
    const rows = this.sql.exec(
      'SELECT id, handle, color, status, created_at, last_active FROM users WHERE token = ?', token
    ).toArray();
    return rows[0] || null;
  }

  async updateHandle(userId, newHandle) {
    this.#ensureSchema();

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(newHandle)) {
      return { error: 'Handle must be 3-20 characters, alphanumeric + underscores only' };
    }

    if (this.#handleExists(newHandle)) {
      return { error: 'Handle already taken' };
    }

    // Single update — no cascade needed since notes/exchanges reference user ID
    this.sql.exec('UPDATE users SET handle = ? WHERE id = ?', newHandle, userId);
    return { ok: true, handle: newHandle };
  }

  async updateColor(userId, color) {
    this.#ensureSchema();

    if (!COLORS.includes(color)) {
      return { error: `Color must be one of: ${COLORS.join(', ')}` };
    }

    this.sql.exec('UPDATE users SET color = ? WHERE id = ?', color, userId);
    return { ok: true, color };
  }

  async setStatus(userId, status) {
    this.#ensureSchema();
    this.sql.exec('UPDATE users SET status = ? WHERE id = ?', status, userId);
    return { ok: true };
  }

  // --- Note operations ---

  async postNote(userId, message) {
    this.#ensureSchema();
    const today = utcDate();

    const existing = this.sql.exec(
      'SELECT id FROM notes WHERE author_id = ? AND date = ?', userId, today
    ).toArray();

    if (existing.length > 0) {
      return { error: 'Already posted today. Come back tomorrow!' };
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO notes (id, author_id, message, date, created_at) VALUES (?, ?, ?, ?, ?)`,
      id, userId, message, today, now
    );

    this.sql.exec('UPDATE users SET last_active = ? WHERE id = ?', now, userId);
    this.#matchExchange(userId, today);

    return { id, message, date: today };
  }

  async getInbox(userId) {
    this.#ensureSchema();
    const today = utcDate();

    const posted = this.sql.exec(
      'SELECT id FROM notes WHERE author_id = ? AND date = ?', userId, today
    ).toArray();

    if (posted.length === 0) {
      return { locked: true, message: 'Post your daily note first to unlock your inbox.' };
    }

    const rows = this.sql.exec(`
      SELECT e.note_id, u.handle, u.color, u.status, n.message, n.created_at
      FROM exchanges e
      JOIN notes n ON n.id = e.note_id
      JOIN users u ON u.id = e.sender_id
      WHERE e.date = ? AND e.recipient_id = ?
    `, today, userId).toArray();

    if (rows.length === 0) {
      return { waiting: true, message: 'No match yet — check back soon.' };
    }

    const row = rows[0];
    return {
      from: { handle: row.handle, color: row.color, status: row.status },
      note: { message: row.message, created_at: row.created_at },
    };
  }

  async getFeed(limit = 20, cursor = null, excludeUserId = null) {
    this.#ensureSchema();
    const today = utcDate();

    let rows;
    if (cursor && excludeUserId) {
      rows = this.sql.exec(`
        SELECT n.id, u.handle, u.color, u.status, n.message, n.created_at
        FROM notes n JOIN users u ON u.id = n.author_id
        WHERE n.date = ? AND n.created_at < ? AND n.author_id != ?
        ORDER BY n.created_at DESC LIMIT ?
      `, today, cursor, excludeUserId, limit).toArray();
    } else if (cursor) {
      rows = this.sql.exec(`
        SELECT n.id, u.handle, u.color, u.status, n.message, n.created_at
        FROM notes n JOIN users u ON u.id = n.author_id
        WHERE n.date = ? AND n.created_at < ?
        ORDER BY n.created_at DESC LIMIT ?
      `, today, cursor, limit).toArray();
    } else if (excludeUserId) {
      rows = this.sql.exec(`
        SELECT n.id, u.handle, u.color, u.status, n.message, n.created_at
        FROM notes n JOIN users u ON u.id = n.author_id
        WHERE n.date = ? AND n.author_id != ?
        ORDER BY n.created_at DESC LIMIT ?
      `, today, excludeUserId, limit).toArray();
    } else {
      rows = this.sql.exec(`
        SELECT n.id, u.handle, u.color, u.status, n.message, n.created_at
        FROM notes n JOIN users u ON u.id = n.author_id
        WHERE n.date = ?
        ORDER BY n.created_at DESC LIMIT ?
      `, today, limit).toArray();
    }

    const notes = rows.map(r => ({
      id: r.id,
      handle: r.handle,
      color: r.color,
      status: r.status,
      message: r.message,
      created_at: r.created_at,
    }));

    const nextCursor = notes.length === limit ? notes[notes.length - 1].created_at : null;
    return { notes, cursor: nextCursor };
  }

  // --- Rate limiting ---

  async checkIpLimit(ip, maxPerDay = 3) {
    this.#ensureSchema();
    const today = utcDate();

    this.sql.exec(
      `INSERT INTO account_limits (ip, date, count) VALUES (?, ?, 1)
       ON CONFLICT(ip, date) DO UPDATE SET count = count + 1`,
      ip, today
    );

    const rows = this.sql.exec(
      'SELECT count FROM account_limits WHERE ip = ? AND date = ?', ip, today
    ).toArray();

    const count = rows[0]?.count || 0;
    return { allowed: count <= maxPerDay, count };
  }

  // --- Stats ---

  async getStats() {
    this.#ensureSchema();

    const users = this.sql.exec('SELECT COUNT(*) as count FROM users').toArray();
    const notes = this.sql.exec(
      'SELECT COUNT(*) as count FROM notes WHERE date = ?', utcDate()
    ).toArray();

    return {
      totalUsers: users[0]?.count || 0,
      notesToday: notes[0]?.count || 0,
    };
  }

  // --- Private helpers ---

  #generateHandle() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    return adj + noun;
  }

  #handleExists(handle) {
    return this.sql.exec('SELECT 1 FROM users WHERE handle = ?', handle).toArray().length > 0;
  }

  #matchExchange(userId, date) {
    const candidates = this.sql.exec(`
      SELECT n.id, n.author_id FROM notes n
      WHERE n.date = ? AND n.author_id != ?
        AND n.author_id NOT IN (
          SELECT e.sender_id FROM exchanges e
          WHERE e.date = ? AND e.recipient_id = ?
        )
        AND ? NOT IN (
          SELECT e.sender_id FROM exchanges e
          WHERE e.date = ? AND e.recipient_id = n.author_id
        )
      ORDER BY RANDOM() LIMIT 1
    `, date, userId, date, userId, userId, date).toArray();

    if (candidates.length === 0) return;
    const candidate = candidates[0];

    // This user receives the candidate's note
    this.sql.exec(
      `INSERT OR IGNORE INTO exchanges (date, sender_id, recipient_id, note_id) VALUES (?, ?, ?, ?)`,
      date, candidate.author_id, userId, candidate.id
    );

    // The candidate receives this user's note
    const myNotes = this.sql.exec(
      'SELECT id FROM notes WHERE author_id = ? AND date = ?', userId, date
    ).toArray();

    if (myNotes.length > 0) {
      this.sql.exec(
        `INSERT OR IGNORE INTO exchanges (date, sender_id, recipient_id, note_id) VALUES (?, ?, ?, ?)`,
        date, userId, candidate.author_id, myNotes[0].id
      );
    }
  }
}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}
