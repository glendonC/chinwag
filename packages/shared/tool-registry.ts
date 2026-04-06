export interface ToolDetect {
  dirs?: string[];
  cmds?: string[];
}

export interface ToolProcessDetection {
  executables: string[];
  aliases: string[];
  /** Substrings to match in the full `ps` command string (e.g. package names). */
  commandPatterns?: string[];
}

export interface ToolSpawnConfig {
  cmd: string;
  args?: string[];
  interactiveArgs?: string[];
  taskArg?: string;
}

export interface AvailabilityCheckResult {
  state: 'ready' | 'needs_auth' | 'unavailable';
  detail: string;
  recoveryCommand: string;
}

export interface ToolAvailabilityCheck {
  args: string[];
  parse: (output: string) => AvailabilityCheckResult;
}

export interface ToolFailurePattern {
  pattern: RegExp;
  detail: string;
  recoveryCommand: string;
}

export interface ToolCatalog {
  description: string;
  category: string;
  website?: string;
  installCmd?: string;
  mcpCompatible?: boolean;
  mcpConfigurable?: boolean;
  featured?: boolean;
}

export interface McpTool {
  id: string;
  name: string;
  color: string;
  detect: ToolDetect;
  processDetection: ToolProcessDetection;
  /**
   * Known MCP `clientInfo.name` values that identify this tool.
   * Matched case-insensitively during MCP initialization handshake.
   */
  clientInfoNames?: string[];
  mcpConfig: string;
  hooks?: boolean;
  channel?: boolean;
  spawn?: ToolSpawnConfig;
  availabilityCheck?: ToolAvailabilityCheck;
  failurePatterns?: ToolFailurePattern[];
  tier?: 'managed' | 'connected';
  catalog: ToolCatalog;
}

const CLAUDE_AUTH_LOGIN = 'claude auth login';
const CODEX_LOGIN = 'codex login';

function parseClaudeCodeAvailability(output: string): AvailabilityCheckResult {
  try {
    const data = JSON.parse(output) as { loggedIn?: boolean };
    return data.loggedIn
      ? { state: 'ready', detail: 'Ready to start', recoveryCommand: CLAUDE_AUTH_LOGIN }
      : {
          state: 'needs_auth',
          detail: 'Sign in to Claude Code',
          recoveryCommand: CLAUDE_AUTH_LOGIN,
        };
  } catch {
    return {
      state: 'unavailable',
      detail: 'Could not verify Claude Code',
      recoveryCommand: CLAUDE_AUTH_LOGIN,
    };
  }
}

function parseCodexAvailability(output: string): AvailabilityCheckResult {
  // Check negative cases first — "Not logged in" contains "logged in"
  if (/not logged in|login required|sign in/i.test(output)) {
    return { state: 'needs_auth', detail: 'Sign in to Codex', recoveryCommand: CODEX_LOGIN };
  }
  if (/logged in/i.test(output)) {
    return { state: 'ready', detail: 'Ready to start', recoveryCommand: CODEX_LOGIN };
  }
  return { state: 'unavailable', detail: 'Could not verify Codex', recoveryCommand: CODEX_LOGIN };
}

export const MCP_TOOLS: McpTool[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    color: 'yellow',
    detect: { dirs: ['.claude'], cmds: ['claude'] },
    processDetection: {
      executables: ['claude'],
      aliases: ['claude code'],
      commandPatterns: ['claude-code', '@anthropic-ai/claude-code'],
    },
    clientInfoNames: ['claude-code', 'claude code', 'claude-ai'],
    mcpConfig: '.mcp.json',
    hooks: true,
    channel: true,
    spawn: { cmd: 'claude', args: ['--print'], interactiveArgs: [] },
    availabilityCheck: {
      args: ['auth', 'status', '--json'],
      parse: parseClaudeCodeAvailability,
    },
    failurePatterns: [
      {
        pattern: /auth|not logged in|please log in|authentication/i,
        detail: 'Sign in to Claude Code',
        recoveryCommand: CLAUDE_AUTH_LOGIN,
      },
    ],
    catalog: {
      description: 'Terminal AI coding agent with hooks, channels, and agent teams',
      category: 'coding-agent',
      website: 'https://claude.ai/code',
      installCmd: 'npm install -g @anthropic-ai/claude-code',
      mcpCompatible: true,
      mcpConfigurable: true,
      featured: true,
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    color: 'cyan',
    detect: { dirs: ['.cursor'], cmds: ['cursor'] },
    processDetection: {
      executables: ['cursor'],
      aliases: [],
    },
    clientInfoNames: ['cursor'],
    mcpConfig: '.cursor/mcp.json',
    catalog: {
      description: 'AI-native code editor with inline completions and chat',
      category: 'coding-agent',
      website: 'https://cursor.com',
      mcpCompatible: true,
      mcpConfigurable: true,
      featured: true,
    },
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    color: 'green',
    detect: { dirs: ['.windsurf'], cmds: ['windsurf'] },
    processDetection: {
      executables: ['windsurf'],
      aliases: [],
    },
    clientInfoNames: ['windsurf', 'codeium'],
    mcpConfig: '.windsurf/mcp.json',
    catalog: {
      description: 'AI IDE with autonomous Cascade agent and memory',
      category: 'coding-agent',
      website: 'https://windsurf.com',
      mcpCompatible: true,
      mcpConfigurable: true,
      featured: true,
    },
  },
  {
    id: 'vscode',
    name: 'VS Code',
    color: 'blueBright',
    detect: { dirs: ['.vscode'], cmds: ['code'] },
    processDetection: {
      executables: ['code'],
      aliases: ['code helper'],
    },
    clientInfoNames: ['visual studio code', 'vscode', 'vs code', 'github copilot'],
    mcpConfig: '.vscode/mcp.json',
    catalog: {
      description: 'Code editor with Copilot, Cline, and Continue extensions',
      category: 'coding-agent',
      website: 'https://code.visualstudio.com',
      mcpCompatible: true,
      mcpConfigurable: true,
    },
  },
  {
    id: 'codex',
    name: 'Codex',
    color: 'greenBright',
    detect: { cmds: ['codex'] },
    processDetection: {
      executables: ['codex'],
      aliases: [],
      commandPatterns: ['@openai/codex'],
    },
    clientInfoNames: ['codex', 'openai-codex'],
    mcpConfig: '.mcp.json',
    spawn: { cmd: 'codex', args: ['exec', '--color', 'never'], interactiveArgs: [] },
    availabilityCheck: {
      args: ['login', 'status'],
      parse: parseCodexAvailability,
    },
    failurePatterns: [
      {
        pattern:
          /refresh token.*already used|log out and sign in again|token expired|401 unauthorized|could not be refreshed/i,
        detail: 'Sign in to Codex again',
        recoveryCommand: CODEX_LOGIN,
      },
    ],
    catalog: {
      description: 'OpenAI terminal coding agent with cloud sandboxes',
      category: 'coding-agent',
      website: 'https://openai.com/index/codex/',
      installCmd: 'npm install -g @openai/codex',
      mcpCompatible: true,
      mcpConfigurable: true,
    },
  },
  {
    id: 'aider',
    name: 'Aider',
    color: 'magenta',
    detect: { cmds: ['aider'] },
    processDetection: {
      executables: ['aider'],
      aliases: [],
      commandPatterns: ['aider-chat'],
    },
    clientInfoNames: ['aider', 'aider-chat'],
    mcpConfig: '.mcp.json',
    spawn: { cmd: 'aider', args: ['--message'] },
    catalog: {
      description: 'Terminal pair programmer that edits code in your repo',
      category: 'coding-agent',
      website: 'https://aider.chat',
      installCmd: 'pip install aider-chat',
      mcpCompatible: true,
      mcpConfigurable: true,
      featured: true,
    },
  },
  {
    id: 'jetbrains',
    name: 'JetBrains',
    color: 'redBright',
    detect: {
      dirs: ['.idea'],
      cmds: ['idea', 'pycharm', 'webstorm', 'phpstorm', 'goland', 'rubymine', 'rider', 'clion'],
    },
    processDetection: {
      executables: [
        'idea',
        'pycharm',
        'webstorm',
        'phpstorm',
        'goland',
        'rubymine',
        'rider',
        'clion',
      ],
      aliases: ['intellij idea'],
    },
    clientInfoNames: [
      'jetbrains',
      'intellij idea',
      'pycharm',
      'webstorm',
      'phpstorm',
      'goland',
      'rubymine',
      'rider',
      'clion',
    ],
    mcpConfig: '.idea/mcp.json',
    catalog: {
      description: 'AI assistant across IntelliJ, PyCharm, WebStorm, and more',
      category: 'coding-agent',
      website: 'https://www.jetbrains.com/ai/',
      mcpCompatible: true,
      mcpConfigurable: true,
    },
  },
  {
    id: 'amazon-q',
    name: 'Amazon Q',
    color: 'yellowBright',
    detect: { cmds: ['q'] },
    processDetection: {
      executables: ['q'],
      aliases: ['amazon q'],
    },
    clientInfoNames: ['amazon q', 'amazon-q', 'q developer'],
    mcpConfig: '.mcp.json',
    spawn: { cmd: 'q', taskArg: 'positional' },
    tier: 'connected',
    catalog: {
      description: 'AWS AI assistant for coding, debugging, and deployment',
      category: 'coding-agent',
      website: 'https://aws.amazon.com/q/developer/',
      mcpCompatible: true,
      mcpConfigurable: true,
    },
  },
];

export function getMcpToolById(toolId: string): McpTool | null {
  return MCP_TOOLS.find((tool) => tool.id === toolId) || null;
}
