const TOOL_META = {
  claude: {
    label: 'Claude Code',
    icon: '/assets/claude-code.svg',
    color: '#d9773c',
  },
  cursor: {
    label: 'Cursor',
    icon: '/assets/cursor.svg',
    color: '#111111',
  },
  windsurf: {
    label: 'Windsurf',
    icon: '/assets/windsurf.svg',
    color: '#0f8b7b',
  },
  vscode: {
    label: 'VS Code',
    icon: '/assets/vscode.svg',
    color: '#0078d4',
  },
  codex: {
    label: 'Codex',
    icon: '/assets/codex.svg',
    color: '#10a37f',
  },
  aider: {
    label: 'Aider',
    icon: '/assets/aider.svg',
    color: '#297a4a',
  },
  amazonq: {
    label: 'Amazon Q',
    icon: '/assets/amazon-q.svg',
    color: '#5b36d6',
  },
  jetbrains: {
    label: 'JetBrains',
    icon: '/assets/jetbrains.svg',
    color: '#f97316',
  },
  continue: {
    label: 'Continue',
    icon: '/assets/continue.svg',
    color: '#047857',
  },
  cline: {
    label: 'Cline',
    icon: '/assets/cline.svg',
    color: '#c2410c',
  },
  warp: {
    label: 'Warp',
    icon: '/assets/warp.svg',
    color: '#6d28d9',
  },
  zed: {
    label: 'Zed',
    icon: '/assets/zed.svg',
    color: '#09090b',
  },
};

export function normalizeToolId(toolId) {
  return String(toolId || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '')
    .replace(/-/g, '');
}

export function getToolMeta(toolId) {
  const normalized = normalizeToolId(toolId);
  if (normalized === 'claudecode') {
    return { id: 'claude', ...TOOL_META.claude };
  }
  if (normalized === 'amazonq' || normalized === 'amazonqdeveloper') {
    return { id: 'amazonq', ...TOOL_META.amazonq };
  }
  if (normalized === 'visualstudiocode') {
    return { id: 'vscode', ...TOOL_META.vscode };
  }
  const matched = TOOL_META[normalized];
  if (matched) {
    return { id: normalized, ...matched };
  }

  const pretty = String(toolId || 'tool')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return {
    id: normalized || 'tool',
    label: pretty,
    icon: null,
    color: '#1d46ff',
  };
}
