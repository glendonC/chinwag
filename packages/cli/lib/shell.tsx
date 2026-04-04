import React, { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Text, useStdout } from 'ink';
import { getInkColor } from './colors.js';
import { getTerminalUiCapabilities } from './terminal-control.js';

const MIN_ROWS = 18;

export interface ModeItem {
  key: string;
  label: string;
  shortLabel?: string;
  accent?: string;
  meta?: string;
}

interface FooterHint {
  key: string;
  label: string;
  color?: string;
}

interface ShellUser {
  handle?: string;
  color?: string;
}

export interface ShellDimensions {
  cols: number;
  rows: number;
  viewportRows: number;
  compact: boolean;
  narrow: boolean;
}

function getRailWidth(items: ModeItem[] | undefined, compact: boolean): number {
  if (!items?.length) return 0;

  return items.reduce((total, item) => {
    const label = compact ? item.shortLabel || item.label : item.label;
    const meta = item.meta ? ` ${item.meta}` : '';
    // Approximate pill width: borders + internal padding + label + gap.
    return total + label.length + meta.length + 6;
  }, 0);
}

function getActiveModeItem(items: ModeItem[], activeKey: string): ModeItem | null {
  return items.find((item) => item.key === activeKey) || items[0] || null;
}

function getNavHintWidth(compact: boolean): number {
  const labels = compact ? ['← shift+tab', 'tab →'] : ['← shift+tab', 'tab →'];
  return Math.max(...labels.map((label) => label.length)) + 5;
}

interface RailPillProps {
  item: ModeItem;
  active: boolean;
  compact: boolean;
  fillMode: boolean;
}

function RailPill({ item, active, compact, fillMode }: RailPillProps): React.ReactNode {
  const accent = item.accent || 'cyan';
  const label = compact ? item.shortLabel || item.label : item.label;
  const textColor = fillMode ? (active ? 'black' : 'white') : active ? accent : 'white';

  return (
    <Box borderStyle="round" borderColor={active ? accent : 'gray'} paddingX={1} marginRight={1}>
      <Text color={textColor} dimColor={!active && !fillMode} bold={active}>
        {label}
      </Text>
      {item.meta ? <Text dimColor> {item.meta}</Text> : null}
    </Box>
  );
}

interface ModeRailProps {
  items?: ModeItem[];
  activeKey: string;
  compact?: boolean;
  fillMode?: boolean;
}

export function ModeRail({
  items = [],
  activeKey,
  compact = false,
  fillMode = false,
}: ModeRailProps): React.ReactNode {
  if (!items.length) return null;

  return (
    <Box flexDirection="row">
      {items.map((item) => (
        <RailPill
          key={item.key}
          item={item}
          active={item.key === activeKey}
          compact={compact}
          fillMode={fillMode}
        />
      ))}
    </Box>
  );
}

interface NavControlHintProps {
  direction: 'left' | 'right';
  align?: 'left' | 'right';
  compact?: boolean;
}

function NavControlHint({ direction, align = 'left' }: NavControlHintProps): React.ReactNode {
  const label = direction === 'left' ? '← shift+tab' : 'tab →';

  return (
    <Box justifyContent={align === 'right' ? 'flex-end' : 'flex-start'}>
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="cyan" bold>
          {label}
        </Text>
      </Box>
    </Box>
  );
}

interface OperatorBadgeProps {
  user: ShellUser | null;
}

function OperatorBadge({ user }: OperatorBadgeProps): React.ReactNode {
  if (!user?.handle) {
    return <Text dimColor>local operator</Text>;
  }

  return (
    <Text>
      <Text dimColor>@</Text>
      <Text color={getInkColor(user.color || 'white')} bold>
        {user.handle}
      </Text>
    </Text>
  );
}

interface ControlShellProps {
  modeItems?: ModeItem[];
  activeMode: string;
  user: ShellUser | null;
  footerHints?: FooterHint[] | null;
  children: ReactNode | ((dims: ShellDimensions) => ReactNode);
}

export function ControlShell({
  modeItems = [],
  activeMode,
  user,
  footerHints = null,
  children,
}: ControlShellProps): React.ReactNode {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState({
    cols: stdout?.columns || 80,
    rows: stdout?.rows || 24,
  });
  const terminalUi = getTerminalUiCapabilities();

  useEffect(() => {
    if (!stdout) return;

    const onResize = (): void => {
      setDimensions({
        cols: stdout.columns || 80,
        rows: stdout.rows || 24,
      });
    };

    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  const cols = dimensions.cols;
  const rows = dimensions.rows;
  const activeModeItem = getActiveModeItem(modeItems, activeMode);
  const fullHintWidth = getNavHintWidth(false) * 2 + 4;
  const compactHintWidth = getNavHintWidth(true) * 2 + 4;
  const fullMinCols = Math.max(68, getRailWidth(modeItems, false) + fullHintWidth + 8);
  const compactMinCols = Math.max(60, getRailWidth(modeItems, true) + compactHintWidth + 8);
  const narrowMinCols = Math.max(
    48,
    getRailWidth(activeModeItem ? [activeModeItem] : [], true) + compactHintWidth + 8,
  );

  let layoutMode: 'full' | 'compact' | 'narrow' = 'full';
  if (cols < compactMinCols) layoutMode = 'narrow';
  else if (cols < fullMinCols) layoutMode = 'compact';

  const compact = layoutMode !== 'full';
  const narrow = layoutMode === 'narrow';
  const minCols = narrow ? narrowMinCols : compact ? compactMinCols : fullMinCols;

  if (cols < minCols || rows < MIN_ROWS) {
    return (
      <Box flexDirection="column" paddingX={2} paddingTop={1}>
        <Text color="yellow" bold>
          chinwag needs a larger terminal
        </Text>
        <Text dimColor>
          Current size: {cols} x {rows}
        </Text>
        <Text dimColor>
          Recommended minimum: {minCols} x {MIN_ROWS}
        </Text>
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
            <ModeRail
              items={narrow && activeModeItem ? [activeModeItem] : modeItems}
              activeKey={activeMode}
              compact={compact}
              fillMode={terminalUi.hasBackgroundFill}
            />
          </Box>
          <Box width={navHintWidth} justifyContent="flex-end">
            <NavControlHint direction="right" align="right" compact={compact} />
          </Box>
        </Box>
        <Text dimColor>{divider}</Text>
      </Box>

      <Box flexDirection="column" paddingX={2} height={viewportRows} flexGrow={1}>
        {typeof children === 'function'
          ? children({ cols, rows, viewportRows, compact, narrow })
          : children}
      </Box>

      <Box flexDirection="column" paddingX={2} paddingBottom={1} flexShrink={0}>
        <Text dimColor>{divider}</Text>
        <Box justifyContent="space-between">
          <Text>
            {footerHints ? (
              footerHints.map((h, i) => (
                <Text key={h.key}>
                  {i > 0 ? '  ' : ''}
                  <Text color={h.color || 'cyan'} bold>
                    [{h.key}]
                  </Text>
                  <Text dimColor> {h.label}</Text>
                </Text>
              ))
            ) : (
              <Text dimColor>[q] quit</Text>
            )}
          </Text>
          <OperatorBadge user={user} />
        </Box>
      </Box>
    </Box>
  );
}
