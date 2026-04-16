// Per-report mesh gradient.
//
// Mirrors the structure of lib/projectGradient.ts (two radial blooms + a
// linear base wash), but seeds the primary hue from the report's palette
// color and the blob positions from a hash of the report id. Result: every
// report gets a unique arrangement while staying tonally close to its
// assigned color — same "family" as the project squircle in the sidebar.

export function hexToHue(hex: string): number {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return 220;

  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;

  const d = max - min;
  let h = 0;
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
  return Math.round((h / 6) * 360);
}

function hashCode(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function reportMesh(hex: string, seedId: string): string {
  const h = hexToHue(hex);
  const analog = (h + 28) % 360;
  const accent = (h + 160) % 360;

  const hash = hashCode(seedId);
  const x1 = 15 + (hash % 30);
  const y1 = 12 + ((hash >> 4) % 28);
  const x2 = 55 + ((hash >> 8) % 30);
  const y2 = 50 + ((hash >> 12) % 30);

  return [
    `radial-gradient(ellipse at ${x1}% ${y1}%, hsla(${h}, 78%, 74%, 0.92) 0%, transparent 55%)`,
    `radial-gradient(ellipse at ${x2}% ${y2}%, hsla(${accent}, 62%, 72%, 0.55) 0%, transparent 50%)`,
    `linear-gradient(145deg, hsla(${h}, 38%, 92%, 1), hsla(${analog}, 42%, 88%, 1))`,
  ].join(', ');
}
