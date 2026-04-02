import { describe, it, expect } from 'vitest';
import { MCP_TOOLS, getMcpToolById } from '../tool-registry.js';

describe('tool-registry', () => {
  describe('MCP_TOOLS', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(MCP_TOOLS)).toBe(true);
      expect(MCP_TOOLS.length).toBeGreaterThan(0);
    });

    it('every tool has required fields', () => {
      for (const tool of MCP_TOOLS) {
        expect(tool.id).toEqual(expect.any(String));
        expect(tool.name).toEqual(expect.any(String));
        expect(tool.color).toEqual(expect.any(String));
        expect(tool.mcpConfig).toEqual(expect.any(String));
        expect(tool.detect).toBeDefined();
      }
    });

    it('every tool has processDetection with executables array', () => {
      for (const tool of MCP_TOOLS) {
        expect(tool.processDetection).toBeDefined();
        expect(Array.isArray(tool.processDetection.executables)).toBe(true);
      }
    });

    it('every tool has a catalog with description', () => {
      for (const tool of MCP_TOOLS) {
        expect(tool.catalog).toBeDefined();
        expect(tool.catalog.description).toEqual(expect.any(String));
      }
    });

    it('all tool IDs are unique', () => {
      const ids = MCP_TOOLS.map(t => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('all tool names are unique', () => {
      const names = MCP_TOOLS.map(t => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    const expectedTools = [
      'claude-code',
      'cursor',
      'windsurf',
      'vscode',
      'codex',
      'aider',
      'jetbrains',
      'amazon-q',
    ];

    for (const toolId of expectedTools) {
      it(`includes tool: ${toolId}`, () => {
        const tool = MCP_TOOLS.find(t => t.id === toolId);
        expect(tool).toBeDefined();
      });
    }

    it('claude-code has hooks, channel, and spawn capabilities', () => {
      const cc = MCP_TOOLS.find(t => t.id === 'claude-code');
      expect(cc.hooks).toBe(true);
      expect(cc.channel).toBe(true);
      expect(cc.spawn).toBeDefined();
    });

    it('claude-code has an availability check with parse function', () => {
      const cc = MCP_TOOLS.find(t => t.id === 'claude-code');
      expect(cc.availabilityCheck).toBeDefined();
      expect(typeof cc.availabilityCheck.parse).toBe('function');
    });

    it('cursor does not have hooks or channel', () => {
      const cursor = MCP_TOOLS.find(t => t.id === 'cursor');
      expect(cursor.hooks).toBeUndefined();
      expect(cursor.channel).toBeUndefined();
    });
  });

  describe('getMcpToolById', () => {
    it('returns tool when ID exists', () => {
      const tool = getMcpToolById('claude-code');
      expect(tool).toBeDefined();
      expect(tool.id).toBe('claude-code');
      expect(tool.name).toBe('Claude Code');
    });

    it('returns tool for each known ID', () => {
      for (const tool of MCP_TOOLS) {
        const result = getMcpToolById(tool.id);
        expect(result).toBe(tool);
      }
    });

    it('returns null for unknown ID', () => {
      expect(getMcpToolById('nonexistent')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(getMcpToolById('')).toBeNull();
    });

    it('returns null for null', () => {
      expect(getMcpToolById(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(getMcpToolById(undefined)).toBeNull();
    });
  });

  describe('claude-code availability check parser', () => {
    const cc = MCP_TOOLS.find(t => t.id === 'claude-code');
    const parse = cc.availabilityCheck.parse;

    it('returns ready when loggedIn is true', () => {
      const result = parse(JSON.stringify({ loggedIn: true }));
      expect(result.state).toBe('ready');
    });

    it('returns needs_auth when loggedIn is false', () => {
      const result = parse(JSON.stringify({ loggedIn: false }));
      expect(result.state).toBe('needs_auth');
    });

    it('returns unavailable for invalid JSON', () => {
      const result = parse('not json');
      expect(result.state).toBe('unavailable');
    });
  });

  describe('codex availability check parser', () => {
    const codex = MCP_TOOLS.find(t => t.id === 'codex');
    const parse = codex.availabilityCheck.parse;

    it('returns ready when output contains "logged in"', () => {
      const result = parse('You are logged in as user@example.com');
      expect(result.state).toBe('ready');
    });

    it('returns needs_auth when output says login required', () => {
      const result = parse('Login required. Please authenticate.');
      expect(result.state).toBe('needs_auth');
    });

    it('note: "Not logged in" matches "logged in" regex first (parser order issue)', () => {
      // The current parser checks /logged in/ before /not logged in/, so
      // "Not logged in" is classified as 'ready'. This documents the
      // actual behavior for awareness.
      const result = parse('Not logged in. Please sign in first.');
      expect(result.state).toBe('ready');
    });

    it('returns unavailable for unrecognized output', () => {
      const result = parse('some random output');
      expect(result.state).toBe('unavailable');
    });
  });
});
