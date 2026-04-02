/**
 * @typedef {Object} ToolDetect
 * @property {string[]} [dirs] - Directory markers to detect
 * @property {string[]} [cmds] - CLI command names to detect
 */

/**
 * @typedef {Object} ToolProcessDetection
 * @property {string[]} executables - Executable names to match in process tree
 * @property {string[]} aliases - Human-readable aliases for fuzzy matching
 */

/**
 * @typedef {Object} ToolSpawnConfig
 * @property {string} cmd - CLI command to run
 * @property {string[]} [args] - Default args for non-interactive mode
 * @property {string[]} [interactiveArgs] - Args for interactive mode
 * @property {string} [taskArg] - How the task text is passed (e.g. 'positional')
 */

/**
 * @typedef {Object} AvailabilityCheckResult
 * @property {'ready'|'needs_auth'|'unavailable'} state
 * @property {string} detail
 * @property {string} recoveryCommand
 */

/**
 * @typedef {Object} ToolAvailabilityCheck
 * @property {string[]} args - CLI args to run for status check
 * @property {(output: string) => AvailabilityCheckResult} parse - Output parser
 */

/**
 * @typedef {Object} ToolFailurePattern
 * @property {RegExp} pattern - Regex to match against error output
 * @property {string} detail - Human-readable failure description
 * @property {string} recoveryCommand - Command to fix the issue
 */

/**
 * @typedef {Object} ToolCatalog
 * @property {string} description - Short description for catalog display
 * @property {string} category - e.g. 'coding-agent'
 * @property {string} [website] - Product URL
 * @property {string} [installCmd] - Installation command
 * @property {boolean} [mcpCompatible] - Whether this tool supports MCP
 * @property {boolean} [mcpConfigurable] - Whether chinwag can write its MCP config
 * @property {boolean} [featured] - Whether to feature in catalog
 */

/**
 * @typedef {Object} McpTool
 * @property {string} id - Unique tool identifier
 * @property {string} name - Display name
 * @property {string} color - Chalk color name for terminal display
 * @property {ToolDetect} detect - Detection markers
 * @property {ToolProcessDetection} processDetection - Process tree matching rules
 * @property {string} mcpConfig - Relative path to MCP config file
 * @property {boolean} [hooks] - Whether this tool supports hooks
 * @property {boolean} [channel] - Whether this tool supports channels
 * @property {ToolSpawnConfig} [spawn] - Spawn configuration (managed tools only)
 * @property {ToolAvailabilityCheck} [availabilityCheck] - Authentication check
 * @property {ToolFailurePattern[]} [failurePatterns] - Error diagnosis patterns
 * @property {ToolCatalog} catalog - Catalog metadata
 */

const CLAUDE_AUTH_LOGIN = 'claude auth login';
const CODEX_LOGIN = 'codex login';

function parseClaudeCodeAvailability(output) {
  try {
    const data = JSON.parse(output);
    return data.loggedIn
      ? { state: 'ready', detail: 'Ready to start', recoveryCommand: CLAUDE_AUTH_LOGIN }
      : { state: 'needs_auth', detail: 'Sign in to Claude Code', recoveryCommand: CLAUDE_AUTH_LOGIN };
  } catch {
    return { state: 'unavailable', detail: 'Could not verify Claude Code', recoveryCommand: CLAUDE_AUTH_LOGIN };
  }
}

function parseCodexAvailability(output) {
  if (/logged in/i.test(output)) {
    return { state: 'ready', detail: 'Ready to start', recoveryCommand: CODEX_LOGIN };
  }
  if (/not logged in|login required|sign in/i.test(output)) {
    return { state: 'needs_auth', detail: 'Sign in to Codex', recoveryCommand: CODEX_LOGIN };
  }
  return { state: 'unavailable', detail: 'Could not verify Codex', recoveryCommand: CODEX_LOGIN };
}

/** @type {McpTool[]} */
export const MCP_TOOLS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    color: 'yellow',
    detect: { dirs: ['.claude'], cmds: ['claude'] },
    processDetection: {
      executables: ['claude'],
      aliases: ['claude code'],
    },
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
    },
    mcpConfig: '.mcp.json',
    spawn: { cmd: 'codex', args: ['exec', '--color', 'never'], interactiveArgs: [] },
    availabilityCheck: {
      args: ['login', 'status'],
      parse: parseCodexAvailability,
    },
    failurePatterns: [
      {
        pattern: /refresh token.*already used|log out and sign in again|token expired|401 unauthorized|could not be refreshed/i,
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
    },
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
    detect: { dirs: ['.idea'], cmds: ['idea', 'pycharm', 'webstorm', 'phpstorm', 'goland', 'rubymine', 'rider', 'clion'] },
    processDetection: {
      executables: ['idea', 'pycharm', 'webstorm', 'phpstorm', 'goland', 'rubymine', 'rider', 'clion'],
      aliases: ['intellij idea'],
    },
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
    mcpConfig: '.mcp.json',
    spawn: { cmd: 'q', taskArg: 'positional' },
    catalog: {
      description: 'AWS AI assistant for coding, debugging, and deployment',
      category: 'coding-agent',
      website: 'https://aws.amazon.com/q/developer/',
      mcpCompatible: true,
      mcpConfigurable: true,
    },
  },
];

/**
 * @param {string} toolId
 * @returns {McpTool|undefined}
 */
export function getMcpToolById(toolId) {
  return MCP_TOOLS.find((tool) => tool.id === toolId) || null;
}

