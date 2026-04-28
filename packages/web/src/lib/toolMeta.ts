// Tool metadata for display: icons, brand colors, label normalization.
// Icons use SVGs from /assets/ rendered as CSS masks with brand colors.
// Tools without SVGs get a colored letter fallback.
//
// For tools in MCP_TOOLS (the shared registry), label is derived from the
// registry's `name` field so changes propagate from one source. Brand
// colors and icon paths stay here since they're display-specific.

import { MCP_TOOLS } from '@chinmeister/shared/tool-registry.js';

export interface ToolMetaEntry {
  label: string;
  icon: string | null;
  color: string;
}

export interface ResolvedToolMeta extends ToolMetaEntry {
  id: string;
}

interface PartialMatch {
  substring: string;
  key: string;
}

/** Derive a deterministic HSL color from a string so every unknown tool gets a unique color. */
function deriveColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 50%)`;
}

const TOOL_META: Record<string, ToolMetaEntry> = {
  // Tools with SVG icons
  claude: { label: 'Claude Code', icon: '/assets/claude-code.svg', color: '#d9773c' },
  cursor: { label: 'Cursor', icon: '/assets/cursor.svg', color: '#111111' },
  windsurf: { label: 'Windsurf', icon: '/assets/windsurf.svg', color: '#0f8b7b' },
  vscode: { label: 'VS Code', icon: '/assets/vscode.svg', color: '#0078d4' },
  codex: { label: 'Codex', icon: '/assets/codex.svg', color: '#10a37f' },
  aider: { label: 'Aider', icon: '/assets/aider.svg', color: '#297a4a' },
  amazonq: { label: 'Amazon Q', icon: '/assets/amazon-q.svg', color: '#5b36d6' },
  jetbrains: { label: 'JetBrains', icon: '/assets/jetbrains.svg', color: '#f97316' },
  continue: { label: 'Continue', icon: '/assets/continue.svg', color: '#047857' },
  cline: { label: 'Cline', icon: '/assets/cline.svg', color: '#c2410c' },
  warp: { label: 'Warp', icon: '/assets/warp.svg', color: '#01a4ff' },
  zed: { label: 'Zed', icon: '/assets/zed.svg', color: '#09090b' },
  copilot: { label: 'GitHub Copilot', icon: '/assets/github-copilot.svg', color: '#6e40c9' },

  // Tools without SVGs - get colored letter fallback
  devin: { label: 'Devin', icon: null, color: '#4f46e5' },
  superset: { label: 'Superset', icon: null, color: '#0ea5e9' },
  replit: { label: 'Replit', icon: null, color: '#f26207' },
  goose: { label: 'Goose', icon: null, color: '#1d4ed8' },
  amp: { label: 'Amp', icon: null, color: '#a855f7' },
  kiro: { label: 'Kiro', icon: null, color: '#ff9900' },
  augment: { label: 'Augment Code', icon: null, color: '#8b5cf6' },
  cody: { label: 'Cody', icon: null, color: '#a112ff' },
  tabnine: { label: 'Tabnine', icon: null, color: '#e44332' },
  opencode: { label: 'OpenCode', icon: null, color: '#22c55e' },
  roocode: { label: 'Roo Code', icon: null, color: '#3b82f6' },
  pieces: { label: 'Pieces', icon: null, color: '#111111' },
  boltnew: { label: 'Bolt.new', icon: null, color: '#1389fd' },
  lovable: { label: 'Lovable', icon: null, color: '#ec4899' },
  v0: { label: 'v0', icon: null, color: '#000000' },
  trae: { label: 'Trae', icon: null, color: '#3b82f6' },
  void: { label: 'Void', icon: null, color: '#6366f1' },
  pearai: { label: 'PearAI', icon: null, color: '#84cc16' },
  sweep: { label: 'Sweep AI', icon: null, color: '#8b5cf6' },
  blackbox: { label: 'BLACKBOX AI', icon: null, color: '#111111' },
  coderabbit: { label: 'CodeRabbit', icon: null, color: '#f97316' },
  greptile: { label: 'Greptile', icon: null, color: '#047857' },
  qodo: { label: 'Qodo', icon: null, color: '#3b82f6' },
  ellipsis: { label: 'Ellipsis', icon: null, color: '#7c3aed' },
  mintlify: { label: 'Mintlify', icon: null, color: '#0d9373' },
  wisprflow: { label: 'Wispr Flow', icon: null, color: '#6366f1' },
  superwhisper: { label: 'Superwhisper', icon: null, color: '#f43f5e' },
  sourcery: { label: 'Sourcery', icon: null, color: '#f59e0b' },
  phind: { label: 'Phind', icon: null, color: '#6366f1' },
};

// ── MCP_TOOLS overlay ────────────────────────────────
// For registry tools, ensure the label stays in sync with tool-registry.ts.
// Maps MCP_TOOLS id → TOOL_META key (normalized form used in lookups).
const MCP_TO_META: Record<string, string> = {
  'claude-code': 'claude',
  cursor: 'cursor',
  windsurf: 'windsurf',
  vscode: 'vscode',
  codex: 'codex',
  aider: 'aider',
  jetbrains: 'jetbrains',
  'amazon-q': 'amazonq',
  cline: 'cline',
};

for (const tool of MCP_TOOLS) {
  const metaKey = MCP_TO_META[tool.id];
  if (metaKey && TOOL_META[metaKey]) {
    // Sync label from the single source of truth (tool-registry.ts)
    TOOL_META[metaKey].label = tool.name;
  }
}

// Normalize tool IDs for matching (strip spaces, dashes, underscores, lowercase)
export function normalizeToolId(toolId: string | null | undefined): string {
  return String(toolId || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[_.-]/g, '');
}

// Aliases: map various ID forms to canonical TOOL_META keys
const ALIASES: Record<string, string> = {
  claudecode: 'claude',
  amazonqdeveloper: 'amazonq',
  visualstudiocode: 'vscode',
  githubcopilot: 'copilot',
  codexcli: 'codex',
  goosebyblock: 'goose',
  ampbysourcegraph: 'amp',
  codybysourcegraph: 'cody',
  augmentcode: 'augment',
  roocode: 'roocode',
  traeide: 'trae',
  sweepai: 'sweep',
  blackboxai: 'blackbox',
  wisprflow: 'wisprflow',
  piecesfordevelopers: 'pieces',
  boltnew: 'boltnew',
  v0byvercel: 'v0',
  windsurf: 'windsurf',
  windsurfeditor: 'windsurf',
};

// Explicit ordered partial matches for tools whose real-world IDs include
// the canonical key with extra suffixes (e.g. "jetbrainsaiassistant" -> "jetbrains").
// Checked in order - put longer substrings first to avoid ambiguous matches.
// Only add entries here when an alias can't cover the variant.
const PARTIAL_MATCHES: PartialMatch[] = [
  { substring: 'jetbrains', key: 'jetbrains' },
  { substring: 'amazonq', key: 'amazonq' },
  { substring: 'windsurf', key: 'windsurf' },
  { substring: 'continue', key: 'continue' },
  { substring: 'copilot', key: 'copilot' },
  { substring: 'cursor', key: 'cursor' },
  { substring: 'claude', key: 'claude' },
  { substring: 'codex', key: 'codex' },
  { substring: 'cline', key: 'cline' },
  { substring: 'aider', key: 'aider' },
  { substring: 'devin', key: 'devin' },
  { substring: 'goose', key: 'goose' },
];

// Dev-time validation: verify ALIASES and PARTIAL_MATCHES reference valid TOOL_META keys
if (import.meta.env?.DEV) {
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (!TOOL_META[target]) {
      console.warn(`[toolMeta] ALIAS "${alias}" → "${target}" not found in TOOL_META`);
    }
  }
  for (const { substring, key } of PARTIAL_MATCHES) {
    if (!TOOL_META[key]) {
      console.warn(
        `[toolMeta] PARTIAL_MATCHES key "${key}" (substring: "${substring}") not found in TOOL_META`,
      );
    }
  }
}

export function getToolMeta(toolId: string | null | undefined): ResolvedToolMeta {
  const normalized = normalizeToolId(toolId);

  // Check aliases first
  const aliasKey = ALIASES[normalized];
  if (aliasKey && TOOL_META[aliasKey]) {
    return { id: aliasKey, ...TOOL_META[aliasKey] };
  }

  // Direct match
  if (TOOL_META[normalized]) {
    return { id: normalized, ...TOOL_META[normalized] };
  }

  // Explicit partial matches - deterministic order, no iteration-order surprises
  for (const { substring, key } of PARTIAL_MATCHES) {
    if (normalized.includes(substring)) {
      if (import.meta.env?.DEV) {
        console.warn(
          `[toolMeta] Partial match: "${toolId}" → "${key}" (consider adding an explicit ALIAS)`,
        );
      }
      return { id: key, ...TOOL_META[key] };
    }
  }

  // Fallback: auto-format the name, derive a unique color from the tool ID
  const pretty = String(toolId || 'tool')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return {
    id: normalized || 'tool',
    label: pretty,
    icon: null,
    color: deriveColor(normalized || 'tool'),
  };
}

/** Returns true if toolId resolves to a known AI coding tool (not a fallback). */
export function isKnownTool(toolId: string | null | undefined): boolean {
  // Known tools have an entry in TOOL_META (even without an icon SVG).
  // Fallback-generated entries have icon: null AND aren't in the registry.
  const normalized = normalizeToolId(toolId);
  return (
    !!TOOL_META[normalized] ||
    !!ALIASES[normalized] ||
    PARTIAL_MATCHES.some((pm) => normalized.includes(pm.substring))
  );
}

// Exported for testing only
export { TOOL_META, ALIASES, PARTIAL_MATCHES };
