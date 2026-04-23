import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../tools.js', () => ({
  MCP_TOOLS: [
    { id: 'cursor', name: 'Cursor' },
    { id: 'claude-code', name: 'Claude Code' },
    { id: 'windsurf', name: 'Windsurf' },
  ],
}));

vi.mock('../mcp-config.js', () => ({
  configureTool: vi.fn(),
}));

import { configureTool } from '../mcp-config.js';
import { runAdd } from '../commands/add.js';

let consoleLogSpy;
let processExitSpy;

beforeEach(() => {
  vi.clearAllMocks();
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  processExitSpy.mockRestore();
});

describe('runAdd', () => {
  it('configures a known MCP tool', async () => {
    configureTool.mockReturnValue({ ok: true, name: 'Cursor', detail: '.cursor/mcp.json' });

    await runAdd('cursor');

    expect(configureTool).toHaveBeenCalledWith(process.cwd(), 'cursor');
    const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
    expect(logCalls).toMatch(/Added Cursor: \.cursor\/mcp\.json/);
  });

  it('exits 1 when configuration fails', async () => {
    configureTool.mockReturnValue({ error: 'Permission denied' });

    await runAdd('cursor');

    const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
    expect(logCalls).toMatch(/Permission denied/);
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('suggests closest match for an unknown tool', async () => {
    await runAdd('wind');

    const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
    expect(logCalls).toMatch(/Did you mean "windsurf"/);
  });

  it('lists available tools when no tool arg is given', async () => {
    await runAdd(undefined);

    const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
    expect(logCalls).toMatch(/Usage: npx chinmeister add <tool>/);
    expect(logCalls).toMatch(/cursor/);
    expect(logCalls).toMatch(/windsurf/);
  });

  it('falls back to full list when no fuzzy match exists', async () => {
    await runAdd('zzzz-nothing-like-this');

    const logCalls = consoleLogSpy.mock.calls.flat().join('\n');
    expect(logCalls).toMatch(/Unknown tool "zzzz-nothing-like-this"/);
    expect(logCalls).toMatch(/Available tools/);
  });
});
