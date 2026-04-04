import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { api } from './api.js';
import { saveConfig, loadConfig } from './config.js';
import type { ChinwagConfig } from './config.js';
import { getInkColor, getColorList } from './colors.js';
import { scanIntegrationHealth, summarizeIntegrationScan } from './mcp-config.js';
import { classifyError } from './utils/errors.js';
import { addToolToProject } from './utils/tool-actions.js';
import { computeToolRecommendations } from './utils/tool-recommendations.js';
import { DetectedToolsList, RecommendationsList } from './tool-display.jsx';
import type { IntegrationScanResult } from '@chinwag/shared/integration-doctor.js';

interface CatalogToolLike {
  id: string;
  name: string;
  description: string;
  category?: string;
  mcpCompatible?: boolean;
  website?: string;
  installCmd?: string | null;
  featured?: boolean;
  verdict?: string;
  confidence?: string;
}

interface EvalEntry {
  id: string;
  name: string;
  tagline: string;
  category?: string;
  mcp_support?: boolean;
  metadata?: { website?: string; install_command?: string; featured?: boolean };
  verdict?: string;
  confidence?: string;
}

function evalToTool(e: EvalEntry): CatalogToolLike {
  const meta = e.metadata || {};
  return {
    id: e.id,
    name: e.name,
    description: e.tagline,
    category: e.category,
    mcpCompatible: !!e.mcp_support,
    website: meta.website,
    installCmd: meta.install_command,
    featured: !!meta.featured,
    verdict: e.verdict,
    confidence: e.confidence,
  };
}

let PKG_VERSION = '0.1.0';
try {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
  PKG_VERSION = pkg.version;
} catch (err: unknown) {
  console.error('[chinwag]', (err as Error)?.message || err);
}

let VSCODE_EXTENSION = { publisher: 'chinwag', name: 'chinwag', version: PKG_VERSION };
try {
  const pkg = JSON.parse(
    readFileSync(new URL('../../vscode/package.json', import.meta.url), 'utf-8'),
  );
  VSCODE_EXTENSION = {
    publisher: pkg.publisher || 'chinwag',
    name: pkg.name || 'chinwag',
    version: pkg.version || PKG_VERSION,
  };
} catch (err: unknown) {
  console.error('[chinwag]', (err as Error)?.message || err);
}

const IDE_COMMAND_SHORTCUT = process.platform === 'darwin' ? 'Cmd+Shift+P' : 'Ctrl+Shift+P';
const IDE_EXTENSION_DIR = fileURLToPath(new URL('../../vscode/', import.meta.url));
const FLASH_MIN_DURATION_MS = 3000;
const FLASH_MS_PER_CHAR = 40;

// ── Sub-screen: Handle editor ─────────────────────────

interface FlashMessage {
  type: string;
  text: string;
}

interface HandleModeProps {
  handleInput: string;
  setHandleInput: (value: string) => void;
  submitHandle: () => void;
  message: FlashMessage | null;
}

function HandleMode({
  handleInput,
  setHandleInput,
  submitHandle,
  message,
}: HandleModeProps): React.ReactNode {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Change handle</Text>
      <Text dimColor>3-20 characters, letters, numbers, underscores</Text>
      <Text>{''}</Text>
      <Box>
        <Text color="cyan">{'> '}</Text>
        <TextInput
          value={handleInput}
          onChange={setHandleInput}
          onSubmit={submitHandle}
          placeholder="newhandle"
        />
      </Box>
      <Text>{''}</Text>
      {message && <Text color={message.type === 'error' ? 'red' : 'green'}>{message.text}</Text>}
      <Text dimColor>[enter] save [esc] back</Text>
    </Box>
  );
}

// ── Sub-screen: Color picker ──────────────────────────

interface ColorModeProps {
  handle: string;
  currentColor: string;
  colors: string[];
  colorIdx: number;
}

function ColorMode({ handle, currentColor, colors, colorIdx }: ColorModeProps): React.ReactNode {
  const previewColor = colors[colorIdx];
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Change color</Text>
      <Text>{''}</Text>
      <Text>
        Preview:{' '}
        <Text color={getInkColor(previewColor)} bold>
          {handle}
        </Text>
      </Text>
      <Text>{''}</Text>
      {colors.map((c, i) => {
        const isSelected = i === colorIdx;
        return (
          <Text key={c}>
            <Text>{isSelected ? '▸' : ' '} </Text>
            <Text color={getInkColor(c)} bold={isSelected}>
              {c}
            </Text>
            {c === currentColor && <Text dimColor> (current)</Text>}
          </Text>
        );
      })}
      <Text>{''}</Text>
      <Text dimColor>[up/down] select [enter] save [esc] back</Text>
    </Box>
  );
}

// ── Sub-screen: Connected tools ───────────────────────

interface IntegrationSummary {
  text: string;
  tone: string;
}

interface ToolsModeProps {
  detected: IntegrationScanResult[];
  integrationSummary: IntegrationSummary | null;
  recommendations: CatalogToolLike[];
  cols: number;
  message: FlashMessage | null;
}

function ToolsMode({
  detected,
  integrationSummary,
  recommendations,
  cols,
  message,
}: ToolsModeProps): React.ReactNode {
  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Connected tools</Text>
        <Text dimColor> ({detected.length} detected)</Text>
      </Box>

      <DetectedToolsList
        detected={detected}
        integrationSummary={detected.length > 0 ? integrationSummary : null}
      />

      {recommendations.length > 0 && (
        <>
          <Box marginBottom={1}>
            <Text bold>Recommended</Text>
          </Box>
          <RecommendationsList recommendations={recommendations} cols={cols} />
        </>
      )}

      {message && (
        <Box marginBottom={1}>
          <Text color={message.type === 'error' ? 'red' : 'green'}>{message.text}</Text>
        </Box>
      )}

      <Text>
        {recommendations.length > 0 && (
          <>
            <Text color="cyan" bold>
              [1-{recommendations.length}]
            </Text>
            <Text dimColor> add </Text>
          </>
        )}
        <Text dimColor>[esc] back</Text>
      </Text>
    </Box>
  );
}

// ── Main Customize component ──────────────────────────

interface CustomizeUser {
  handle?: string;
  color?: string;
}

interface CustomizeProps {
  config: ChinwagConfig | null;
  user: CustomizeUser | null;
  navigate: (to: string) => void;
  refreshUser: () => Promise<void>;
}

interface NavState {
  mode: string;
  cursor: number;
  colorIdx: number;
}

interface ToolsState {
  loading: boolean;
  catalog: CatalogToolLike[];
  statuses: IntegrationScanResult[];
}

export function Customize({
  config,
  user,
  navigate,
  refreshUser,
}: CustomizeProps): React.ReactNode {
  const { stdout } = useStdout();
  const cols = stdout?.columns || 80;
  const [handleInput, setHandleInput] = useState('');
  const colors = getColorList();

  // ── Navigation state (mode + cursors) ───────────────
  const [nav, setNav] = useState<NavState>(() => {
    const current = user?.color || config?.color;
    const idx = current ? colors.indexOf(current) : -1;
    return { mode: 'menu', cursor: 0, colorIdx: idx >= 0 ? idx : 0 };
  });
  const setMode = (m: string): void => setNav((prev) => ({ ...prev, mode: m, cursor: 0 }));
  const setCursor = (fn: (prev: number) => number): void =>
    setNav((prev) => ({ ...prev, cursor: fn(prev.cursor) }));
  const setColorIdx = (fn: (prev: number) => number): void =>
    setNav((prev) => ({ ...prev, colorIdx: fn(prev.colorIdx) }));

  // ── Flash message state ─────────────────────────────
  const [flash, setFlash] = useState<FlashMessage | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Tools state ─────────────────────────────────────
  const [tools, setTools] = useState<ToolsState>({ loading: false, catalog: [], statuses: [] });

  const menuItems = useMemo(
    () => [
      { key: 'h', label: 'Change handle', action: 'handle' },
      { key: 'k', label: 'Change color', action: 'color' },
      { key: 't', label: 'Connected tools', action: 'tools' },
      { key: 'e', label: 'IDE extension', action: 'ide' },
    ],
    [],
  );

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  function showFlash(text: string, type = 'success'): void {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlash({ type, text });
    const duration = Math.max(FLASH_MIN_DURATION_MS, text.length * FLASH_MS_PER_CHAR);
    flashTimerRef.current = setTimeout(() => setFlash(null), duration);
  }

  function enterMode(action: string): void {
    if (action === 'color') {
      const current = user?.color || config?.color;
      const idx = current ? colors.indexOf(current) : -1;
      setNav((prev) => ({ ...prev, mode: 'color', cursor: 0, colorIdx: idx >= 0 ? idx : 0 }));
      return;
    }
    if (action === 'tools') {
      loadTools();
    }
    if (action === 'ide') {
      installIdeExtension();
      return; // Action, not a sub-screen
    }
    setMode(action);
  }

  function loadTools(): void {
    setTools((prev) => ({
      ...prev,
      loading: true,
      statuses: scanIntegrationHealth(process.cwd()),
    }));

    async function fetchCatalog(): Promise<void> {
      try {
        const result = (await api(config).get('/tools/directory?limit=200')) as {
          evaluations?: EvalEntry[];
          categories?: Record<string, string>;
        };
        setTools((prev) => ({ ...prev, catalog: (result.evaluations || []).map(evalToTool) }));
      } catch (err: unknown) {
        console.error('[chinwag]', (err as Error)?.message || err);
        try {
          const fallback = (await api(config).get('/tools/catalog')) as {
            tools?: CatalogToolLike[];
            categories?: Record<string, string>;
          };
          setTools((prev) => ({ ...prev, catalog: fallback.tools || [] }));
        } catch (err2: unknown) {
          showFlash(`Could not fetch tool catalog: ${(err2 as Error).message}`, 'error');
        }
      }
      setTools((prev) => ({ ...prev, loading: false }));
    }
    fetchCatalog();
  }

  function installIdeExtension(): void {
    const extName = `${VSCODE_EXTENSION.publisher}.${VSCODE_EXTENSION.name}-${VSCODE_EXTENSION.version}`;
    const ideDirs = ['.cursor', '.windsurf', '.vscode'];
    const ideDir = ideDirs.find((d) => existsSync(join(homedir(), d))) || '.vscode';
    const target = join(homedir(), ideDir, 'extensions', extName);
    const wasInstalled = existsSync(target);
    try {
      mkdirSync(target, { recursive: true });
      cpSync(join(IDE_EXTENSION_DIR, 'package.json'), join(target, 'package.json'));
      cpSync(join(IDE_EXTENSION_DIR, 'dist', 'extension.js'), join(target, 'extension.js'));
      try {
        cpSync(join(IDE_EXTENSION_DIR, 'logo-mark.svg'), join(target, 'logo-mark.svg'));
      } catch (err: unknown) {
        console.error('[chinwag]', (err as Error)?.message || err);
      }
      showFlash(
        wasInstalled
          ? `Updated — ${IDE_COMMAND_SHORTCUT} → "chinwag: Open Dashboard"`
          : `Installed — restart IDE, then ${IDE_COMMAND_SHORTCUT} → "chinwag: Open Dashboard"`,
      );
    } catch (err: unknown) {
      console.error('[chinwag]', (err as Error)?.message || err);
      if (wasInstalled) {
        showFlash(`${IDE_COMMAND_SHORTCUT} → "chinwag: Open Dashboard"`);
      } else {
        showFlash('Could not install IDE extension. Check file permissions.', 'error');
      }
    }
  }

  function addTool(tool: CatalogToolLike): void {
    const result = addToolToProject(tool, process.cwd());
    if (result.ok) {
      showFlash(result.message);
      setTools((prev) => ({ ...prev, statuses: scanIntegrationHealth(process.cwd()) }));
    } else {
      showFlash(result.message, 'error');
    }
  }

  // Compute recommendations for tools mode
  const { detected, recommendations } = computeToolRecommendations(
    tools.catalog as import('@chinwag/shared/contracts.js').ToolCatalogEntry[],
    tools.statuses,
  );
  const integrationSummary = summarizeIntegrationScan(tools.statuses, { onlyDetected: true });

  async function submitHandle(): Promise<void> {
    const newHandle = handleInput.trim().toLowerCase();
    if (!newHandle) return;

    try {
      const result = (await api(config).put('/me/handle', { handle: newHandle })) as {
        error?: string;
      };
      if (result.error) {
        setFlash({ type: 'error', text: result.error });
        return;
      }
      const cfg = loadConfig() as ChinwagConfig;
      cfg.handle = newHandle;
      saveConfig(cfg);
      await refreshUser();
      setFlash({ type: 'success', text: `You're now ${newHandle}!` });
      setMode('menu');
    } catch (err: unknown) {
      const typedErr = err as { status?: number; message?: string };
      const msg =
        typedErr.status === 409
          ? 'That handle is already taken.'
          : typedErr.status === 400
            ? 'Invalid handle. Use 3-20 alphanumeric characters.'
            : classifyError(typedErr).detail || 'Could not update handle.';
      setFlash({ type: 'error', text: msg });
    }
  }

  async function saveColor(color: string): Promise<void> {
    try {
      await api(config).put('/me/color', { color });
      const cfg = loadConfig() as ChinwagConfig;
      cfg.color = color;
      saveConfig(cfg);
      await refreshUser();
      setFlash({ type: 'success', text: 'Color updated!' });
      setMode('menu');
    } catch (err: unknown) {
      const msg =
        classifyError(err as { message?: string; status?: number }).detail ||
        'Could not update color.';
      setFlash({ type: 'error', text: msg });
    }
  }

  useInput((ch: string, key) => {
    if (key.escape) {
      if (nav.mode === 'menu') {
        navigate('dashboard');
      } else {
        setMode('menu');
        setFlash(null);
      }
      return;
    }

    if (nav.mode === 'menu') {
      if (key.upArrow) {
        setCursor((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((prev) => Math.min(menuItems.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        const item = menuItems[nav.cursor];
        if (item) enterMode(item.action);
        return;
      }
      const match = menuItems.find((m) => m.key === ch);
      if (match) enterMode(match.action);
      return;
    }

    if (nav.mode === 'color') {
      if (key.upArrow) {
        setColorIdx((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setColorIdx((prev) => Math.min(colors.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        saveColor(colors[nav.colorIdx]);
        return;
      }
    }

    if (nav.mode === 'tools') {
      const num = parseInt(ch, 10);
      if (num >= 1 && num <= recommendations.length) {
        addTool(recommendations[num - 1]);
        return;
      }
    }
  });

  const handle = user?.handle || config?.handle;
  const color = user?.color || config?.color;

  // ── Handle mode ──────────────────────────────────────
  if (nav.mode === 'handle') {
    return (
      <HandleMode
        handleInput={handleInput}
        setHandleInput={setHandleInput}
        submitHandle={submitHandle}
        message={flash}
      />
    );
  }

  // ── Color mode ───────────────────────────────────────
  if (nav.mode === 'color') {
    return (
      <ColorMode
        handle={handle || ''}
        currentColor={color || ''}
        colors={colors}
        colorIdx={nav.colorIdx}
      />
    );
  }

  // ── Tools mode ───────────────────────────────────────
  if (nav.mode === 'tools') {
    if (tools.loading) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text dimColor>Loading tools...</Text>
        </Box>
      );
    }

    return (
      <ToolsMode
        detected={detected}
        integrationSummary={integrationSummary}
        recommendations={recommendations}
        cols={cols}
        message={flash}
      />
    );
  }

  // ── Main menu ────────────────────────────────────────
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Settings</Text>
      <Text>{''}</Text>
      <Text>
        Current:{' '}
        <Text color={getInkColor(color || 'white')} bold>
          {handle}
        </Text>
      </Text>
      <Text>{''}</Text>

      {menuItems.map((item, i) => {
        const isSelected = i === nav.cursor;
        return (
          <Text key={item.key}>
            <Text>{isSelected ? '▸' : ' '} </Text>
            <Text bold={isSelected}>[{item.key}]</Text>
            <Text bold={isSelected}> {item.label}</Text>
          </Text>
        );
      })}

      <Text>{''}</Text>
      {flash && (
        <>
          <Text color={flash.type === 'error' ? 'red' : 'green'}>{flash.text}</Text>
          <Text>{''}</Text>
        </>
      )}
      <Text dimColor>[up/down] navigate [enter] select [esc] back</Text>
    </Box>
  );
}
