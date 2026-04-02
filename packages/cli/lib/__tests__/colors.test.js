import { describe, expect, it } from 'vitest';
import { getInkColor, getColorList } from '../colors.js';

describe('getInkColor', () => {
  it('maps chinwag color names to Ink/chalk names', () => {
    expect(getInkColor('red')).toBe('red');
    expect(getInkColor('cyan')).toBe('cyan');
    expect(getInkColor('yellow')).toBe('yellow');
    expect(getInkColor('green')).toBe('green');
    expect(getInkColor('magenta')).toBe('magenta');
    expect(getInkColor('blue')).toBe('blue');
    expect(getInkColor('white')).toBe('white');
  });

  it('maps bright variants correctly', () => {
    expect(getInkColor('orange')).toBe('redBright');
    expect(getInkColor('lime')).toBe('greenBright');
    expect(getInkColor('pink')).toBe('magentaBright');
    expect(getInkColor('sky')).toBe('cyanBright');
    expect(getInkColor('lavender')).toBe('blueBright');
  });

  it('defaults to white for unknown colors', () => {
    expect(getInkColor('rainbow')).toBe('white');
    expect(getInkColor('')).toBe('white');
    expect(getInkColor(null)).toBe('white');
    expect(getInkColor(undefined)).toBe('white');
  });
});

describe('getColorList', () => {
  it('returns the 12 chinwag palette colors', () => {
    const colors = getColorList();
    expect(colors).toHaveLength(12);
    expect(colors).toContain('red');
    expect(colors).toContain('cyan');
    expect(colors).toContain('yellow');
    expect(colors).toContain('green');
    expect(colors).toContain('magenta');
    expect(colors).toContain('blue');
    expect(colors).toContain('orange');
    expect(colors).toContain('lime');
    expect(colors).toContain('pink');
    expect(colors).toContain('sky');
    expect(colors).toContain('lavender');
    expect(colors).toContain('white');
  });

  it('returns a stable array across calls', () => {
    expect(getColorList()).toEqual(getColorList());
  });
});
