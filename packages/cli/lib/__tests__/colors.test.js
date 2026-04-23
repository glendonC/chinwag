import { describe, it, expect } from 'vitest';
import { getInkColor, getColorList } from '../colors.js';

describe('getInkColor', () => {
  it('maps known chinmeister colors to Ink colors', () => {
    expect(getInkColor('red')).toBe('red');
    expect(getInkColor('cyan')).toBe('cyan');
    expect(getInkColor('yellow')).toBe('yellow');
    expect(getInkColor('green')).toBe('green');
    expect(getInkColor('magenta')).toBe('magenta');
    expect(getInkColor('blue')).toBe('blue');
    expect(getInkColor('white')).toBe('white');
  });

  it('maps bright color aliases correctly', () => {
    expect(getInkColor('orange')).toBe('redBright');
    expect(getInkColor('lime')).toBe('greenBright');
    expect(getInkColor('pink')).toBe('magentaBright');
    expect(getInkColor('sky')).toBe('cyanBright');
    expect(getInkColor('lavender')).toBe('blueBright');
  });

  it('falls back to white for unknown colors', () => {
    expect(getInkColor('purple')).toBe('white');
    expect(getInkColor('')).toBe('white');
    expect(getInkColor(undefined)).toBe('white');
  });
});

describe('getColorList', () => {
  it('returns the 12-color palette', () => {
    const colors = getColorList();
    expect(colors).toHaveLength(12);
    expect(colors).toContain('red');
    expect(colors).toContain('cyan');
    expect(colors).toContain('orange');
    expect(colors).toContain('lavender');
  });

  it('returns a stable reference', () => {
    expect(getColorList()).toBe(getColorList());
  });
});
