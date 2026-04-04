/**
 * Color selection sub-screen for the Customize component.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { getInkColor } from '../colors.js';

interface ColorScreenProps {
  handle: string;
  currentColor: string;
  colors: string[];
  colorIdx: number;
}

export function ColorScreen({
  handle,
  currentColor,
  colors,
  colorIdx,
}: ColorScreenProps): React.ReactNode {
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
