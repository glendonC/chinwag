/**
 * Main Customize component that routes between sub-screens.
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { api } from '../api.js';
import { saveConfig, loadConfig } from '../config.js';
import type { ChinwagConfig } from '../config.js';
import { getInkColor, getColorList } from '../colors.js';
import { scanIntegrationHealth, summarizeIntegrationScan } from '../mcp-config.js';
import { classifyError } from '../utils/errors.js';
import { addToolToProject } from '../utils/tool-actions.js';
import { computeToolRecommendations } from '../utils/tool-recommendations.js';
import { evalToTool } from '../utils/tool-catalog.js';
import type { CatalogToolLike } from '../utils/tool-catalog.js';
import type { IntegrationScanResult } from '@chinwag/shared/integration-doctor.js';
import type {
  ToolCatalogEntry,
  ToolDirectoryResponse,
  ToolCatalogResponse,
} from '@chinwag/shared/contracts.js';
import type { HandleUpdateResponse } from '../types/api.js';
import { formatError, createLogger } from '@chinwag/shared';
import { FLASH_MIN_DURATION_MS, FLASH_MS_PER_CHAR } from '../constants/timings.js';

import { HandleScreen } from './HandleScreen.jsx';
import { ColorScreen } from './ColorScreen.jsx';
import { ToolsScreen } from './ToolsScreen.jsx';

const log = createLogger('customize');

let PKG_VERSION = '0.1.0';
try {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
  PKG_VERSION = pkg.version;
} catch (err: unknown) {
  log.error(formatError(err));
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
  log.error(formatError(err));
}

const IDE_COMMAND_SHORTCUT = process.platform === 'darwin' ? 'Cmd+Shift+P' : 'Ctrl+Shift+P';
const IDE_EXTENSION_DIR = fileURLToPath(new URL('../../vscode/', import.meta.url));

// ── Shared types ─────────────────────────────────────

interface FlashMessage {
  type: string;
  text: string;
}

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

// ── Main component ───────────────────────────────────

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
        const result = await api(config).get<ToolDirectoryResponse>('/tools/directory?limit=200');
        setTools((prev) => ({ ...prev, catalog: (result.evaluations || []).map(evalToTool) }));
      } catch (err: unknown) {
        log.error(formatError(err));
        try {
          const fallback = await api(config).get<ToolCatalogResponse>('/tools/catalog');
          setTools((prev) => ({ ...prev, catalog: fallback.tools || [] }));
        } catch (err2: unknown) {
          log.error('Fallback catalog fetch failed: ' + formatError(err2));
          showFlash(`Could not fetch tool catalog: ${formatError(err2)}`, 'error');
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
        log.error(formatError(err));
      }
      showFlash(
        wasInstalled
          ? `Updated — ${IDE_COMMAND_SHORTCUT} → "chinwag: Open Dashboard"`
          : `Installed — restart IDE, then ${IDE_COMMAND_SHORTCUT} → "chinwag: Open Dashboard"`,
      );
    } catch (err: unknown) {
      log.error(formatError(err));
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
    tools.catalog as ToolCatalogEntry[],
    tools.statuses,
  );
  const integrationSummary = summarizeIntegrationScan(tools.statuses, { onlyDetected: true });

  async function submitHandle(): Promise<void> {
    const newHandle = handleInput.trim().toLowerCase();
    if (!newHandle) return;

    try {
      const result = await api(config).put<HandleUpdateResponse>('/me/handle', {
        handle: newHandle,
      });
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
      <HandleScreen
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
      <ColorScreen
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
      <ToolsScreen
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
