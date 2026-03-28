import React, { useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { getInkColor } from './colors.js';
import { getTerminalUiCapabilities } from './terminal-control.js';

const MIN_ROWS = 18;

function getRailWidth(items, compact) {
  if (!items?.length) return 0;

  return items.reduce((total, item) => {
    const label = compact ? (item.shortLabel || item.label) : item.label;
    const meta = item.meta ? ` ${item.meta}` : '';
    // Approximate pill width: borders + internal padding + label + gap.
    return total + label.length + meta.length + 6;
  }, 0);
}

function getNavHintWidth(compact) {
  const labels = compact
    ? ['← shift+tab', 'tab →']
    : ['← shift+tab', 'tab →'];
  return Math.max(...labels.map(label => label.length)) + 5;
}

function RailPill({ item, active, compact, fillMode }) {
  const accent = item.accent || 'cyan';
  const label = compact ? (item.shortLabel || item.label) : item.label;
  const backgroundColor = fillMode ? (active ? accent : 'blackBright') : undefined;
  const textColor = fillMode
    ? (active ? 'black' : 'white')
    : (active ? accent : 'white');

  return (
    <Box
      borderStyle="round"
      borderColor={active ? accent : 'gray'}
      backgroundColor={backgroundColor}
      paddingX={1}
      marginRight={1}
    >
      <Text color={textColor} dimColor={!active && !fillMode} bold={active}>{label}</Text>
      {item.meta ? <Text dimColor> {item.meta}</Text> : null}
    </Box>
  );
}

export function ModeRail({ items = [], activeKey, compact = false, fillMode = false }) {
  if (!items.length) return null;

  return (
    <Box flexDirection="row">
      {items.map((item) => (
        <RailPill key={item.key} item={item} active={item.key === activeKey} compact={compact} fillMode={fillMode} />
      ))}
    </Box>
  );
}

function NavControlHint({ direction, align = 'left', compact = false }) {
  const label = direction === 'left'
    ? '← shift+tab'
    : 'tab →';

  return (
    <Box justifyContent={align === 'right' ? 'flex-end' : 'flex-start'}>
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="cyan" bold>{label}</Text>
      </Box>
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
  footerText = '[q] quit',
  children,
}) {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState({
    cols: stdout?.columns || 80,
    rows: stdout?.rows || 24,
  });
  const terminalUi = getTerminalUiCapabilities();

  useEffect(() => {
    if (!stdout) return;

    const onResize = () => {
      setDimensions({
        cols: stdout.columns || 80,
        rows: stdout.rows || 24,
      });
    };

    stdout.on('resize', onResize);
    return () => stdout.off('resize', onResize);
  }, [stdout]);

  const cols = dimensions.cols;
  const rows = dimensions.rows;
  const fullHintWidth = getNavHintWidth(false) * 2 + 4;
  const compactHintWidth = getNavHintWidth(true) * 2 + 4;
  const fullMinCols = Math.max(68, getRailWidth(modeItems, false) + fullHintWidth + 8);
  const compactMinCols = Math.max(60, getRailWidth(modeItems, true) + compactHintWidth + 8);
  const compact = cols < fullMinCols;
  const minCols = compact ? compactMinCols : fullMinCols;

  if (cols < minCols || rows < MIN_ROWS) {
    return (
      <Box flexDirection="column" paddingX={2} paddingTop={1}>
        <Text color="yellow" bold>chinwag needs a larger terminal</Text>
        <Text dimColor>Current size: {cols} x {rows}</Text>
        <Text dimColor>Recommended minimum: {minCols} x {MIN_ROWS}</Text>
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
  const navHintWidth = getNavHintWidth(compact);

  return (
    <Box flexDirection="column" height={rows}>
      <Box flexDirection="column" paddingX={2} paddingTop={1} flexShrink={0}>
        <Box flexDirection="row" alignItems="center">
          <Box width={navHintWidth}>
            <NavControlHint direction="left" compact={compact} />
          </Box>
          <Box flexGrow={1} justifyContent="center">
            <ModeRail items={modeItems} activeKey={activeMode} compact={compact} fillMode={terminalUi.hasBackgroundFill} />
          </Box>
          <Box width={navHintWidth} justifyContent="flex-end">
            <NavControlHint direction="right" align="right" compact={compact} />
          </Box>
        </Box>
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
