/**
 * Golden-fixture tests for the shipped parser specs.
 *
 * Before deleting the hand-written fallback parsers in conversation-collector.ts,
 * these tests lock in what the bundled specs (claude-code.json, aider.json) must
 * produce against realistic fixtures that mirror each tool's real log format.
 *
 * If a future spec edit drops signal, the relevant assertion breaks — not a
 * rolling-window health drift that takes 20 sessions to notice.
 *
 * We override each spec's `discovery` to a fixed-path pointing at the test
 * fixture; the discovery mechanism itself is covered by other tests and is
 * not what we're locking down here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { extract } from '../extraction/engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = resolve(__dirname, '../extraction/specs');

function fixtureRoot() {
  return join(
    tmpdir(),
    `chinwag-golden-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

function loadBundledSpec(toolId) {
  return JSON.parse(readFileSync(join(SPECS_DIR, `${toolId}.json`), 'utf-8'));
}

function withFixedPath(spec, relativePath) {
  return {
    ...spec,
    discovery: { strategy: 'fixed-path', relativePath },
  };
}

// ── Claude Code: realistic JSONL fixture ─────────────────────────────────
//
// Mirrors what Claude Code actually writes to ~/.claude/projects/<hash>/*.jsonl:
// human prompt → assistant response carrying message.usage and content blocks
// with tool_use → user entry carrying tool_result for that id → follow-up
// assistant with a second tool_use → user with tool_result (this one is an
// error) → final assistant text turn.

const CLAUDE_FIXTURE_LINES = [
  {
    type: 'human',
    timestamp: '2026-04-17T10:00:00Z',
    message: 'Refactor the auth module.',
  },
  {
    type: 'assistant',
    timestamp: '2026-04-17T10:00:05Z',
    message: {
      model: 'claude-opus-4-20250514',
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 120,
        output_tokens: 80,
        cache_read_input_tokens: 400,
        cache_creation_input_tokens: 50,
      },
      content: [
        { type: 'text', text: 'Reading auth.ts first.' },
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'Read',
          input: { file_path: '/repo/src/auth.ts' },
        },
      ],
    },
  },
  {
    type: 'user',
    timestamp: '2026-04-17T10:00:06Z',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tool_1',
        is_error: false,
        content: '...',
      },
    ],
  },
  {
    type: 'assistant',
    timestamp: '2026-04-17T10:00:10Z',
    message: {
      model: 'claude-opus-4-20250514',
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 60,
        output_tokens: 40,
        cache_read_input_tokens: 410,
        cache_creation_input_tokens: 10,
      },
      content: [
        {
          type: 'tool_use',
          id: 'tool_2',
          name: 'Bash',
          input: { command: 'npm test auth', description: 'run auth tests' },
        },
      ],
    },
  },
  {
    type: 'user',
    timestamp: '2026-04-17T10:00:12Z',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tool_2',
        is_error: true,
        content: 'FAIL auth.test.ts: expected x got y',
      },
    ],
  },
  {
    type: 'assistant',
    timestamp: '2026-04-17T10:00:15Z',
    message: {
      model: 'claude-opus-4-20250514',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 30,
        output_tokens: 90,
        cache_read_input_tokens: 420,
        cache_creation_input_tokens: 0,
      },
      content: [{ type: 'text', text: 'Test failed. Here is the fix.' }],
    },
  },
];

describe('golden: claude-code.json against realistic JSONL', () => {
  let dir;
  beforeEach(() => {
    dir = fixtureRoot();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'session.jsonl'),
      CLAUDE_FIXTURE_LINES.map((l) => JSON.stringify(l)).join('\n') + '\n',
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('extracts conversation events only for turns with text content', async () => {
    const spec = withFixedPath(loadBundledSpec('claude-code'), 'session.jsonl');
    const result = await extract(spec, dir, 0);

    // The human prompt + two assistant turns with text blocks. The middle
    // assistant entry is pure tool_use (no text), and both user tool_result
    // entries have array content with no text blocks — none are conversation
    // events, which is what we want (they're tool I/O, not dialog).
    expect(result.conversations.length).toBe(3);
    expect(result.conversations[0]).toMatchObject({
      role: 'user',
      sequence: 0,
      content: 'Refactor the auth module.',
    });
    expect(result.conversations[1]).toMatchObject({
      role: 'assistant',
      sequence: 1,
      stop_reason: 'tool_use',
      model: 'claude-opus-4-20250514',
      content: 'Reading auth.ts first.',
    });
    expect(result.conversations[2]).toMatchObject({
      role: 'assistant',
      sequence: 2,
      stop_reason: 'end_turn',
      content: 'Test failed. Here is the fix.',
    });
  });

  it('sums token usage across all assistant entries (Anthropic additive)', async () => {
    const spec = withFixedPath(loadBundledSpec('claude-code'), 'session.jsonl');
    const result = await extract(spec, dir, 0);

    expect(result.tokens).toEqual({
      input_tokens: 120 + 60 + 30,
      output_tokens: 80 + 40 + 90,
      cache_read_tokens: 400 + 410 + 420,
      cache_creation_tokens: 50 + 10 + 0,
    });
  });

  it('pairs tool_use with matching tool_result, preserving error state', async () => {
    const spec = withFixedPath(loadBundledSpec('claude-code'), 'session.jsonl');
    const result = await extract(spec, dir, 0);

    expect(result.toolCalls.length).toBe(2);
    const byName = Object.fromEntries(result.toolCalls.map((tc) => [tc.tool, tc]));
    expect(byName.Read).toMatchObject({ is_error: false });
    expect(byName.Read.input_preview).toBe('/repo/src/auth.ts');
    expect(byName.Bash).toMatchObject({ is_error: true });
    expect(byName.Bash.error_preview).toMatch(/FAIL auth/);
    // Duration comes from request → result timestamps.
    expect(byName.Read.duration_ms).toBeGreaterThan(0);
  });

  it('records parseHealth with zero malformed lines on clean fixture', async () => {
    const spec = withFixedPath(loadBundledSpec('claude-code'), 'session.jsonl');
    const result = await extract(spec, dir, 0);
    expect(result.parseHealth).toEqual({
      totalLines: CLAUDE_FIXTURE_LINES.length,
      parsedLines: CLAUDE_FIXTURE_LINES.length,
      malformedLines: 0,
    });
  });
});

// ── Aider: realistic markdown fixture ────────────────────────────────────
//
// Aider writes .aider.chat.history.md with #### markers for user prompts and
// > blockquote lines for assistant responses. Multi-line assistant responses
// continue with each line prefixed by `> `. A trailing user prompt with no
// assistant answer should still appear.

const AIDER_FIXTURE = `# aider chat started at 2026-04-17 10:00:00

> Hello! I'll help with your refactor.
> Let me start by reading auth.ts.

#### Refactor the auth module
please keep it backwards-compatible

> I've reviewed auth.ts. Here is my plan:
> 1. Extract validate()
> 2. Move session state to a class

#### Sounds good, proceed
`;

describe('golden: aider.json against realistic markdown', () => {
  let dir;
  beforeEach(() => {
    dir = fixtureRoot();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.aider.chat.history.md'), AIDER_FIXTURE);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('extracts alternating user and assistant messages in order', async () => {
    const spec = loadBundledSpec('aider'); // discovery already fixed-path
    const result = await extract(spec, dir, 0);

    expect(result.conversations.length).toBeGreaterThanOrEqual(3);
    const roles = result.conversations.map((c) => c.role);
    // First content is an assistant intro (blockquote at top), then user,
    // then assistant, then user.
    expect(roles).toEqual(['assistant', 'user', 'assistant', 'user']);
  });

  it('joins multi-line assistant blockquotes into one message', async () => {
    const spec = loadBundledSpec('aider');
    const result = await extract(spec, dir, 0);

    const secondAssistant = result.conversations.find(
      (c) => c.role === 'assistant' && c.content.includes('1. Extract validate()'),
    );
    expect(secondAssistant).toBeDefined();
    expect(secondAssistant.content).toMatch(/Here is my plan/);
    expect(secondAssistant.content).toMatch(/1\. Extract validate/);
    expect(secondAssistant.content).toMatch(/2\. Move session state/);
  });

  it('does not return tokens or tool calls for a markdown spec', async () => {
    const spec = loadBundledSpec('aider');
    const result = await extract(spec, dir, 0);
    expect(result.tokens).toBeNull();
    expect(result.toolCalls).toEqual([]);
    // Markdown path doesn't populate parseHealth — that field is JSONL-only.
    expect(result.parseHealth).toBeUndefined();
  });
});
