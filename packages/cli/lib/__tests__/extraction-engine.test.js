import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { extract } from '../extraction/engine.js';

function fixtureRoot() {
  return join(
    tmpdir(),
    `chinwag-engine-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

describe('extract(): JSONL Anthropic tokens', () => {
  let dir;
  beforeEach(() => {
    dir = fixtureRoot();
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('sums additive token fields across entries', async () => {
    const file = join(dir, '.aider.chat.history.md'); // any fixed path works for this test
    const log = join(dir, 'session.jsonl');
    void file;
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 200,
            cache_creation_input_tokens: 75,
          },
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 40,
            output_tokens: 30,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 5,
          },
        },
      }),
    ];
    writeFileSync(log, lines.join('\n') + '\n');

    const spec = {
      version: 1,
      tool: 'test',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'session.jsonl' },
      extractions: {
        tokens: {
          usagePath: 'message.usage',
          fieldMapping: {
            input_tokens: 'input_tokens',
            output_tokens: 'output_tokens',
            cache_read_tokens: 'cache_read_input_tokens',
            cache_creation_tokens: 'cache_creation_input_tokens',
          },
          normalization: 'anthropic',
        },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    expect(result.tokens).toEqual({
      input_tokens: 140,
      output_tokens: 80,
      cache_read_tokens: 210,
      cache_creation_tokens: 80,
    });
  });

  it('tries usagePathFallbacks when primary path missing', async () => {
    const log = join(dir, 'session.jsonl');
    writeFileSync(
      log,
      JSON.stringify({
        type: 'assistant',
        usage: { input_tokens: 5, output_tokens: 3 },
      }) + '\n',
    );

    const spec = {
      version: 1,
      tool: 'test',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'session.jsonl' },
      extractions: {
        tokens: {
          usagePath: 'message.usage',
          usagePathFallbacks: ['usage'],
          fieldMapping: { input_tokens: 'input_tokens', output_tokens: 'output_tokens' },
          normalization: 'anthropic',
        },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    expect(result.tokens).toEqual({
      input_tokens: 5,
      output_tokens: 3,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    });
  });

  it('skips malformed JSONL lines without crashing', async () => {
    const log = join(dir, 'session.jsonl');
    const lines = [
      JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }),
      '{ broken json',
      '',
      JSON.stringify({ usage: { input_tokens: 20, output_tokens: 15 } }),
    ];
    writeFileSync(log, lines.join('\n') + '\n');

    const spec = {
      version: 1,
      tool: 'test',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'session.jsonl' },
      extractions: {
        tokens: {
          usagePath: 'usage',
          fieldMapping: { input_tokens: 'input_tokens', output_tokens: 'output_tokens' },
          normalization: 'anthropic',
        },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    expect(result.tokens?.input_tokens).toBe(30);
    expect(result.tokens?.output_tokens).toBe(20);
  });

  it('returns null tokens when all values are zero', async () => {
    const log = join(dir, 'session.jsonl');
    writeFileSync(log, JSON.stringify({ usage: { input_tokens: 0, output_tokens: 0 } }) + '\n');

    const spec = {
      version: 1,
      tool: 'test',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'session.jsonl' },
      extractions: {
        tokens: {
          usagePath: 'usage',
          fieldMapping: { input_tokens: 'input_tokens', output_tokens: 'output_tokens' },
          normalization: 'anthropic',
        },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    expect(result.tokens).toBeNull();
  });
});

describe('extract(): JSONL OpenAI tokens', () => {
  let dir;
  beforeEach(() => {
    dir = fixtureRoot();
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('subtracts cached from input under openai normalization', async () => {
    const log = join(dir, 'rollout.jsonl');
    const entry = {
      usage: {
        input_tokens: 1000,
        cached_input_tokens: 300,
        output_tokens: 250,
      },
    };
    writeFileSync(log, JSON.stringify(entry) + '\n');

    const spec = {
      version: 1,
      tool: 'codex',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'rollout.jsonl' },
      extractions: {
        tokens: {
          usagePath: 'usage',
          fieldMapping: {
            input_tokens: 'input_tokens',
            output_tokens: 'output_tokens',
            cache_read_tokens: 'cached_input_tokens',
          },
          normalization: 'openai',
        },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    expect(result.tokens).toEqual({
      input_tokens: 700,
      output_tokens: 250,
      cache_read_tokens: 300,
      cache_creation_tokens: 0,
    });
  });

  it('never underflows input_tokens below zero', async () => {
    const log = join(dir, 'rollout.jsonl');
    const entry = { usage: { input_tokens: 10, cached_input_tokens: 50, output_tokens: 5 } };
    writeFileSync(log, JSON.stringify(entry) + '\n');

    const spec = {
      version: 1,
      tool: 'codex',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'rollout.jsonl' },
      extractions: {
        tokens: {
          usagePath: 'usage',
          fieldMapping: {
            input_tokens: 'input_tokens',
            output_tokens: 'output_tokens',
            cache_read_tokens: 'cached_input_tokens',
          },
          normalization: 'openai',
        },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    expect(result.tokens?.input_tokens).toBe(0);
    expect(result.tokens?.cache_read_tokens).toBe(50);
  });
});

describe('extract(): conversation extraction from JSONL', () => {
  let dir;
  beforeEach(() => {
    dir = fixtureRoot();
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('extracts role + content, skips entries without either', async () => {
    const log = join(dir, 'chat.jsonl');
    const lines = [
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
      JSON.stringify({ type: 'assistant', message: { content: 'hi there' } }),
      JSON.stringify({ type: 'system', message: { content: 'ignored' } }),
      JSON.stringify({ type: 'user', message: { content: '' } }),
    ];
    writeFileSync(log, lines.join('\n') + '\n');

    const spec = {
      version: 1,
      tool: 'test',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'chat.jsonl' },
      extractions: {
        conversation: {
          roleDetection: {
            field: 'type',
            userValues: ['user'],
            assistantValues: ['assistant'],
          },
          contentPaths: ['message.content'],
        },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    expect(result.conversations).toHaveLength(2);
    expect(result.conversations[0]).toMatchObject({ role: 'user', content: 'hello', sequence: 0 });
    expect(result.conversations[1]).toMatchObject({
      role: 'assistant',
      content: 'hi there',
      sequence: 1,
    });
  });

  it('joins text blocks when content is an array', async () => {
    const log = join(dir, 'chat.jsonl');
    const entry = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'first line' },
          { type: 'tool_use', input: {} },
          { type: 'text', text: 'second line' },
        ],
      },
    };
    writeFileSync(log, JSON.stringify(entry) + '\n');

    const spec = {
      version: 1,
      tool: 'test',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'chat.jsonl' },
      extractions: {
        conversation: {
          roleDetection: {
            field: 'type',
            userValues: ['user'],
            assistantValues: ['assistant'],
          },
          contentPaths: ['message.content'],
        },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    expect(result.conversations[0].content).toBe('first line\nsecond line');
  });
});

describe('extract(): tool call pairing', () => {
  let dir;
  beforeEach(() => {
    dir = fixtureRoot();
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('pairs tool_use with tool_result by id and computes duration', async () => {
    const log = join(dir, 'calls.jsonl');
    const lines = [
      JSON.stringify({
        timestamp: '2026-04-17T12:00:00.000Z',
        message: {
          content: [
            { type: 'tool_use', id: 'call-1', name: 'Edit', input: { file_path: '/a.ts' } },
          ],
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-17T12:00:00.500Z',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call-1',
              is_error: false,
            },
          ],
        },
      }),
    ];
    writeFileSync(log, lines.join('\n') + '\n');

    const spec = {
      version: 1,
      tool: 'test',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'calls.jsonl' },
      extractions: {
        toolCalls: {
          requestBlock: {
            contentPath: 'message.content',
            typeValue: 'tool_use',
            namePath: 'name',
            idPath: 'id',
            inputPreviewPaths: ['input.file_path'],
          },
          resultBlock: {
            typeValue: 'tool_result',
            idPath: 'tool_use_id',
            errorPath: 'is_error',
            errorContentPath: 'content',
          },
        },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    expect(result.toolCalls).toHaveLength(1);
    const call = result.toolCalls[0];
    expect(call.tool).toBe('Edit');
    expect(call.is_error).toBe(false);
    expect(call.input_preview).toBe('/a.ts');
    expect(call.duration_ms).toBe(500);
  });

  it('captures error preview when result has is_error true', async () => {
    const log = join(dir, 'calls.jsonl');
    const lines = [
      JSON.stringify({
        timestamp: '2026-04-17T12:00:00.000Z',
        message: {
          content: [{ type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'npm test' } }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-17T12:00:01.000Z',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'c1',
              is_error: true,
              content: 'permission denied: /etc/passwd',
            },
          ],
        },
      }),
    ];
    writeFileSync(log, lines.join('\n') + '\n');

    const spec = {
      version: 1,
      tool: 'test',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'calls.jsonl' },
      extractions: {
        toolCalls: {
          requestBlock: {
            contentPath: 'message.content',
            typeValue: 'tool_use',
            namePath: 'name',
            idPath: 'id',
            inputPreviewPaths: ['input.command'],
          },
          resultBlock: {
            typeValue: 'tool_result',
            idPath: 'tool_use_id',
            errorPath: 'is_error',
            errorContentPath: 'content',
          },
        },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].is_error).toBe(true);
    expect(result.toolCalls[0].error_preview).toBe('permission denied: /etc/passwd');
  });

  it('includes unmatched tool_use with unknown result state', async () => {
    const log = join(dir, 'calls.jsonl');
    writeFileSync(
      log,
      JSON.stringify({
        timestamp: '2026-04-17T12:00:00.000Z',
        message: {
          content: [{ type: 'tool_use', id: 'orphan', name: 'Read' }],
        },
      }) + '\n',
    );

    const spec = {
      version: 1,
      tool: 'test',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'calls.jsonl' },
      extractions: {
        toolCalls: {
          requestBlock: {
            contentPath: 'message.content',
            typeValue: 'tool_use',
            namePath: 'name',
            idPath: 'id',
            inputPreviewPaths: [],
          },
          resultBlock: {
            typeValue: 'tool_result',
            idPath: 'tool_use_id',
            errorPath: 'is_error',
            errorContentPath: 'content',
          },
        },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].tool).toBe('Read');
    expect(result.toolCalls[0].is_error).toBe(false);
    expect(result.toolCalls[0].duration_ms).toBeUndefined();
  });
});

describe('extract(): markdown conversation extraction', () => {
  let dir;
  beforeEach(() => {
    dir = fixtureRoot();
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('splits Aider-style markdown by user/assistant markers', async () => {
    const log = join(dir, '.aider.chat.history.md');
    const content = `#### user
please fix the bug

#### assistant
Looking at the code now.
Found the issue on line 42.

#### user
Thanks!
`;
    writeFileSync(log, content);

    const spec = {
      version: 1,
      tool: 'aider',
      format: 'markdown',
      discovery: { strategy: 'fixed-path', relativePath: '.aider.chat.history.md' },
      extractions: {
        conversation: {
          userMarker: '#### user',
          assistantMarker: '#### assistant',
        },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    expect(result.conversations).toHaveLength(3);
    expect(result.conversations[0]).toMatchObject({ role: 'user', content: 'please fix the bug' });
    expect(result.conversations[1]).toMatchObject({
      role: 'assistant',
      content: 'Looking at the code now.\nFound the issue on line 42.',
    });
    expect(result.conversations[2]).toMatchObject({ role: 'user', content: 'Thanks!' });
  });
});

describe('extract(): no discoverable file', () => {
  it('returns empty result when fixed-path file is missing', async () => {
    const dir = fixtureRoot();
    mkdirSync(dir, { recursive: true });

    const spec = {
      version: 1,
      tool: 'test',
      format: 'jsonl',
      discovery: { strategy: 'fixed-path', relativePath: 'missing.jsonl' },
      extractions: {
        tokens: {
          usagePath: 'usage',
          fieldMapping: { input_tokens: 'input_tokens', output_tokens: 'output_tokens' },
          normalization: 'anthropic',
        },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };

    const result = await extract(spec, dir, 0);
    expect(result).toEqual({ conversations: [], tokens: null, toolCalls: [] });

    rmSync(dir, { recursive: true, force: true });
  });
});

describe('extract(): JSONL parse health', () => {
  let dir;
  beforeEach(() => {
    dir = fixtureRoot();
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function writeJsonl(filename, lines) {
    writeFileSync(join(dir, filename), lines.join('\n') + '\n');
  }

  const baseSpec = {
    version: 1,
    tool: 'test',
    format: 'jsonl',
    discovery: { strategy: 'fixed-path', relativePath: 'session.jsonl' },
    extractions: {
      tokens: {
        usagePath: 'usage',
        fieldMapping: { input_tokens: 'input_tokens', output_tokens: 'output_tokens' },
        normalization: 'anthropic',
      },
    },
    generatedAt: '2026-04-17T00:00:00Z',
    source: 'manual',
  };

  it('reports parseHealth with zero malformed on clean input', async () => {
    writeJsonl('session.jsonl', [
      JSON.stringify({ usage: { input_tokens: 1, output_tokens: 2 } }),
      JSON.stringify({ usage: { input_tokens: 3, output_tokens: 4 } }),
    ]);
    const result = await extract(baseSpec, dir, 0);
    expect(result.parseHealth).toEqual({
      totalLines: 2,
      parsedLines: 2,
      malformedLines: 0,
    });
  });

  it('counts malformed lines without aborting extraction', async () => {
    writeJsonl('session.jsonl', [
      JSON.stringify({ usage: { input_tokens: 1, output_tokens: 2 } }),
      'this is not json',
      JSON.stringify({ usage: { input_tokens: 3, output_tokens: 4 } }),
      '{ unclosed',
    ]);
    const result = await extract(baseSpec, dir, 0);
    expect(result.parseHealth).toEqual({
      totalLines: 4,
      parsedLines: 2,
      malformedLines: 2,
    });
    // Valid entries still contribute to tokens — malformed lines are skipped,
    // not fatal.
    expect(result.tokens).toEqual({
      input_tokens: 4,
      output_tokens: 6,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    });
  });

  it('ignores blank lines when computing parse health', async () => {
    const content = [
      JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }),
      '',
      '   ',
      JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }),
    ].join('\n');
    writeFileSync(join(dir, 'session.jsonl'), content);
    const result = await extract(baseSpec, dir, 0);
    expect(result.parseHealth).toEqual({
      totalLines: 2,
      parsedLines: 2,
      malformedLines: 0,
    });
  });

  it('omits parseHealth for markdown specs', async () => {
    writeFileSync(join(dir, '.aider.chat.history.md'), '#### hi\n> there\n');
    const mdSpec = {
      version: 1,
      tool: 'test-md',
      format: 'markdown',
      discovery: { strategy: 'fixed-path', relativePath: '.aider.chat.history.md' },
      extractions: {
        conversation: { userMarker: '#### ', assistantMarker: '> ' },
      },
      generatedAt: '2026-04-17T00:00:00Z',
      source: 'manual',
    };
    const result = await extract(mdSpec, dir, 0);
    expect(result.parseHealth).toBeUndefined();
  });
});
