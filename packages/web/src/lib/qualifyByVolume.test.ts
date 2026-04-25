import { describe, expect, it } from 'vitest';
import { qualifyByVolume } from './qualifyByVolume.js';

interface Row {
  id: string;
  count: number;
}

const get = (r: Row) => r.count;

describe('qualifyByVolume', () => {
  it('returns [] for empty input', () => {
    expect(qualifyByVolume<Row>([], get)).toEqual([]);
  });

  it('returns the row when given a single positive-count row', () => {
    const rows: Row[] = [{ id: 'a', count: 5 }];
    expect(qualifyByVolume(rows, get)).toEqual(rows);
  });

  it('returns [] when every row has count 0', () => {
    const rows: Row[] = [
      { id: 'a', count: 0 },
      { id: 'b', count: 0 },
    ];
    expect(qualifyByVolume(rows, get)).toEqual([]);
  });

  it('drops below-p25 rows on a normal distribution', () => {
    const rows: Row[] = [
      { id: 'a', count: 1 },
      { id: 'b', count: 2 },
      { id: 'c', count: 3 },
      { id: 'd', count: 4 },
      { id: 'e', count: 5 },
      { id: 'f', count: 6 },
      { id: 'g', count: 7 },
      { id: 'h', count: 8 },
    ];
    const kept = qualifyByVolume(rows, get, 25);
    expect(kept.map((r) => r.id)).toEqual(['b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('p=0 returns every positive-count row', () => {
    const rows: Row[] = [
      { id: 'a', count: 1 },
      { id: 'b', count: 50 },
      { id: 'c', count: 0 },
    ];
    const kept = qualifyByVolume(rows, get, 0);
    expect(kept.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('p=100 returns only the max-count rows', () => {
    const rows: Row[] = [
      { id: 'a', count: 1 },
      { id: 'b', count: 9 },
      { id: 'c', count: 9 },
      { id: 'd', count: 4 },
    ];
    const kept = qualifyByVolume(rows, get, 100);
    expect(kept.map((r) => r.id).sort()).toEqual(['b', 'c']);
  });

  it('preserves original row order', () => {
    const rows: Row[] = [
      { id: 'big', count: 100 },
      { id: 'small', count: 1 },
      { id: 'mid', count: 50 },
    ];
    const kept = qualifyByVolume(rows, get, 25);
    expect(kept.map((r) => r.id)).toEqual(['big', 'small', 'mid']);
  });

  it('treats zero-count rows as below threshold even at p=0', () => {
    const rows: Row[] = [
      { id: 'a', count: 0 },
      { id: 'b', count: 1 },
    ];
    expect(qualifyByVolume(rows, get, 0).map((r) => r.id)).toEqual(['b']);
  });

  it('clamps out-of-range percentiles', () => {
    const rows: Row[] = [
      { id: 'a', count: 1 },
      { id: 'b', count: 2 },
    ];
    expect(qualifyByVolume(rows, get, -10)).toEqual(rows);
    expect(qualifyByVolume(rows, get, 200).map((r) => r.id)).toEqual(['b']);
  });
});
