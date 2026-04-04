import React from 'react';
import { Box, Text } from 'ink';
import type { DashboardNotice } from './reducer.js';

type GlyphKind = 'running' | 'checking' | 'selected' | 'failed' | 'done' | string;

export function getAnimatedGlyph(kind: GlyphKind): string {
  if (kind === 'running') return '●';
  if (kind === 'checking') return '○';
  if (kind === 'selected') return '▸';
  if (kind === 'failed') return '✗';
  if (kind === 'done') return '✓';
  return '•';
}

interface CommandHintProps {
  commandKey: string;
  label: string;
  color?: string;
}

export function CommandHint({
  commandKey,
  label,
  color = 'cyan',
}: CommandHintProps): React.ReactNode {
  return (
    <Box marginRight={2}>
      <Text color={color} bold>
        [{commandKey}]
      </Text>
      <Text dimColor> {label}</Text>
    </Box>
  );
}

export interface HintItem {
  commandKey: string;
  label: string;
  color?: string;
}

interface HintRowProps {
  hints?: HintItem[];
}

export function HintRow({ hints = [] }: HintRowProps): React.ReactNode {
  if (!hints.length) return null;
  return (
    <Box flexWrap="wrap" marginTop={1}>
      {hints.map((hint) => (
        <CommandHint
          key={`${hint.commandKey}-${hint.label}`}
          commandKey={hint.commandKey}
          label={hint.label}
          color={hint.color}
        />
      ))}
    </Box>
  );
}

interface NoticeLineProps {
  notice: DashboardNotice | null;
}

export function NoticeLine({ notice }: NoticeLineProps): React.ReactNode {
  if (!notice?.text) return null;

  const color =
    {
      info: 'cyan',
      success: 'green',
      warning: 'yellow',
      error: 'red',
    }[notice.tone] || 'cyan';

  const label =
    {
      info: 'note',
      success: 'done',
      warning: 'warning',
      error: 'error',
    }[notice.tone] || 'note';

  return (
    <Box marginTop={1}>
      <Text>
        <Text color={color} bold>
          [{label}]
        </Text>
        <Text> {notice.text}</Text>
      </Text>
    </Box>
  );
}
