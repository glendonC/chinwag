import { useEffect } from 'react';

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const EXIT_ALT_SCREEN = '\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';

function canControlTerminal() {
  return Boolean(process.stdout?.isTTY);
}

export function getTerminalUiCapabilities() {
  const term = String(process.env.TERM || '').toLowerCase();
  const noColor = process.env.NO_COLOR != null && process.env.NO_COLOR !== '0';
  const forceColor = process.env.FORCE_COLOR != null && process.env.FORCE_COLOR !== '0';

  let colorDepth = 1;
  try {
    colorDepth = process.stdout?.getColorDepth?.() || 1;
  } catch {}

  const hasNamedTerminal = Boolean(term && term !== 'dumb' && term !== 'unknown');
  const hasBasicColor = forceColor || (!noColor && hasNamedTerminal && colorDepth >= 4);
  const hasBackgroundFill = forceColor || (!noColor && hasNamedTerminal && colorDepth >= 8);

  return {
    hasBasicColor,
    hasBackgroundFill,
    isLowFidelity: !hasBasicColor,
  };
}

function supportsAlternateScreen() {
  if (!canControlTerminal()) return false;
  return !getTerminalUiCapabilities().isLowFidelity;
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
