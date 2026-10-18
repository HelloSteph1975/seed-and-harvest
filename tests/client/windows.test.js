import { describe, it, expect } from 'vitest';
import { plantingWindows, zoneFit } from '../../client/src/lib/windows.js';

const north = { hemisphere: 'north', last_frost: '03-20', first_frost: '11-10', frost_free: 0, zone: '7b' };
const tomato = { start_indoors_min: 6, start_indoors_max: 8, transplant_min: 1, transplant_max: 2, frost_free_months: [] };
const lettuce = { sow_min: -4, sow_max: -2, fall_sow_min: 8, fall_sow_max: 10, frost_free_months: [] };

describe('plantingWindows', () => {
  it('works out indoor start and transplant dates from the last frost', () => {
    expect(plantingWindows(tomato, north, '2027-01-10')).toEqual({
      windows: [
        { kind: 'start_indoors', from: '2027-01-23', to: '2027-02-06' },
        { kind: 'transplant', from: '2027-03-27', to: '2027-04-03' },
      ],
      needs: [],
    });
  });

  it('a window already over moves to next year', () => {
    const { windows } = plantingWindows(tomato, north, '2027-05-01');
    expect(windows.map(w => w.from.slice(0, 4))).toEqual(['2028', '2028']);
    expect(windows[0]).toEqual({ kind: 'start_indoors', from: '2028-01-24', to: '2028-02-07' });
  });

  it('a window still running today stays this year', () => {
    const { windows } = plantingWindows(tomato, north, '2027-02-01');
    expect(windows[0]).toEqual({ kind: 'start_indoors', from: '2027-01-23', to: '2027-02-06' });
  });

  it('sows before the last frost and again before the first fall frost', () => {
    expect(plantingWindows(lettuce, north, '2027-01-10').windows).toEqual([
      { kind: 'sow', from: '2027-02-20', to: '2027-03-06' },
      { kind: 'fall_sow', from: '2027-09-01', to: '2027-09-15' },
    ]);
  });

  it('says which frost date it still needs', () => {
    const r = plantingWindows(lettuce, { ...north, first_frost: null }, '2027-01-10');
    expect(r.windows.map(w => w.kind)).toEqual(['sow']);
    expect(r.needs).toEqual(['first_frost']);
    expect(plantingWindows(tomato, { hemisphere: 'north', frost_free: 0 }, '2027-01-10')).toEqual({ windows: [], needs: ['last_frost'] });
  });

  it('a frost-free place uses planting months, joined across the new year', () => {
    const warm = { hemisphere: 'north', frost_free: 1 };
    expect(plantingWindows({ frost_free_months: [11, 12, 1, 2] }, warm, '2027-01-10')).toEqual({
      windows: [{ kind: 'frost_free', from: '2026-11-01', to: '2027-02-28' }], needs: [],
    });
    expect(plantingWindows({ frost_free_months: [11, 12, 1, 2] }, warm, '2027-06-01').windows).toEqual([
      { kind: 'frost_free', from: '2027-11-01', to: '2028-02-29' },
    ]);
    expect(plantingWindows({ frost_free_months: [3, 4, 9] }, warm, '2027-01-10').windows).toEqual([
      { kind: 'frost_free', from: '2027-03-01', to: '2027-04-30' },
      { kind: 'frost_free', from: '2027-09-01', to: '2027-09-30' },
    ]);
  });

  it('a frost-free place and a plant with no months gives nothing and needs nothing', () => {
    expect(plantingWindows(tomato, { frost_free: 1 }, '2027-01-10')).toEqual({ windows: [], needs: [] });
  });

  it('no place means it needs a place', () => {
    expect(plantingWindows(tomato, null, '2027-01-10')).toEqual({ windows: [], needs: ['place'] });
  });

  it('a plant with no timing gives nothing', () => {
    expect(plantingWindows({ frost_free_months: [] }, north, '2027-01-10')).toEqual({ windows: [], needs: [] });
  });
});

describe('zoneFit', () => {
  const fig = { perennial: 1, zone_min: 6, zone_max: 9 };
  it('compares a perennial with the place zone', () => {
    expect(zoneFit(fig, { zone: '7b' })).toBe('fits');
    expect(zoneFit(fig, { zone: '5a' })).toBe('too_cold');
    expect(zoneFit(fig, { zone: '10b' })).toBe('too_warm');
  });
  it('is unknown for annuals, plants without zones, or places without one', () => {
    expect(zoneFit({ perennial: 0, zone_min: 6, zone_max: 9 }, { zone: '7b' })).toBe('unknown');
    expect(zoneFit({ perennial: 1 }, { zone: '7b' })).toBe('unknown');
    expect(zoneFit(fig, { zone: null })).toBe('unknown');
    expect(zoneFit(fig, null)).toBe('unknown');
  });
});
