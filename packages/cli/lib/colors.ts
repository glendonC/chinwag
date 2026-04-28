// Color utilities - maps chinmeister color names to Ink/chalk color names

// All colors map to standard ANSI codes (basic 8 + bright 8), universally
// supported across iTerm2, Terminal.app, Windows Terminal, gnome-terminal.
// Bright variants (codes 90-97) render as distinct hues on modern terminals:
// redBright→orange, greenBright→lime, magentaBright→pink, etc.
const COLOR_MAP: Record<string, string> = {
  red: 'red',
  cyan: 'cyan',
  yellow: 'yellow',
  green: 'green',
  magenta: 'magenta',
  blue: 'blue',
  orange: 'redBright',
  lime: 'greenBright',
  pink: 'magentaBright',
  sky: 'cyanBright',
  lavender: 'blueBright',
  white: 'white',
};

const COLOR_LIST: string[] = Object.keys(COLOR_MAP);

export function getInkColor(colorName: string): string {
  return COLOR_MAP[colorName] || 'white';
}

// Chalk uses the same ANSI color names as Ink.
// Alias for callers that need chalk-compatible color names.
export const getChalkColor: (colorName: string) => string = getInkColor;

export function getColorList(): string[] {
  return COLOR_LIST;
}
