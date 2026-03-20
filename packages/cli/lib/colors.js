// Color utilities — maps chinwag color names to Ink/chalk color names

// All colors map to standard ANSI codes (basic 8 + bright 8), universally
// supported across iTerm2, Terminal.app, Windows Terminal, gnome-terminal.
// Bright variants (codes 90-97) render as distinct hues on modern terminals:
// redBright→orange, greenBright→lime, magentaBright→pink, etc.
const COLOR_MAP = {
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

const COLOR_LIST = Object.keys(COLOR_MAP);

export function getInkColor(colorName) {
  return COLOR_MAP[colorName] || 'white';
}

export function getColorList() {
  return COLOR_LIST;
}

