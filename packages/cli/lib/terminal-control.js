import { useEffect } from 'react';

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const EXIT_ALT_SCREEN = '\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';

function canControlTerminal() {
  return Boolean(process.stdout?.isTTY);
}

function supportsAlternateScreen() {
  if (!canControlTerminal()) return false;
  const term = String(process.env.TERM || '').toLowerCase();
  if (!term || term === 'dumb' || term === 'unknown') return false;
  return true;
}

function writeEscape(sequence) {
  if (!canControlTerminal()) return;
  process.stdout.write(sequence);
}

function sanitizeTitle(title) {
  return String(title || 'chinwag')
    .replace(/\x1b/g, '')
    .replace(/\x07/g, '')
    .trim();
}

export function setTerminalTitle(title) {
  if (!supportsAlternateScreen()) return;
  writeEscape(`\x1b]0;${sanitizeTitle(title)}\x07`);
}

export function useTerminalControl(title) {
  useEffect(() => {
    if (!supportsAlternateScreen()) return undefined;

    writeEscape(ENTER_ALT_SCREEN);
    writeEscape(CLEAR_SCREEN);

    return () => {
      writeEscape(EXIT_ALT_SCREEN);
    };
  }, []);

  useEffect(() => {
    setTerminalTitle(title);
  }, [title]);
}
