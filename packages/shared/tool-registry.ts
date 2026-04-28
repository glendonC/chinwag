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

/**
 * Declares what data a tool can provide beyond basic session/edit tracking.
 * Each flag indicates a specific data extraction capability.
 * Adding a new capability = one field here + one parser in the extraction engine.
 */
export interface DataCapabilities {
  /** Tool writes conversation logs that chinmeister can parse for message-level analytics. */
  conversationLogs?: boolean;
  /** Tool exposes token/usage data (input tokens, output tokens) in its logs. */
  tokenUsage?: boolean;
  /** Tool writes structured logs from which per-tool-call events (name, timing, errors) can be parsed. */
  toolCallLogs?: boolean;
  /** How cost data is obtained: 'derived' from tokens via LiteLLM pricing, 'litellm' pre-calculated, 'credits' opaque. */
  costSource?: 'derived' | 'litellm' | 'credits' | null;
  /** Token field semantics for normalization: 'anthropic' (additive fields) or 'openai' (cached nested in input). */
  tokenFormat?: 'anthropic' | 'openai' | null;
  /** Whether the tool supports lifecycle hooks for real-time data capture. */
  hooks?: boolean;
  /** Whether commit tracking works for this tool (via hooks or MCP). */
  commitTracking?: boolean;
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
  /**
   * Path (relative to the project root) where this tool's hook config lives.
   * Required when `hooks === true`. Different tools keep hooks in different
   * files: Claude Code uses `.claude/settings.json`, Cursor uses
   * `.cursor/hooks.json`, Windsurf uses `.windsurf/hooks.json`.
   */
  hooksConfig?: string;
  /**
   * Format of the hooks config file. `'claude'` matches the Claude Code and
   * Cursor shape (PreToolUse/PostToolUse/SessionStart with matcher + hooks[]
   * entries). `'windsurf'` matches Windsurf's flat snake_case events
   * (pre_write_code/post_write_code/post_run_command with direct commands).
   */
  hooksFormat?: 'claude' | 'windsurf';
  /**
   * Exit code a pre-hook script must return to block the impending operation.
   * Most hosts accept any non-zero code. Windsurf's Cascade spec reserves
   * exit 2 specifically for "block"; other non-zero codes are treated as
   * warnings. Omit for the default of 1.
   */
  hookBlockExitCode?: number;
  channel?: boolean;
  spawn?: ToolSpawnConfig;
  availabilityCheck?: ToolAvailabilityCheck;
  failurePatterns?: ToolFailurePattern[];
  tier?: 'managed' | 'connected';
  /**
   * What data this tool can provide beyond basic session/edit tracking.
   * Drives parser selection and coverage reporting - never branch on tool ID,
   * branch on capabilities instead.
   */
  dataCapabilities?: DataCapabilities;
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
  // Check negative cases first - "Not logged in" contains "logged in"
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
    hooksConfig: '.claude/settings.json',
    hooksFormat: 'claude',
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
    dataCapabilities: {
      conversationLogs: true,
      tokenUsage: true,
      toolCallLogs: true,
      costSource: 'derived',
      tokenFormat: 'anthropic',
      hooks: true,
      commitTracking: true,
    },
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
    hooks: true,
    hooksConfig: '.cursor/hooks.json',
    hooksFormat: 'claude',
    dataCapabilities: {
      // cursor.json parser now extracts user prompts, per-message tokens, and
      // model info from the cursorDiskKV SQLite table, so these get flipped
      // on alongside the long-standing hook-driven tool-call capture.
      conversationLogs: true,
      tokenUsage: true,
      toolCallLogs: true,
      costSource: 'derived',
      tokenFormat: 'anthropic',
      hooks: true,
      commitTracking: true,
    },
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
    hooks: true,
    hooksConfig: '.windsurf/hooks.json',
    hooksFormat: 'windsurf',
    hookBlockExitCode: 2,
    dataCapabilities: {
      toolCallLogs: true,
      hooks: true,
      commitTracking: true,
    },
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
    // GitHub Copilot is registered before `vscode` so `inferToolFromClientInfo`
    // matches "github copilot" to this entry first. Copilot is a distinct
    // product, not "just VS Code" - keeping them separate lets analytics
    // attribute cost, tokens, and conversation signals to the right tool.
    id: 'copilot',
    name: 'GitHub Copilot',
    color: 'magenta',
    detect: { dirs: ['.copilot'] },
    processDetection: {
      executables: [],
      aliases: [],
      // Copilot runs as an extension inside VS Code / JetBrains / Neovim, not
      // a standalone CLI. A `copilot` substring in the host's full command
      // line (e.g. the language-server child process) is the only reliable
      // process-level inference hint we have.
      commandPatterns: ['copilot'],
    },
    clientInfoNames: ['github copilot', 'copilot'],
    // Copilot itself doesn't host MCP servers - it runs inside VS Code. When a
    // user wants MCP, they configure it at the VS Code level (.vscode/mcp.json).
    // Keeping mcpConfig empty signals to the init writer "don't try to scaffold
    // a Copilot-specific MCP config."
    mcpConfig: '',
    dataCapabilities: {
      // copilot.json parser extracts messages + model (via session.model_change
      // pre-pass) + output tokens from ~/.copilot/session-state/<id>/events.jsonl.
      // Input tokens aren't logged by Copilot; cost stays unattributed (credits).
      conversationLogs: true,
      tokenUsage: true,
      costSource: null,
      tokenFormat: 'openai',
    },
    catalog: {
      description: 'AI pair programmer from GitHub, available in VS Code and other IDEs',
      category: 'coding-agent',
      website: 'https://github.com/features/copilot',
      mcpCompatible: false,
      mcpConfigurable: false,
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
    clientInfoNames: ['visual studio code', 'vscode', 'vs code'],
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
    dataCapabilities: {
      conversationLogs: true,
      tokenUsage: true,
      toolCallLogs: true,
      costSource: 'derived',
      tokenFormat: 'openai',
    },
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
    spawn: { cmd: 'aider', args: ['--message', '--analytics-log', '.aider-analytics.jsonl'] },
    dataCapabilities: {
      conversationLogs: true,
      tokenUsage: true,
      costSource: 'litellm',
    },
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
  {
    id: 'cline',
    name: 'Cline',
    color: 'yellow',
    detect: {},
    processDetection: {
      executables: [],
      aliases: [],
      commandPatterns: ['claude-dev', 'saoudrizwan.claude-dev'],
    },
    clientInfoNames: ['cline', 'claude-dev'],
    mcpConfig: '.vscode/mcp.json',
    tier: 'connected',
    dataCapabilities: {
      conversationLogs: true,
      tokenUsage: true,
      toolCallLogs: true,
      costSource: 'derived',
      tokenFormat: 'anthropic',
    },
    catalog: {
      description: 'Autonomous AI coding agent for VS Code and Cursor',
      category: 'coding-agent',
      website: 'https://cline.bot',
      mcpCompatible: true,
      mcpConfigurable: true,
    },
  },
];

export function getMcpToolById(toolId: string): McpTool | null {
  return MCP_TOOLS.find((tool) => tool.id === toolId) || null;
}

/**
 * Get the full data capabilities for a tool.
 * Returns empty object if tool not found or has no data capabilities.
 */
export function getDataCapabilities(toolId: string): DataCapabilities {
  return getMcpToolById(toolId)?.dataCapabilities || {};
}

/**
 * Get all tool IDs that have a specific data capability.
 * Used for coverage computation - never hardcode tool IDs, query capabilities instead.
 */
export function getToolsWithCapability(capability: keyof DataCapabilities): string[] {
  return MCP_TOOLS.filter((t) => t.dataCapabilities?.[capability]).map((t) => t.id);
}

/** Check if a tool supports conversation-level analytics. */
export function toolSupportsConversationLogs(toolId: string): boolean {
  return getDataCapabilities(toolId).conversationLogs === true;
}

/** List tool IDs that support conversation analytics. */
export function getConversationCapableTools(): string[] {
  return getToolsWithCapability('conversationLogs');
}

/** Check if a tool exposes token/usage data. */
export function toolSupportsTokenUsage(toolId: string): boolean {
  return getDataCapabilities(toolId).tokenUsage === true;
}
