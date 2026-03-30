import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { api } from './api.js';
import { saveConfig, loadConfig } from './config.js';
import { getInkColor, getColorList } from './colors.js';
import { MCP_TOOLS } from './tools.js';
import { configureTool, scanIntegrationHealth, summarizeIntegrationScan } from './mcp-config.js';

let PKG_VERSION = '0.1.0';
try {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
  PKG_VERSION = pkg.version;
} catch { /* fallback */ }

let VSCODE_EXTENSION = { publisher: 'chinwag', name: 'chinwag', version: PKG_VERSION };
try {
  const pkg = JSON.parse(readFileSync(new URL('../../vscode/package.json', import.meta.url), 'utf-8'));
  VSCODE_EXTENSION = {
    publisher: pkg.publisher || 'chinwag',
    name: pkg.name || 'chinwag',
    version: pkg.version || PKG_VERSION,
  };
} catch { /* fallback */ }

const IDE_COMMAND_SHORTCUT = process.platform === 'darwin' ? 'Cmd+Shift+P' : 'Ctrl+Shift+P';
const IDE_EXTENSION_DIR = fileURLToPath(new URL('../../vscode/', import.meta.url));
const MAX_RECOMMENDATIONS = 9;

export function Customize({ config, user, navigate, refreshUser }) {
  const { stdout } = useStdout();
  const cols = stdout?.columns || 80;
  const [mode, setMode] = useState('menu');
  const [handleInput, setHandleInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const colors = getColorList();
  const [colorIdx, setColorIdx] = useState(() => {
    const current = user?.color || config?.color;
    const idx = colors.indexOf(current);
    return idx >= 0 ? idx : 0;
  });
  const [message, setMessage] = useState(null);
  const messageTimer = useRef(null);

  // Tools state
  const [integrationStatuses, setIntegrationStatuses] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [toolsLoading, setToolsLoading] = useState(false);

  const menuItems = useMemo(() => [
    { key: 'h', label: 'Change handle', action: 'handle' },
    { key: 'k', label: 'Change color', action: 'color' },
    { key: 't', label: 'Connected tools', action: 'tools' },
    { key: 'e', label: 'IDE extension', action: 'ide' },
  ], []);

  useEffect(() => {
    return () => { if (messageTimer.current) clearTimeout(messageTimer.current); };
  }, []);

  function showFlash(text, type = 'success') {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setMessage({ type, text });
    const duration = Math.max(3000, text.length * 40);
    messageTimer.current = setTimeout(() => setMessage(null), duration);
  }

  function enterMode(action) {
    if (action === 'color') {
      const current = user?.color || config?.color;
      const idx = colors.indexOf(current);
      setColorIdx(idx >= 0 ? idx : 0);
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

  function loadTools() {
    setToolsLoading(true);
    setIntegrationStatuses(scanIntegrationHealth(process.cwd()));

    async function fetchCatalog() {
      try {
        const result = await api(config).get('/tools/catalog');
        setCatalog(result.tools || []);
      } catch (err) {
        showFlash(`Could not fetch tool catalog: ${err.message}`, 'error');
      }
      setToolsLoading(false);
    }
    fetchCatalog();
  }

  function installIdeExtension() {
    const extName = `${VSCODE_EXTENSION.publisher}.${VSCODE_EXTENSION.name}-${VSCODE_EXTENSION.version}`;
    const ideDirs = ['.cursor', '.windsurf', '.vscode'];
    const ideDir = ideDirs.find(d => existsSync(join(homedir(), d))) || '.vscode';
    const target = join(homedir(), ideDir, 'extensions', extName);
    const wasInstalled = existsSync(target);
    try {
      mkdirSync(target, { recursive: true });
      cpSync(join(IDE_EXTENSION_DIR, 'package.json'), join(target, 'package.json'));
      cpSync(join(IDE_EXTENSION_DIR, 'dist', 'extension.js'), join(target, 'extension.js'));
      try { cpSync(join(IDE_EXTENSION_DIR, 'logo-mark.svg'), join(target, 'logo-mark.svg')); } catch {}
      showFlash(wasInstalled
        ? `Updated — ${IDE_COMMAND_SHORTCUT} → "chinwag: Open Dashboard"`
        : `Installed — restart IDE, then ${IDE_COMMAND_SHORTCUT} → "chinwag: Open Dashboard"`);
    } catch {
      if (wasInstalled) {
        showFlash(`${IDE_COMMAND_SHORTCUT} → "chinwag: Open Dashboard"`);
      } else {
        showFlash('Could not install IDE extension. Check file permissions.', 'error');
      }
    }
  }

  function addTool(tool) {
    const mcpTool = MCP_TOOLS.find(t => t.id === tool.id);
    if (mcpTool) {
      const result = configureTool(process.cwd(), tool.id);
      if (result.ok) {
        showFlash(`Added ${result.name}: ${result.detail}`);
        setIntegrationStatuses(scanIntegrationHealth(process.cwd()));
      } else {
        showFlash(`Could not add ${result.name || tool.name}: ${result.error}`, 'error');
      }
    } else if (tool.installCmd) {
      showFlash(`${tool.name} — Install: ${tool.installCmd}  |  ${tool.website}`);
    } else if (tool.website) {
      showFlash(`${tool.name} — Visit: ${tool.website}`);
    }
  }

  // Compute recommendations for tools mode
  const detected = integrationStatuses.filter((item) => item.detected);
  const detectedIds = new Set(detected.map(t => t.id));
  const integrationSummary = summarizeIntegrationScan(integrationStatuses, { onlyDetected: true });
  const detectedCategories = new Set(
    catalog.filter(t => detectedIds.has(t.id)).map(t => t.category)
  );
  const complementary = catalog.filter(t =>
    !detectedIds.has(t.id) && t.category && !detectedCategories.has(t.category)
  );
  const recommendations = (complementary.length > 0
    ? complementary
    : catalog.filter(t => !detectedIds.has(t.id) && t.featured)
  ).slice(0, MAX_RECOMMENDATIONS);

  useInput((ch, key) => {
    if (key.escape) {
      if (mode === 'menu') {
        navigate('dashboard');
      } else {
        setMode('menu');
        setMessage(null);
      }
      return;
    }

    if (mode === 'menu') {
      if (key.upArrow) {
        setCursor(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setCursor(prev => Math.min(menuItems.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        const item = menuItems[cursor];
        if (item) enterMode(item.action);
        return;
      }
      const match = menuItems.find(m => m.key === ch);
      if (match) enterMode(match.action);
      return;
    }

    if (mode === 'color') {
      if (key.upArrow) {
        setColorIdx(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setColorIdx(prev => Math.min(colors.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        saveColor(colors[colorIdx]);
        return;
      }
    }

    if (mode === 'tools') {
      const num = parseInt(ch, 10);
      if (num >= 1 && num <= recommendations.length) {
        addTool(recommendations[num - 1]);
        return;
      }
    }
  });

  async function submitHandle() {
    const newHandle = handleInput.trim().toLowerCase();
    if (!newHandle) return;

    try {
      const result = await api(config).put('/me/handle', { handle: newHandle });
      if (result.error) {
        setMessage({ type: 'error', text: result.error });
        return;
      }
      const cfg = loadConfig();
      cfg.handle = newHandle;
      saveConfig(cfg);
      await refreshUser();
      setMessage({ type: 'success', text: `You're now ${newHandle}!` });
      setMode('menu');
    } catch (err) {
      const msg = err.status === 409 ? 'That handle is already taken.'
        : err.status === 400 ? 'Invalid handle. Use 3-20 alphanumeric characters.'
        : err.status >= 500 ? 'Server error. Try again shortly.'
        : err.message || 'Could not update handle.';
      setMessage({ type: 'error', text: msg });
    }
  }

  async function saveColor(color) {
    try {
      await api(config).put('/me/color', { color });
      const cfg = loadConfig();
      cfg.color = color;
      saveConfig(cfg);
      await refreshUser();
      setMessage({ type: 'success', text: 'Color updated!' });
      setMode('menu');
    } catch (err) {
      const msg = err.status >= 500 ? 'Server error. Try again shortly.'
        : err.message || 'Could not update color.';
      setMessage({ type: 'error', text: msg });
    }
  }

  const handle = user?.handle || config?.handle;
  const color = user?.color || config?.color;

  // ── Handle mode ──────────────────────────────────────
  if (mode === 'handle') {
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
        {message && (
          <Text color={message.type === 'error' ? 'red' : 'green'}>{message.text}</Text>
        )}
        <Text dimColor>[enter] save  [esc] back</Text>
      </Box>
    );
  }

  // ── Color mode ───────────────────────────────────────
  if (mode === 'color') {
    const previewColor = colors[colorIdx];
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Change color</Text>
        <Text>{''}</Text>
        <Text>Preview: <Text color={getInkColor(previewColor)} bold>{handle}</Text></Text>
        <Text>{''}</Text>
        {colors.map((c, i) => {
          const isSelected = i === colorIdx;
          return (
            <Text key={c}>
              <Text>{isSelected ? '▸' : ' '} </Text>
              <Text color={getInkColor(c)} bold={isSelected}>{c}</Text>
              {c === color && <Text dimColor> (current)</Text>}
            </Text>
          );
        })}
        <Text>{''}</Text>
        <Text dimColor>[up/down] select  [enter] save  [esc] back</Text>
      </Box>
    );
  }

  // ── Tools mode ───────────────────────────────────────
  if (mode === 'tools') {
    if (toolsLoading) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text dimColor>Loading tools...</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold>Connected tools</Text>
          <Text dimColor> ({detected.length} detected)</Text>
        </Box>

        {detected.length === 0 ? (
          <Box marginBottom={1}>
            <Text dimColor>No tools detected. Run `npx chinwag init` first.</Text>
          </Box>
        ) : (() => {
          const maxName = Math.max(...detected.map(t => t.name.length));
          return (
            <Box flexDirection="column" marginBottom={1}>
              {detected.map(tool => {
                let detail = tool.mcpConfig;
                if (tool.hooks) detail += ' + hooks';
                if (tool.channel) detail += ' + channel';
                const statusColor = tool.status === 'ready' ? 'green'
                  : tool.status === 'needs_repair' ? 'yellow'
                  : tool.status === 'needs_setup' ? 'yellow'
                  : 'gray';
                const statusText = tool.status.replace(/_/g, ' ');
                return (
                  <Box key={tool.id} flexDirection="column">
                    <Text>
                      <Text color={tool.status === 'ready' ? 'green' : 'yellow'}>{'● '}</Text>
                      <Text>{tool.name.padEnd(maxName + 1)}</Text>
                      <Text dimColor>{detail}</Text>
                      <Text dimColor>  </Text>
                      <Text color={statusColor}>{statusText}</Text>
                    </Text>
                    {tool.issues?.[0] && (
                      <Text dimColor>   {tool.issues[0]}</Text>
                    )}
                  </Box>
                );
              })}
            </Box>
          );
        })()}

        {detected.length > 0 && (
          <Box marginBottom={1}>
            <Text color={integrationSummary.tone === 'success' ? 'green' : integrationSummary.tone === 'warning' ? 'yellow' : 'cyan'}>
              {integrationSummary.text}
            </Text>
          </Box>
        )}

        {recommendations.length > 0 && (() => {
          const maxName = Math.max(...recommendations.map(t => t.name.length));
          const descAvail = cols - 3 - 4 - (maxName + 1) - 6;
          return (
            <>
              <Box marginBottom={1}>
                <Text bold>Recommended</Text>
              </Box>
              <Box flexDirection="column" marginBottom={1}>
                {recommendations.map((tool, i) => {
                  const desc = descAvail > 10 && tool.description.length > descAvail
                    ? tool.description.slice(0, descAvail - 1) + '\u2026'
                    : tool.description;
                  return (
                    <Text key={tool.id}>
                      <Text color="cyan" bold>[{i + 1}]</Text>
                      <Text> {tool.name.padEnd(maxName + 1)}</Text>
                      <Text dimColor>{desc}</Text>
                      {tool.mcpCompatible && <Text color="green"> [MCP]</Text>}
                    </Text>
                  );
                })}
              </Box>
            </>
          );
        })()}

        {message && (
          <Box marginBottom={1}>
            <Text color={message.type === 'error' ? 'red' : 'green'}>{message.text}</Text>
          </Box>
        )}

        <Text>
          {recommendations.length > 0 && (
            <><Text color="cyan" bold>[1-{recommendations.length}]</Text><Text dimColor> add  </Text></>
          )}
          <Text dimColor>[esc] back</Text>
        </Text>
      </Box>
    );
  }

  // ── Main menu ────────────────────────────────────────
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Settings</Text>
      <Text>{''}</Text>
      <Text>Current: <Text color={getInkColor(color)} bold>{handle}</Text></Text>
      <Text>{''}</Text>

      {menuItems.map((item, i) => {
        const isSelected = i === cursor;
        return (
          <Text key={item.key}>
            <Text>{isSelected ? '▸' : ' '} </Text>
            <Text bold={isSelected}>[{item.key}]</Text>
            <Text bold={isSelected}> {item.label}</Text>
          </Text>
        );
      })}

      <Text>{''}</Text>
      {message && (
        <>
          <Text color={message.type === 'error' ? 'red' : 'green'}>{message.text}</Text>
          <Text>{''}</Text>
        </>
      )}
      <Text dimColor>[up/down] navigate  [enter] select  [esc] back</Text>
    </Box>
  );
}
