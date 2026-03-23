// Tool registry — declarative definitions for every MCP-compatible tool.
// Adding a new tool = adding one entry here. No logic changes anywhere else.
//
// Fields:
//   id          — internal identifier, used in code and API
//   name        — display name shown to users
//   detect.dirs — project-level directories that indicate the tool is present
//   detect.cmds — CLI commands to check via `which`
//   detect.env  — env vars the tool sets when it spawns an MCP subprocess
//   mcpConfig   — relative path where the tool reads MCP server config
//   hooks       — whether this tool supports pre/post hooks (enforceable interception)
//   channel     — whether this tool supports channel push (server-initiated events)

export const TOOL_REGISTRY = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    detect: { dirs: ['.claude'], cmds: ['claude'] },
    env: ['CLAUDE_CODE'],
    mcpConfig: '.mcp.json',
    hooks: true,
    channel: true,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    detect: { dirs: ['.cursor'], cmds: ['cursor'] },
    mcpConfig: '.cursor/mcp.json',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    detect: { dirs: ['.windsurf'], cmds: ['windsurf'] },
    mcpConfig: '.windsurf/mcp.json',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    detect: { dirs: ['.vscode'], cmds: ['code'] },
    mcpConfig: '.vscode/mcp.json',
  },
  {
    id: 'codex',
    name: 'Codex',
    detect: { cmds: ['codex'] },
    env: ['CODEX_HOME'],
    mcpConfig: '.mcp.json',
  },
  {
    id: 'aider',
    name: 'Aider',
    detect: { cmds: ['aider'] },
    mcpConfig: '.mcp.json',
  },
  {
    id: 'jetbrains',
    name: 'JetBrains',
    detect: { dirs: ['.idea'], cmds: ['idea', 'pycharm', 'webstorm', 'phpstorm', 'goland', 'rubymine', 'rider', 'clion'] },
    mcpConfig: '.idea/mcp.json',
  },
  {
    id: 'amazon-q',
    name: 'Amazon Q',
    detect: { cmds: ['q'] },
    mcpConfig: '.mcp.json',
  },
];
