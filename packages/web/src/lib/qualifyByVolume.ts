/**
 * Slice-by-volume helper. Returns the subset of `rows` whose count value is
 * at or above the given percentile threshold (default 25). Used to suppress
 * tail-noise rows in widgets that mix a volume axis with a quality color
 * — e.g. hourly-effectiveness (sessions × completion rate) where the 2am
 * cell with one stuck session would otherwise blot the entire palette red.
 *
 * The percentile is computed across the count distribution of `rows` itself,
 * so the threshold scales with the dataset rather than living as a magic
 * number. Empty/all-zero inputs return [] (not an error — the caller
 * surfaces an empty state).
 *
 * - `percentile = 0` returns every row with count > 0.
 * - `percentile = 100` returns only rows tied at the maximum count.
 * - In-between values use the standard "nearest-rank" rule on the sorted
 *   non-zero counts.
 *
 * @param rows         Source rows.
 * @param getCount     Extractor for the volume field (e.g. `r => r.sessions`).
 * @param percentile   0-100, default 25.
 */
export function qualifyByVolume<T>(
  rows: ReadonlyArray<T>,
  getCount: (row: T) => number,
  percentile: number = 25,
): T[] {
  if (rows.length === 0) return [];
  const p = Math.max(0, Math.min(100, percentile));

  const counts: number[] = [];
  for (const r of rows) {
    const c = getCount(r);
    if (c > 0) counts.push(c);
  }
  if (counts.length === 0) return [];

  counts.sort((a, b) => a - b);

  let threshold: number;
  if (p === 0) {
    threshold = counts[0];
  } else if (p >= 100) {
    threshold = counts[counts.length - 1];
  } else {
    const rank = Math.ceil((p / 100) * counts.length);
    const idx = Math.max(0, Math.min(counts.length - 1, rank - 1));
    threshold = counts[idx];
  }

  return rows.filter((r) => getCount(r) >= threshold);
}
