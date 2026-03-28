import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { getInkColor } from './colors.js';

const MIN_COLS = 68;
const MIN_ROWS = 18;
const COMPACT_COLS = 104;

function RailPill({ item, active, compact }) {
  const accent = item.accent || 'cyan';
  const label = compact ? (item.shortLabel || item.label) : item.label;

  return (
    <Box borderStyle="round" borderColor={active ? accent : 'gray'} paddingX={1} marginRight={1}>
      <Text color={active ? accent : 'white'} dimColor={!active} bold={active}>{label}</Text>
      {item.meta ? <Text dimColor> {item.meta}</Text> : null}
    </Box>
  );
}

export function ModeRail({ items = [], activeKey, compact = false }) {
  if (!items.length) return null;

  return (
    <Box flexDirection="row">
      {items.map((item) => (
        <RailPill key={item.key} item={item} active={item.key === activeKey} compact={compact} />
      ))}
    </Box>
  );
}

function OperatorBadge({ user }) {
  if (!user?.handle) {
    return <Text dimColor>local operator</Text>;
  }

  return (
    <Text>
      <Text dimColor>@</Text>
      <Text color={getInkColor(user.color || 'white')} bold>{user.handle}</Text>
    </Text>
  );
}

export function ControlShell({
  modeItems = [],
  activeMode,
  user,
  footerText = '[tab] next mode  [shift+tab] previous  [q] quit',
  children,
}) {
  const { stdout } = useStdout();
  const cols = stdout?.columns || 80;
  const rows = stdout?.rows || 24;
  const compact = cols < COMPACT_COLS;

  if (cols < MIN_COLS || rows < MIN_ROWS) {
    return (
      <Box flexDirection="column" paddingX={2} paddingTop={1}>
        <Text color="yellow" bold>chinwag needs a larger terminal</Text>
        <Text dimColor>Current size: {cols} x {rows}</Text>
        <Text dimColor>Recommended minimum: {MIN_COLS} x {MIN_ROWS}</Text>
        <Text>{''}</Text>
        <Text>Resize the terminal pane or reduce the terminal font size.</Text>
        <Text dimColor>chinwag cannot force-resize the host terminal for you.</Text>
        <Text>{''}</Text>
        <Text dimColor>[q] quit</Text>
      </Box>
    );
  }

  const divider = '─'.repeat(Math.max(12, cols - 4));
  const viewportRows = Math.max(rows - 5, 8);

  return (
    <Box flexDirection="column" height={rows}>
      <Box flexDirection="column" paddingX={2} paddingTop={1} flexShrink={0}>
        <ModeRail items={modeItems} activeKey={activeMode} compact={compact} />
        <Text dimColor>{divider}</Text>
      </Box>

      <Box flexDirection="column" paddingX={2} height={viewportRows} flexGrow={1}>
        {typeof children === 'function'
          ? children({ cols, rows, viewportRows, compact })
          : children}
      </Box>

      <Box flexDirection="column" paddingX={2} paddingBottom={1} flexShrink={0}>
        <Text dimColor>{divider}</Text>
        <Box justifyContent="space-between">
          <Text dimColor>{footerText}</Text>
          <OperatorBadge user={user} />
        </Box>
      </Box>
    </Box>
  );
}
