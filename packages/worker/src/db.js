// Database Durable Object — single instance holding all persistent data in SQLite.
// Accessed via RPC-style fetch calls from the Worker.

const COLORS = ['red', 'cyan', 'yellow', 'green', 'magenta', 'blue'];

// Word lists for random handle generation
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

export class DatabaseDO {
  constructor(state, env) {
    this.state = state;
    this.sql = state.storage.sql;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        handle TEXT PRIMARY KEY,
        color TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        status TEXT,
        created_at TEXT NOT NULL,
        last_active TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        author_handle TEXT NOT NULL,
        message TEXT NOT NULL,
        date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notes_author_date ON notes(author_handle, date);

      CREATE TABLE IF NOT EXISTS exchanges (
        date TEXT NOT NULL,
        sender_handle TEXT NOT NULL,
        recipient_handle TEXT NOT NULL,
        note_id TEXT NOT NULL,
        PRIMARY KEY (date, recipient_handle)
      );
    `);

    this.initialized = true;
  }

  async fetch(request) {
    await this.initialize();

    const { method, args } = await request.json();

    switch (method) {
      case 'createUser':
        return json(this.createUser(args[0]));
      case 'getUser':
        return json(this.getUser(args[0]));
      case 'updateHandle':
        return json(this.updateHandle(args[0], args[1]));
      case 'updateColor':
        return json(this.updateColor(args[0], args[1]));
      case 'postNote':
        return json(this.postNote(args[0], args[1]));
      case 'getInbox':
        return json(this.getInbox(args[0]));
      case 'getFeed':
        return json(this.getFeed(args[0], args[1], args[2]));
      case 'setStatus':
        return json(this.setStatus(args[0], args[1]));
      case 'getStats':
        return json(this.getStats());
      default:
        return json({ error: 'Unknown method' }, 400);
    }
  }

  createUser(opts = {}) {
    const token = crypto.randomUUID();
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const now = new Date().toISOString();

    // Generate a unique handle
    let handle = this.generateHandle();
    let attempts = 0;
    while (this.handleExists(handle) && attempts < 10) {
      // Append random suffix on collision
      const suffix = Math.floor(Math.random() * 100);
      handle = this.generateHandle() + suffix;
      attempts++;
    }

    if (this.handleExists(handle)) {
      return { error: 'Could not generate unique handle, please try again' };
    }

    this.sql.exec(
      `INSERT INTO users (handle, color, token, status, created_at, last_active)
       VALUES (?, ?, ?, NULL, ?, ?)`,
      handle, color, token, now, now
    );

    return { handle, color, token };
  }

  generateHandle() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    return adj + noun;
  }

  handleExists(handle) {
    const rows = this.sql.exec('SELECT 1 FROM users WHERE handle = ?', handle).toArray();
    return rows.length > 0;
  }

  getUser(handle) {
    const rows = this.sql.exec(
      'SELECT handle, color, status, created_at, last_active FROM users WHERE handle = ?',
      handle
    ).toArray();
    return rows[0] || null;
  }

  updateHandle(oldHandle, newHandle) {
    // Validate format
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(newHandle)) {
      return { error: 'Handle must be 3-20 characters, alphanumeric + underscores only' };
    }

    if (this.handleExists(newHandle)) {
      return { error: 'Handle already taken' };
    }

    this.sql.exec('UPDATE users SET handle = ? WHERE handle = ?', newHandle, oldHandle);
    this.sql.exec('UPDATE notes SET author_handle = ? WHERE author_handle = ?', newHandle, oldHandle);
    this.sql.exec(
      'UPDATE exchanges SET sender_handle = ? WHERE sender_handle = ?',
      newHandle, oldHandle
    );
    this.sql.exec(
      'UPDATE exchanges SET recipient_handle = ? WHERE recipient_handle = ?',
      newHandle, oldHandle
    );

    return { ok: true, handle: newHandle };
  }

  updateColor(handle, color) {
    if (!COLORS.includes(color)) {
      return { error: `Color must be one of: ${COLORS.join(', ')}` };
    }
    this.sql.exec('UPDATE users SET color = ? WHERE handle = ?', color, handle);
    return { ok: true, color };
  }

  postNote(authorHandle, message) {
    const today = utcDate();

    // Check if already posted today
    const existingRows = this.sql.exec(
      'SELECT id FROM notes WHERE author_handle = ? AND date = ?',
      authorHandle, today
    ).toArray();

    if (existingRows.length > 0) {
      return { error: 'Already posted today. Come back tomorrow!' };
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO notes (id, author_handle, message, date, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      id, authorHandle, message, today, now
    );

    // Update last_active
    this.sql.exec('UPDATE users SET last_active = ? WHERE handle = ?', now, authorHandle);

    // Try to match with a random note from another user who hasn't been matched yet today
    this.matchExchange(authorHandle, today);

    return { id, message, date: today };
  }

  matchExchange(handle, date) {
    // Find a note from another user today that hasn't been given to this user
    // and whose author hasn't received this user's note
    const candidates = this.sql.exec(`
      SELECT n.id, n.author_handle FROM notes n
      WHERE n.date = ? AND n.author_handle != ?
        AND n.author_handle NOT IN (
          SELECT e.sender_handle FROM exchanges e
          WHERE e.date = ? AND e.recipient_handle = ?
        )
        AND ? NOT IN (
          SELECT e.sender_handle FROM exchanges e
          WHERE e.date = ? AND e.recipient_handle = n.author_handle
        )
      ORDER BY RANDOM()
      LIMIT 1
    `, date, handle, date, handle, handle, date).toArray();

    if (candidates.length === 0) return; // No match available yet
    const candidate = candidates[0];

    // Create bidirectional exchange
    // This user receives the candidate's note
    this.sql.exec(
      `INSERT OR IGNORE INTO exchanges (date, sender_handle, recipient_handle, note_id)
       VALUES (?, ?, ?, ?)`,
      date, candidate.author_handle, handle, candidate.id
    );

    // The candidate receives this user's note
    const myNotes = this.sql.exec(
      'SELECT id FROM notes WHERE author_handle = ? AND date = ?',
      handle, date
    ).toArray();

    if (myNotes.length > 0) {
      const myNote = myNotes[0];
      this.sql.exec(
        `INSERT OR IGNORE INTO exchanges (date, sender_handle, recipient_handle, note_id)
         VALUES (?, ?, ?, ?)`,
        date, handle, candidate.author_handle, myNote.id
      );
    }
  }

  getInbox(handle) {
    const today = utcDate();

    // Check if user has posted today
    const postedRows = this.sql.exec(
      'SELECT id FROM notes WHERE author_handle = ? AND date = ?',
      handle, today
    ).toArray();

    if (postedRows.length === 0) {
      return { locked: true, message: 'Post your daily note first to unlock your inbox.' };
    }

    // Check for exchange
    const exchangeRows = this.sql.exec(
      `SELECT e.note_id, e.sender_handle, n.message, n.created_at, u.color, u.status
       FROM exchanges e
       JOIN notes n ON n.id = e.note_id
       JOIN users u ON u.handle = e.sender_handle
       WHERE e.date = ? AND e.recipient_handle = ?`,
      today, handle
    ).toArray();

    if (exchangeRows.length === 0) {
      return { waiting: true, message: 'No match yet — check back soon.' };
    }

    const exchange = exchangeRows[0];
    return {
      from: {
        handle: exchange.sender_handle,
        color: exchange.color,
        status: exchange.status,
      },
      note: {
        message: exchange.message,
        created_at: exchange.created_at,
      },
    };
  }

  getFeed(limit = 20, cursor = null, excludeHandle = null) {
    const today = utcDate();

    let rows;
    if (cursor && excludeHandle) {
      rows = this.sql.exec(
        `SELECT n.id, n.author_handle, n.message, n.created_at, u.color, u.status
         FROM notes n
         JOIN users u ON u.handle = n.author_handle
         WHERE n.date = ? AND n.created_at < ? AND n.author_handle != ?
         ORDER BY n.created_at DESC
         LIMIT ?`,
        today, cursor, excludeHandle, limit
      ).toArray();
    } else if (cursor) {
      rows = this.sql.exec(
        `SELECT n.id, n.author_handle, n.message, n.created_at, u.color, u.status
         FROM notes n
         JOIN users u ON u.handle = n.author_handle
         WHERE n.date = ? AND n.created_at < ?
         ORDER BY n.created_at DESC
         LIMIT ?`,
        today, cursor, limit
      ).toArray();
    } else if (excludeHandle) {
      rows = this.sql.exec(
        `SELECT n.id, n.author_handle, n.message, n.created_at, u.color, u.status
         FROM notes n
         JOIN users u ON u.handle = n.author_handle
         WHERE n.date = ? AND n.author_handle != ?
         ORDER BY n.created_at DESC
         LIMIT ?`,
        today, excludeHandle, limit
      ).toArray();
    } else {
      rows = this.sql.exec(
        `SELECT n.id, n.author_handle, n.message, n.created_at, u.color, u.status
         FROM notes n
         JOIN users u ON u.handle = n.author_handle
         WHERE n.date = ?
         ORDER BY n.created_at DESC
         LIMIT ?`,
        today, limit
      ).toArray();
    }

    const notes = rows.map(r => ({
      id: r.id,
      handle: r.author_handle,
      color: r.color,
      status: r.status,
      message: r.message,
      created_at: r.created_at,
    }));

    const nextCursor = notes.length === limit ? notes[notes.length - 1].created_at : null;

    return { notes, cursor: nextCursor };
  }

  setStatus(handle, status) {
    this.sql.exec('UPDATE users SET status = ? WHERE handle = ?', status, handle);
    return { ok: true };
  }

  getStats() {
    const users = this.sql.exec('SELECT COUNT(*) as count FROM users').toArray();
    const notes = this.sql.exec(
      'SELECT COUNT(*) as count FROM notes WHERE date = ?',
      utcDate()
    ).toArray();

    return {
      totalUsers: users[0]?.count || 0,
      notesToday: notes[0]?.count || 0,
    };
  }
}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
