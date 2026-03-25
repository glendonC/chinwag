// Tool Catalog — single source of truth for the full AI dev tool catalog.
// CLI and web fetch this instead of maintaining their own static lists.
// MCP_TOOLS (tools chinwag writes configs for) are a subset marked with mcpConfigurable: true.

export const TOOL_CATALOG = [
  // MCP-configurable tools (chinwag writes config for these)
  { id: 'claude-code', name: 'Claude Code', description: 'Terminal AI coding agent with hooks, channels, and agent teams', category: 'coding-agent', website: 'https://claude.ai/code', installCmd: 'npm install -g @anthropic-ai/claude-code', mcpCompatible: true, mcpConfigurable: true, featured: true },
  { id: 'cursor', name: 'Cursor', description: 'AI-native code editor with inline completions and chat', category: 'coding-agent', website: 'https://cursor.com', mcpCompatible: true, mcpConfigurable: true, featured: true },
  { id: 'windsurf', name: 'Windsurf', description: 'AI IDE with autonomous Cascade agent and memory', category: 'coding-agent', website: 'https://windsurf.com', mcpCompatible: true, mcpConfigurable: true, featured: true },
  { id: 'vscode', name: 'VS Code', description: 'Code editor with Copilot, Cline, and Continue extensions', category: 'coding-agent', website: 'https://code.visualstudio.com', mcpCompatible: true, mcpConfigurable: true },
  { id: 'codex', name: 'Codex', description: 'OpenAI terminal coding agent with cloud sandboxes', category: 'coding-agent', website: 'https://openai.com/index/codex/', installCmd: 'npm install -g @openai/codex', mcpCompatible: true, mcpConfigurable: true },
  { id: 'aider', name: 'Aider', description: 'Terminal pair programmer that edits code in your repo', category: 'coding-agent', website: 'https://aider.chat', installCmd: 'pip install aider-chat', mcpCompatible: true, mcpConfigurable: true, featured: true },
  { id: 'jetbrains', name: 'JetBrains', description: 'AI assistant across IntelliJ, PyCharm, WebStorm, and more', category: 'coding-agent', website: 'https://www.jetbrains.com/ai/', mcpCompatible: true, mcpConfigurable: true },
  { id: 'amazon-q', name: 'Amazon Q', description: 'AWS AI assistant for coding, debugging, and deployment', category: 'coding-agent', website: 'https://aws.amazon.com/q/developer/', mcpCompatible: true, mcpConfigurable: true },

  // Discovery-only coding agents
  { id: 'cline', name: 'Cline', description: 'Autonomous AI coding agent for VS Code', category: 'coding-agent', website: 'https://cline.bot', mcpCompatible: true },
  { id: 'continue', name: 'Continue', description: 'Open-source AI code assistant for VS Code and JetBrains', category: 'coding-agent', website: 'https://continue.dev', mcpCompatible: true },
  { id: 'roo-code', name: 'Roo Code', description: 'Multi-agent AI coding in VS Code, forked from Cline', category: 'coding-agent', website: 'https://roocode.com', mcpCompatible: true },
  { id: 'goose', name: 'Goose', description: 'Open-source on-machine AI agent from Block', category: 'coding-agent', website: 'https://block.github.io/goose/', installCmd: 'brew install block-goose-cli', mcpCompatible: true },
  { id: 'opencode', name: 'OpenCode', description: 'Open-source terminal AI coding agent', category: 'coding-agent', website: 'https://opencode.ai', installCmd: 'brew install opencode', mcpCompatible: true },
  { id: 'amp', name: 'Amp', description: 'AI coding agent from Sourcegraph with codebase search', category: 'coding-agent', website: 'https://ampcode.com', mcpCompatible: true },
  { id: 'kiro', name: 'Kiro', description: 'Spec-driven AI IDE from Amazon with autonomous agents', category: 'coding-agent', website: 'https://kiro.dev', installCmd: 'brew install --cask kiro', mcpCompatible: true },
  { id: 'zed', name: 'Zed', description: 'High-performance AI-native editor built in Rust', category: 'coding-agent', website: 'https://zed.dev', installCmd: 'brew install --cask zed', mcpCompatible: true },
  { id: 'augment', name: 'Augment Code', description: 'AI coding agent with deep codebase context engine', category: 'coding-agent', website: 'https://augmentcode.com', installCmd: 'npm install -g @augmentcode/auggie', mcpCompatible: true },

  // Voice-to-code
  { id: 'wispr-flow', name: 'Wispr Flow', description: 'Voice dictation that works in any app on macOS', category: 'voice', website: 'https://wisprflow.ai', installCmd: 'brew install --cask wispr-flow', mcpCompatible: false, featured: true },
  { id: 'superwhisper', name: 'Superwhisper', description: 'Offline AI voice-to-text for macOS using Whisper models', category: 'voice', website: 'https://superwhisper.com', installCmd: 'brew install --cask superwhisper', mcpCompatible: false },

  // Code review
  { id: 'coderabbit', name: 'CodeRabbit', description: 'AI code review on pull requests, GitHub and GitLab', category: 'review', website: 'https://coderabbit.ai', mcpCompatible: false },
  { id: 'ellipsis', name: 'Ellipsis', description: 'Automated code reviews and bug fixes on GitHub PRs', category: 'review', website: 'https://ellipsis.dev', mcpCompatible: false },
  { id: 'greptile', name: 'Greptile', description: 'Codebase-aware AI code review for GitHub and GitLab', category: 'review', website: 'https://greptile.com', mcpCompatible: false },

  // Terminal tools
  { id: 'warp', name: 'Warp', description: 'AI-powered terminal with agent mode and MCP support', category: 'terminal', website: 'https://warp.dev', installCmd: 'brew install --cask warp', mcpCompatible: true },

  // Documentation
  { id: 'mintlify', name: 'Mintlify', description: 'AI-powered documentation generation and hosting', category: 'docs', website: 'https://mintlify.com', installCmd: 'npm install -g mintlify', mcpCompatible: false },
];

export const CATEGORY_NAMES = {
  'coding-agent': 'Coding agents',
  'voice': 'Voice-to-code',
  'review': 'Code review',
  'terminal': 'Terminal tools',
  'docs': 'Documentation',
};