/**
 * Main Customize component that routes between sub-screens.
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { api } from '../api.js';
import { saveConfig, loadConfig } from '../config.js';
import type { ChinmeisterConfig } from '../config.js';
import { getInkColor, getColorList } from '../colors.js';
import { scanIntegrationHealth, summarizeIntegrationScan } from '../mcp-config.js';
import { classifyError } from '../utils/errors.js';
import type { IntegrationScanResult } from '@chinmeister/shared/integration-doctor.js';
import type { HandleUpdateResponse } from '../types/api.js';
import { formatError, createLogger } from '@chinmeister/shared';
import { FLASH_MIN_DURATION_MS, FLASH_MS_PER_CHAR } from '../constants/timings.js';

import { HandleScreen } from './HandleScreen.jsx';
import { ColorScreen } from './ColorScreen.jsx';
import { ToolsScreen } from './ToolsScreen.jsx';

const log = createLogger('customize');

/** Same as cli bundle: entry is dist/cli.js, package root is one level up from dist/. */
const _CLI_ROOT = dirname(fileURLToPath(import.meta.url));

let PKG_VERSION = '0.1.0';
try {
  const pkg = JSON.parse(readFileSync(join(_CLI_ROOT, '..', 'package.json'), 'utf-8'));
  PKG_VERSION = pkg.version;
} catch {
  /* keep default — bundled path must resolve; missing file is non-fatal */
}

let VSCODE_EXTENSION = { publisher: 'chinmeister', name: 'chinmeister', version: PKG_VERSION };
const vscodePkgPath = join(_CLI_ROOT, '..', 'vscode', 'package.json');
if (existsSync(vscodePkgPath)) {
  try {
    const pkg = JSON.parse(readFileSync(vscodePkgPath, 'utf-8'));
    VSCODE_EXTENSION = {
      publisher: pkg.publisher || 'chinmeister',
      name: pkg.name || 'chinmeister',
      version: pkg.version || PKG_VERSION,
    };
  } catch {
    /* keep defaults */
  }
}

const IDE_COMMAND_SHORTCUT = process.platform === 'darwin' ? 'Cmd+Shift+P' : 'Ctrl+Shift+P';
const IDE_EXTENSION_DIR = join(_CLI_ROOT, '..', 'vscode');

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
  config: ChinmeisterConfig | null;
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
  statuses: IntegrationScanResult[];
}

// ── Main component ───────────────────────────────────

export function Customize({
  config,
  user,
  navigate,
  refreshUser,
}: CustomizeProps): React.ReactNode {
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
  const [tools, setTools] = useState<ToolsState>({ statuses: [] });

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
      setTools({ statuses: scanIntegrationHealth(process.cwd()) });
    }
    if (action === 'ide') {
      installIdeExtension();
      return; // Action, not a sub-screen
    }
    setMode(action);
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
          ? `Updated — ${IDE_COMMAND_SHORTCUT} → "chinmeister: Open Dashboard"`
          : `Installed — restart IDE, then ${IDE_COMMAND_SHORTCUT} → "chinmeister: Open Dashboard"`,
      );
    } catch (err: unknown) {
      log.error(formatError(err));
      if (wasInstalled) {
        showFlash(`${IDE_COMMAND_SHORTCUT} → "chinmeister: Open Dashboard"`);
      } else {
        showFlash('Could not install IDE extension. Check file permissions.', 'error');
      }
    }
  }

  const detected = tools.statuses.filter((s) => s.detected);
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
      const cfg = loadConfig() as ChinmeisterConfig;
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
      const cfg = loadConfig() as ChinmeisterConfig;
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
        const selectedColor = colors[nav.colorIdx];
        if (selectedColor) saveColor(selectedColor);
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
    return (
      <ToolsScreen detected={detected} integrationSummary={integrationSummary} message={flash} />
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
