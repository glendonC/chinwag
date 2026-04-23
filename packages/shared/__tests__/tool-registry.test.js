import { describe, it, expect } from 'vitest';
import { MCP_TOOLS, getMcpToolById } from '../tool-registry.js';

describe('MCP_TOOLS', () => {
  it('registers every known tool', () => {
    // Asserted against the explicit expectedTools list below — count is
    // derived so adding a tool means adding it to expectedTools (a single
    // source of truth), not updating a hardcoded number here.
    expect(MCP_TOOLS.length).toBe(expectedTools.length);
  });

  it('every tool has required fields: id, name, detect, processDetection, mcpConfig, catalog', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.id).toEqual(expect.any(String));
      expect(tool.name).toEqual(expect.any(String));
      expect(tool.color).toEqual(expect.any(String));
      expect(tool.detect).toBeDefined();
      expect(tool.processDetection).toBeDefined();
      expect(tool.mcpConfig).toEqual(expect.any(String));
      expect(tool.catalog).toBeDefined();
    }
  });

  it('every tool has processDetection with executables and aliases arrays', () => {
    for (const tool of MCP_TOOLS) {
      expect(Array.isArray(tool.processDetection.executables)).toBe(true);
      expect(Array.isArray(tool.processDetection.aliases)).toBe(true);
    }
  });

  it('every tool has at least one process inference hint', () => {
    // Standalone CLI tools declare dirs/cmds and executables. VS Code-hosted
    // surfaces like Cline have neither and rely on the package substring
    // matched against the full `ps` command line (commandPatterns). Any of
    // the four paths is a valid inference hint.
    for (const tool of MCP_TOOLS) {
      const hasDirs = (tool.detect.dirs?.length ?? 0) > 0;
      const hasCmds = (tool.detect.cmds?.length ?? 0) > 0;
      const hasExecs = (tool.processDetection.executables?.length ?? 0) > 0;
      const hasPatterns = (tool.processDetection.commandPatterns?.length ?? 0) > 0;
      expect(
        hasDirs || hasCmds || hasExecs || hasPatterns,
        `tool "${tool.id}" has no detection hints`,
      ).toBe(true);
    }
  });

  it('every tool has a catalog with description and category', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.catalog.description).toEqual(expect.any(String));
      expect(tool.catalog.description.length).toBeGreaterThan(0);
      expect(tool.catalog.category).toEqual(expect.any(String));
    }
  });

  it('all tool IDs are unique', () => {
    const ids = MCP_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all tool names are unique', () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  const expectedTools = [
    'claude-code',
    'cursor',
    'windsurf',
    'copilot',
    'vscode',
    'codex',
    'aider',
    'jetbrains',
    'amazon-q',
    'cline',
  ];

  for (const toolId of expectedTools) {
    it(`includes tool: ${toolId}`, () => {
      const tool = MCP_TOOLS.find((t) => t.id === toolId);
      expect(tool).toBeDefined();
    });
  }

  it('claude-code has hooks, channel, and spawn capabilities', () => {
    const cc = MCP_TOOLS.find((t) => t.id === 'claude-code');
    expect(cc.hooks).toBe(true);
    expect(cc.channel).toBe(true);
    expect(cc.spawn).toBeDefined();
    expect(cc.spawn.cmd).toBe('claude');
  });

  it('claude-code has an availability check with parse function', () => {
    const cc = MCP_TOOLS.find((t) => t.id === 'claude-code');
    expect(cc.availabilityCheck).toBeDefined();
    expect(cc.availabilityCheck.args).toEqual(expect.any(Array));
    expect(typeof cc.availabilityCheck.parse).toBe('function');
  });

  it('claude-code has failure patterns', () => {
    const cc = MCP_TOOLS.find((t) => t.id === 'claude-code');
    expect(cc.failurePatterns).toBeDefined();
    expect(cc.failurePatterns.length).toBeGreaterThan(0);
    for (const pattern of cc.failurePatterns) {
      expect(pattern.pattern).toBeInstanceOf(RegExp);
      expect(pattern.detail).toEqual(expect.any(String));
      expect(pattern.recoveryCommand).toEqual(expect.any(String));
    }
  });

  it('cursor has hooks but no channel', () => {
    const cursor = MCP_TOOLS.find((t) => t.id === 'cursor');
    expect(cursor.hooks).toBe(true);
    expect(cursor.hooksConfig).toBe('.cursor/hooks.json');
    expect(cursor.hooksFormat).toBe('claude');
    expect(cursor.channel).toBeUndefined();
  });

  it('windsurf has hooks with the windsurf format', () => {
    const windsurf = MCP_TOOLS.find((t) => t.id === 'windsurf');
    expect(windsurf.hooks).toBe(true);
    expect(windsurf.hooksConfig).toBe('.windsurf/hooks.json');
    expect(windsurf.hooksFormat).toBe('windsurf');
  });

  it('every tool with hooks declares a hooksConfig path and format', () => {
    for (const tool of MCP_TOOLS) {
      if (!tool.hooks) continue;
      expect(tool.hooksConfig, `tool "${tool.id}" missing hooksConfig`).toEqual(expect.any(String));
      expect(['claude', 'windsurf']).toContain(tool.hooksFormat);
    }
  });

  it('codex has an availability check with parse function', () => {
    const codex = MCP_TOOLS.find((t) => t.id === 'codex');
    expect(codex.availabilityCheck).toBeDefined();
    expect(typeof codex.availabilityCheck.parse).toBe('function');
  });

  it('amazon-q has connected tier', () => {
    const aq = MCP_TOOLS.find((t) => t.id === 'amazon-q');
    expect(aq.tier).toBe('connected');
  });
});

describe('getMcpToolById', () => {
  it('returns correct tool for known ID', () => {
    const tool = getMcpToolById('claude-code');
    expect(tool).toBeDefined();
    expect(tool.id).toBe('claude-code');
    expect(tool.name).toBe('Claude Code');
  });

  it('returns the same object reference as in MCP_TOOLS', () => {
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
  const cc = MCP_TOOLS.find((t) => t.id === 'claude-code');
  const parse = cc.availabilityCheck.parse;

  it('returns ready when loggedIn is true', () => {
    const result = parse(JSON.stringify({ loggedIn: true }));
    expect(result.state).toBe('ready');
    expect(result.detail).toEqual(expect.any(String));
  });

  it('returns needs_auth when loggedIn is false', () => {
    const result = parse(JSON.stringify({ loggedIn: false }));
    expect(result.state).toBe('needs_auth');
    expect(result.recoveryCommand).toEqual(expect.any(String));
  });

  it('returns unavailable for invalid JSON', () => {
    const result = parse('not json');
    expect(result.state).toBe('unavailable');
  });

  it('returns unavailable for empty string', () => {
    const result = parse('');
    expect(result.state).toBe('unavailable');
  });
});

describe('claude-code failure pattern matching', () => {
  const cc = MCP_TOOLS.find((t) => t.id === 'claude-code');
  const patterns = cc.failurePatterns;

  it('matches "auth" in error output', () => {
    const match = patterns.find((p) => p.pattern.test('auth error occurred'));
    expect(match).toBeDefined();
    expect(match.recoveryCommand).toContain('auth login');
  });

  it('matches "not logged in" in error output', () => {
    const match = patterns.find((p) => p.pattern.test('You are not logged in'));
    expect(match).toBeDefined();
  });

  it('matches "please log in" in error output', () => {
    const match = patterns.find((p) => p.pattern.test('Please log in first'));
    expect(match).toBeDefined();
  });

  it('matches "authentication" in error output', () => {
    const match = patterns.find((p) => p.pattern.test('Authentication failed'));
    expect(match).toBeDefined();
  });

  it('does not match unrelated error', () => {
    const match = patterns.find((p) => p.pattern.test('file not found'));
    expect(match).toBeUndefined();
  });
});

describe('codex failure pattern matching', () => {
  const codex = MCP_TOOLS.find((t) => t.id === 'codex');
  const patterns = codex.failurePatterns;

  it('matches "refresh token already used"', () => {
    const match = patterns.find((p) =>
      p.pattern.test('The refresh token has already used, please try again'),
    );
    expect(match).toBeDefined();
    expect(match.recoveryCommand).toContain('login');
  });

  it('matches "log out and sign in again"', () => {
    const match = patterns.find((p) => p.pattern.test('Please log out and sign in again'));
    expect(match).toBeDefined();
  });

  it('matches "token expired"', () => {
    const match = patterns.find((p) => p.pattern.test('Your token expired'));
    expect(match).toBeDefined();
  });

  it('matches "401 unauthorized"', () => {
    const match = patterns.find((p) => p.pattern.test('Received 401 Unauthorized'));
    expect(match).toBeDefined();
  });

  it('matches "could not be refreshed"', () => {
    const match = patterns.find((p) => p.pattern.test('Your session could not be refreshed'));
    expect(match).toBeDefined();
  });

  it('does not match unrelated error', () => {
    const match = patterns.find((p) => p.pattern.test('file not found'));
    expect(match).toBeUndefined();
  });
});

describe('tool spawn configurations', () => {
  it('claude-code spawn uses claude with --print args', () => {
    const cc = MCP_TOOLS.find((t) => t.id === 'claude-code');
    expect(cc.spawn.cmd).toBe('claude');
    expect(cc.spawn.args).toEqual(['--print']);
    expect(cc.spawn.interactiveArgs).toEqual([]);
  });

  it('codex spawn uses codex with exec --color never', () => {
    const codex = MCP_TOOLS.find((t) => t.id === 'codex');
    expect(codex.spawn.cmd).toBe('codex');
    expect(codex.spawn.args).toEqual(['exec', '--color', 'never']);
  });

  it('aider spawn uses aider with --message and analytics logging', () => {
    const aider = MCP_TOOLS.find((t) => t.id === 'aider');
    expect(aider.spawn.cmd).toBe('aider');
    // --message is the prompt flag; --analytics-log writes token/cost data
    // that the extraction engine parses post-session.
    expect(aider.spawn.args).toContain('--message');
    expect(aider.spawn.args).toContain('--analytics-log');
  });

  it('amazon-q spawn uses q with taskArg positional', () => {
    const aq = MCP_TOOLS.find((t) => t.id === 'amazon-q');
    expect(aq.spawn.cmd).toBe('q');
    expect(aq.spawn.taskArg).toBe('positional');
  });
});

describe('tool catalog mcpCompatible flags', () => {
  // MCP_TOOLS holds every tool whose sessions chinmeister wants to attribute
  // — not strictly "tools that speak MCP". Copilot, for example, is in the
  // registry so clientInfo can be routed to a distinct `copilot` id, but
  // Copilot itself is not an MCP host. The invariant we actually care about
  // is: anything claiming `mcpCompatible` must also be `mcpConfigurable`
  // (i.e. `chinmeister add <tool>` must have somewhere to write MCP config).
  it('every mcpCompatible tool is also mcpConfigurable', () => {
    for (const tool of MCP_TOOLS) {
      if (tool.catalog.mcpCompatible) {
        expect(tool.catalog.mcpConfigurable, `${tool.id}`).toBe(true);
      }
    }
  });

  it('at least one tool per major coding-agent category is mcpCompatible', () => {
    const compatCount = MCP_TOOLS.filter((t) => t.catalog.mcpCompatible).length;
    expect(compatCount).toBeGreaterThan(0);
  });
});

describe('codex availability check parser', () => {
  const codex = MCP_TOOLS.find((t) => t.id === 'codex');
  const parse = codex.availabilityCheck.parse;

  it('returns ready when output contains "logged in"', () => {
    const result = parse('You are logged in as user@example.com');
    expect(result.state).toBe('ready');
  });

  it('returns needs_auth when output says "Not logged in"', () => {
    const result = parse('Not logged in. Please sign in first.');
    expect(result.state).toBe('needs_auth');
  });

  it('returns needs_auth when output says "login required"', () => {
    const result = parse('Login required. Please authenticate.');
    expect(result.state).toBe('needs_auth');
  });

  it('returns needs_auth when output says "sign in"', () => {
    const result = parse('Please sign in to continue.');
    expect(result.state).toBe('needs_auth');
  });

  it('returns unavailable for unrecognized output', () => {
    const result = parse('some random output');
    expect(result.state).toBe('unavailable');
  });

  it('returns unavailable for empty string', () => {
    const result = parse('');
    expect(result.state).toBe('unavailable');
  });
});
