import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, utimesSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { extract } from '../extraction/engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function fixtureRoot() {
  return join(
    tmpdir(),
    `chinmeister-sqlite-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

/**
 * Build a DB whose shape mirrors Cursor's state.vscdb - a single cursorDiskKV
 * table with a JSON-encoded `value` column keyed by `bubbleId:*`. This is the
 * shape the cursor.json spec is going to target, so exercising it here
 * validates the whole per-os-path → SQLite → extraction chain.
 */
function makeCursorFixture(dbPath, rows) {
  const db = new Database(dbPath);
  db.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)');
  const stmt = db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)');
  for (const r of rows) stmt.run(r.key, JSON.stringify(r.value));
  db.close();
}

describe('extract(): SQLite source', () => {
  let dir;
  beforeEach(() => {
    dir = fixtureRoot();
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('queries cursorDiskKV, json_extracts nested fields, sums tokens', async () => {
    const dbPath = join(dir, 'state.vscdb');
    makeCursorFixture(dbPath, [
      {
        key: 'bubbleId:abc:1',
        value: {
          conversationId: 'abc',
          createdAt: 1713000000000,
          text: 'first prompt',
          modelInfo: { modelName: 'claude-3-5-sonnet' },
          tokenCount: { inputTokens: 100, outputTokens: 50 },
        },
      },
      {
        key: 'bubbleId:abc:2',
        value: {
          conversationId: 'abc',
          createdAt: 1713000100000,
          text: 'second prompt',
          modelInfo: { modelName: 'claude-3-5-sonnet' },
          tokenCount: { inputTokens: 30, outputTokens: 20 },
        },
      },
      // Non-bubble row to confirm the LIKE filter in the query works
      {
        key: 'otherKey',
        value: { unrelated: true },
      },
    ]);
    // Ensure the DB mtime is in the past+ so the startedAt=0 gate accepts it.
    utimesSync(dbPath, new Date(), new Date());

    const spec = {
      version: 1,
      tool: 'cursor-test',
      format: 'sqlite',
      discovery: {
        strategy: 'per-os-path',
        paths: { darwin: dbPath, linux: dbPath, win32: dbPath },
      },
      sqlite: {
        table: 'cursorDiskKV',
        query: `
          SELECT
            json_extract(value, '$.conversationId') AS session_id,
            json_extract(value, '$.createdAt')      AS timestamp,
            json_extract(value, '$.text')           AS content,
            json_extract(value, '$.modelInfo.modelName') AS model,
            json_extract(value, '$.tokenCount.inputTokens')  AS input_tokens,
            json_extract(value, '$.tokenCount.outputTokens') AS output_tokens
          FROM cursorDiskKV
          WHERE key LIKE 'bubbleId:%'
          ORDER BY timestamp ASC
        `,
      },
      extractions: {
        tokens: {
          // empty usagePath → token fields are directly on the entry (row)
          usagePath: '',
          fieldMapping: {
            input_tokens: 'input_tokens',
            output_tokens: 'output_tokens',
          },
          normalization: 'anthropic',
        },
      },
      generatedAt: '2026-04-19T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);

    expect(result.tokens).toEqual({
      input_tokens: 130,
      output_tokens: 70,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    });
  });

  it('rejects unsafe queries and returns empty result without opening DB', async () => {
    const dbPath = join(dir, 'state.vscdb');
    makeCursorFixture(dbPath, [
      {
        key: 'bubbleId:abc:1',
        value: { tokenCount: { inputTokens: 10, outputTokens: 5 } },
      },
    ]);
    utimesSync(dbPath, new Date(), new Date());

    const spec = {
      version: 1,
      tool: 'cursor-unsafe',
      format: 'sqlite',
      discovery: {
        strategy: 'per-os-path',
        paths: { darwin: dbPath, linux: dbPath, win32: dbPath },
      },
      sqlite: {
        table: 'cursorDiskKV',
        // Multi-statement - must be rejected by the safety guard
        query: 'SELECT 1; DROP TABLE cursorDiskKV',
      },
      extractions: {
        tokens: {
          usagePath: '',
          fieldMapping: { input_tokens: 'input_tokens', output_tokens: 'output_tokens' },
          normalization: 'anthropic',
        },
      },
      generatedAt: '2026-04-19T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    // Unsafe query blocked → no entries → no tokens
    expect(result.tokens).toBeNull();
  });
});

describe('extract(): modelState pre-pass (Option A)', () => {
  let dir;
  beforeEach(() => {
    dir = fixtureRoot();
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('carries model from session.model_change into subsequent assistant entries', async () => {
    // Copilot-shaped JSONL: model is set on a dedicated event line and applies
    // to every subsequent message until the next change event.
    const { writeFileSync } = await import('fs');
    const logPath = join(dir, 'events.jsonl');
    const lines = [
      JSON.stringify({ type: 'session.model_change', data: { newModel: 'gpt-5' } }),
      JSON.stringify({ type: 'user.message', data: { content: 'hello' } }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'hi there', outputTokens: 42, messageId: 'm1' },
      }),
      JSON.stringify({ type: 'session.model_change', data: { newModel: 'claude-4-5' } }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'second', outputTokens: 7, messageId: 'm2' },
      }),
    ];
    writeFileSync(logPath, lines.join('\n') + '\n');

    const spec = {
      version: 1,
      tool: 'copilot-test',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'events.jsonl' },
      prepass: {
        modelState: {
          carryFromEvent: 'session.model_change',
          carryFromPath: 'data.newModel',
          carryTargetPath: 'model',
        },
      },
      extractions: {
        conversation: {
          roleDetection: {
            field: 'type',
            userValues: ['user.message'],
            assistantValues: ['assistant.message'],
          },
          contentPaths: ['data.content'],
          modelPath: 'model',
        },
      },
      generatedAt: '2026-04-19T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    expect(result.conversations).toHaveLength(3);
    expect(result.conversations[0]).toMatchObject({
      role: 'user',
      content: 'hello',
      model: 'gpt-5',
    });
    expect(result.conversations[1]).toMatchObject({
      role: 'assistant',
      content: 'hi there',
      model: 'gpt-5',
    });
    expect(result.conversations[2]).toMatchObject({
      role: 'assistant',
      content: 'second',
      model: 'claude-4-5',
    });
  });

  it('shipped cursor.json spec extracts tokens and conversation from a Cursor-shaped DB', async () => {
    const dir = fixtureRoot();
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, 'state.vscdb');
    const nowMs = Date.now();
    makeCursorFixture(dbPath, [
      {
        key: 'bubbleId:conv1:1',
        value: {
          conversationId: 'conv1',
          createdAt: nowMs - 60_000,
          text: 'refactor the auth module',
          modelInfo: { modelName: 'claude-4-5-sonnet' },
          tokenCount: { inputTokens: 500, outputTokens: 200 },
        },
      },
      {
        key: 'bubbleId:conv1:2',
        value: {
          conversationId: 'conv1',
          createdAt: nowMs - 30_000,
          text: 'add tests for the new helper',
          modelInfo: { modelName: 'claude-4-5-sonnet' },
          tokenCount: { inputTokens: 220, outputTokens: 90 },
        },
      },
    ]);
    utimesSync(dbPath, new Date(), new Date());

    // Load the real shipped spec so we're testing exactly what users run
    const specPath = join(__dirname, '..', 'extraction', 'specs', 'cursor.json');
    const spec = JSON.parse(readFileSync(specPath, 'utf-8'));
    // Redirect per-os paths at the fixture DB (the shipped paths point at the
    // user's real Cursor DB which we don't want to touch in tests)
    spec.discovery.paths = { darwin: dbPath, linux: dbPath, win32: dbPath };

    const result = await extract(spec, dir, 0);

    expect(result.tokens).toEqual({
      input_tokens: 720,
      output_tokens: 290,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    });
    expect(result.conversations).toHaveLength(2);
    expect(result.conversations[0]).toMatchObject({
      role: 'user',
      content: 'refactor the auth module',
      model: 'claude-4-5-sonnet',
      input_tokens: 500,
      output_tokens: 200,
    });
    expect(result.conversations[1]).toMatchObject({
      role: 'user',
      content: 'add tests for the new helper',
      model: 'claude-4-5-sonnet',
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it('shipped copilot.json spec extracts messages + model carry + output tokens', async () => {
    const { writeFileSync } = await import('fs');
    const dir = fixtureRoot();
    const sessionDir = join(dir, 'session-abc');
    mkdirSync(sessionDir, { recursive: true });
    const logPath = join(sessionDir, 'events.jsonl');
    const lines = [
      JSON.stringify({ type: 'session.model_change', data: { newModel: 'gpt-5' } }),
      JSON.stringify({ type: 'user.message', data: { content: 'refactor auth' } }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'done', outputTokens: 120, messageId: 'm1' },
      }),
      JSON.stringify({ type: 'session.model_change', data: { newModel: 'claude-4-5' } }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'also fixed tests', outputTokens: 35, messageId: 'm2' },
      }),
    ];
    writeFileSync(logPath, lines.join('\n') + '\n');

    const specPath = join(__dirname, '..', 'extraction', 'specs', 'copilot.json');
    const spec = JSON.parse(readFileSync(specPath, 'utf-8'));
    spec.discovery.baseDir = dir; // redirect from ~/.copilot/session-state/ to the fixture

    const result = await extract(spec, dir, 0);
    expect(result.conversations).toHaveLength(3);
    expect(result.conversations[0]).toMatchObject({
      role: 'user',
      content: 'refactor auth',
      model: 'gpt-5',
    });
    expect(result.conversations[1]).toMatchObject({
      role: 'assistant',
      content: 'done',
      model: 'gpt-5',
    });
    expect(result.conversations[2]).toMatchObject({
      role: 'assistant',
      content: 'also fixed tests',
      model: 'claude-4-5',
    });
    // Output tokens sum across assistant messages; input is absent from Copilot so stays 0.
    expect(result.tokens).toEqual({
      input_tokens: 0,
      output_tokens: 155,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves the model field alone when the entry already has one', async () => {
    const { writeFileSync } = await import('fs');
    const logPath = join(dir, 'events.jsonl');
    const lines = [
      JSON.stringify({ type: 'session.model_change', data: { newModel: 'carry-model' } }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'x', outputTokens: 1, messageId: 'm1' },
        model: 'entry-model', // tool-emitted model on the entry itself
      }),
    ];
    writeFileSync(logPath, lines.join('\n') + '\n');

    const spec = {
      version: 1,
      tool: 'copilot-priority',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'events.jsonl' },
      prepass: {
        modelState: {
          carryFromEvent: 'session.model_change',
          carryFromPath: 'data.newModel',
        },
      },
      extractions: {
        conversation: {
          roleDetection: {
            field: 'type',
            userValues: [],
            assistantValues: ['assistant.message'],
          },
          contentPaths: ['data.content'],
          modelPath: 'model',
        },
      },
      generatedAt: '2026-04-19T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    expect(result.conversations[0].model).toBe('entry-model');
  });
});
