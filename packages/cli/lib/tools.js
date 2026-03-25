// Tool registry — declarative definitions for MCP-configurable tools.
//
// MCP_TOOLS: Tools that chinwag writes MCP config for. Each entry defines
// detection rules (dirs/cmds), config file path, integration depth, and
// brand color for the TUI indicator dot.
//
// Adding a new tool = adding one entry here. No logic changes elsewhere.
//
// The full discovery catalog (30+ tools) lives in the worker API at
// GET /tools/catalog — CLI and web fetch it dynamically.

export const MCP_TOOLS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    color: 'yellow',        // Anthropic amber
    detect: { dirs: ['.claude'], cmds: ['claude'] },
    mcpConfig: '.mcp.json',
    hooks: true,
    channel: true,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    color: 'cyan',           // Cursor teal
    detect: { dirs: ['.cursor'], cmds: ['cursor'] },
    mcpConfig: '.cursor/mcp.json',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    color: 'green',          // Codeium green
    detect: { dirs: ['.windsurf'], cmds: ['windsurf'] },
    mcpConfig: '.windsurf/mcp.json',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    color: 'blueBright',     // Microsoft blue
    detect: { dirs: ['.vscode'], cmds: ['code'] },
    mcpConfig: '.vscode/mcp.json',
  },
  {
    id: 'codex',
    name: 'Codex',
    color: 'greenBright',    // OpenAI green
    detect: { cmds: ['codex'] },
    mcpConfig: '.mcp.json',
  },
  {
    id: 'aider',
    name: 'Aider',
    color: 'magenta',
    detect: { cmds: ['aider'] },
    mcpConfig: '.mcp.json',
  },
  {
    id: 'jetbrains',
    name: 'JetBrains',
    color: 'redBright',      // JetBrains red
    detect: { dirs: ['.idea'], cmds: ['idea', 'pycharm', 'webstorm', 'phpstorm', 'goland', 'rubymine', 'rider', 'clion'] },
    mcpConfig: '.idea/mcp.json',
  },
  {
    id: 'amazon-q',
    name: 'Amazon Q',
    color: 'yellowBright',   // AWS orange
    detect: { cmds: ['q'] },
    mcpConfig: '.mcp.json',
  },
];
