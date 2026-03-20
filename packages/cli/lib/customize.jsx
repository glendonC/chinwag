import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { api } from './api.js';
import { saveConfig, loadConfig } from './config.js';
import { getInkColor, getColorList } from './colors.js';

export function Customize({ config, user, navigate, refreshUser }) {
  const [mode, setMode] = useState('menu');
  const [handleInput, setHandleInput] = useState('');
  const [statusInput, setStatusInput] = useState(user?.status || '');
  const [cursor, setCursor] = useState(0);
  const colors = getColorList();
  const [colorIdx, setColorIdx] = useState(() => {
    const current = user?.color || config?.color;
    const idx = colors.indexOf(current);
    return idx >= 0 ? idx : 0;
  });
  const [message, setMessage] = useState(null);

  const menuItems = useMemo(() => [
    { key: 'h', label: 'Change handle', action: 'handle' },
    { key: 'k', label: 'Change color', action: 'color' },
    { key: 's', label: 'Set status', action: 'status' },
  ], []);

  function enterMode(action) {
    if (action === 'color') {
      const current = user?.color || config?.color;
      const idx = colors.indexOf(current);
      setColorIdx(idx >= 0 ? idx : 0);
    }
    if (action === 'status') {
      setStatusInput(user?.status || '');
    }
    setMode(action);
  }

  useInput((ch, key) => {
    if (key.escape) {
      if (mode === 'menu') {
        navigate('home');
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
      setMessage({ type: 'error', text: err.message });
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
      setMessage({ type: 'error', text: err.message });
    }
  }

  async function submitStatus() {
    const value = statusInput.trim();
    try {
      if (value) {
        await api(config).put('/status', { status: value });
      } else {
        await api(config).del('/status');
      }
      await refreshUser();
      setMessage({ type: 'success', text: value ? 'Status updated!' : 'Status cleared!' });
      setMode('menu');
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  const handle = user?.handle || config?.handle;
  const color = user?.color || config?.color;

  if (mode === 'handle') {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
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
        <Text dimColor>[enter] Save  ·  [esc] Back</Text>
      </Box>
    );
  }

  if (mode === 'color') {
    const previewColor = colors[colorIdx];
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
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
        <Text dimColor>[↑↓] Select  ·  [enter] Save  ·  [esc] Back</Text>
      </Box>
    );
  }

  if (mode === 'status') {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
        <Text bold>Set your status</Text>
        <Text dimColor>What are you working on? (leave empty to clear)</Text>
        <Text>{''}</Text>
        <Box>
          <Text color="cyan">{'> '}</Text>
          <TextInput
            value={statusInput}
            onChange={setStatusInput}
            onSubmit={submitStatus}
            placeholder="building something cool..."
          />
        </Box>
        <Text>{''}</Text>
        {message && (
          <Text color={message.type === 'error' ? 'red' : 'green'}>{message.text}</Text>
        )}
        <Text dimColor>[enter] Save  ·  [esc] Back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="gray">
      <Text bold>Customize</Text>
      <Text>{''}</Text>
      <Text>Current: <Text color={getInkColor(color)} bold>{handle}</Text></Text>
      {user?.status && <Text dimColor>— {user.status}</Text>}
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
      <Text dimColor>[↑↓] Navigate  ·  [enter] Select  ·  [esc] Back</Text>
    </Box>
  );
}
