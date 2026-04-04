/**
 * Handle editing sub-screen for the Customize component.
 */
import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface FlashMessage {
  type: string;
  text: string;
}

interface HandleScreenProps {
  handleInput: string;
  setHandleInput: (value: string) => void;
  submitHandle: () => void;
  message: FlashMessage | null;
}

export function HandleScreen({
  handleInput,
  setHandleInput,
  submitHandle,
  message,
}: HandleScreenProps): React.ReactNode {
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
      {message && <Text color={message.type === 'error' ? 'red' : 'green'}>{message.text}</Text>}
      <Text dimColor>[enter] save [esc] back</Text>
    </Box>
  );
}
