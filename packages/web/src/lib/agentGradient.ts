// Per-agent hero gradient.
//
// Takes an agent's accent hex and returns a layered radial+linear gradient
// that sits behind the ASCII canvas as atmospheric lighting. Harmonics
// (analogous + split-complementary) are derived from the hue so each agent
// gets a distinct "mood" while staying tonally close to its accent color.
//
// Tuned to stay subtle: the ASCII remains the identity; this is lighting.

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return { h: 220, s: 40, l: 70 };

  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function agentGradient(hex: string): string {
  const { h } = hexToHsl(hex);
  const analog = (h + 28) % 360;
  const accent = (h + 160) % 360;

  return [
    // Primary bloom - anchored upper-left, carries the agent hue
    `radial-gradient(ellipse at 28% 22%, hsla(${h}, 72%, 68%, 0.42) 0%, transparent 55%)`,
    // Accent bloom - lower-right, split-complementary for depth
    `radial-gradient(ellipse at 78% 72%, hsla(${accent}, 60%, 72%, 0.22) 0%, transparent 50%)`,
    // Base wash - barely-there tint so the background doesn't read as flat white
    `linear-gradient(135deg, hsla(${h}, 35%, 94%, 0.18), hsla(${analog}, 35%, 96%, 0.10))`,
  ].join(', ');
}
