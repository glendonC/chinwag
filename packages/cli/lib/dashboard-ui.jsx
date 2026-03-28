import React from 'react';
import { Box, Text } from 'ink';

export function getAnimatedGlyph(kind, frame = 0) {
  if (kind === 'running') return '●';
  if (kind === 'checking') return '○';
  if (kind === 'selected') return '▸';
  if (kind === 'failed') return '✗';
  if (kind === 'done') return '✓';
  return '•';
}

export function StatusBadge({ label, color }) {
  return <Text color={color} bold>[{label}]</Text>;
}

export function SectionHeading({ title, subtitle = null, color = 'cyan' }) {
  return (
    <Text>
      <Text color={color} bold>{title}</Text>
      {subtitle ? <Text dimColor>  {subtitle}</Text> : null}
    </Text>
  );
}

export function CommandHint({ commandKey, label, color = 'cyan' }) {
  return (
    <Box marginRight={2}>
      <Text color={color} bold>[{commandKey}]</Text>
      <Text dimColor> {label}</Text>
    </Box>
  );
}

export function HintRow({ hints = [] }) {
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

export function NoticeLine({ notice }) {
  if (!notice?.text) return null;

  const color = {
    info: 'cyan',
    success: 'green',
    warning: 'yellow',
    error: 'red',
  }[notice.tone] || 'cyan';

  const label = {
    info: 'note',
    success: 'done',
    warning: 'warning',
    error: 'error',
  }[notice.tone] || 'note';

  return (
    <Box marginTop={1}>
      <Text>
        <Text color={color} bold>[{label}]</Text>
        <Text> {notice.text}</Text>
      </Text>
    </Box>
  );
}
