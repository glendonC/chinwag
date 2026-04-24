// Mini share ring — same visual DNA as the Tools tab ring. Slices are
// tool-brand-colored, total sessions centered, legend below carries count
// and completion %. Clicking any slice or legend row navigates to the
// Tools tab so users can drill into that tool's config/health.
export const RING_CX = 80;
export const RING_CY = 80;
export const RING_R = 56;
export const RING_SW = 10;
// Gap must exceed 2×(SW/2)/R in degrees so round linecaps don't overlap
// into neighboring slices. At SW=10, R=56 that floor is ~10.24°.
export const RING_GAP_DEG = 12;
// Top-N branded slices; the rest aggregate into a muted Other slice. Keeps
// every rendered arc above the cap-overlap floor regardless of tool count.
export const RING_TOP_N = 5;
export const OTHER_KEY = '__other';
