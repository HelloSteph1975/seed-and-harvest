import { describe, it, expect } from 'vitest';
import { suggestStart, startFrom } from '../../client/src/lib/tasks.js';

const HOME = { id: 1, frost_free: 0, last_frost: '03-20', first_frost: '11-10' };
const VALLEY = { id: 2, frost_free: 1 };
const TOMATO = { kind: 'vegetable', start_indoors_min: 6, start_indoors_max: 8, transplant_min: 1, transplant_max: 2, frost_free_months: [2, 3] };
const GARLIC = { kind: 'vegetable', fall_sow_min: -2, fall_sow_max: 2 };

describe('suggesting a start date', () => {
  it('a frost-free place suggests starting seeds indoors ahead of its planting months', () => {
    const s = suggestStart(TOMATO, VALLEY, 'seed_indoors', '2027-01-10');
    expect(s.window).toMatchObject({ kind: 'start_indoors', from: '2026-12-14', to: '2027-02-10' });
  });

  it('garlic offers its fall planting window', () => {
    const s = suggestStart(GARLIC, HOME, 'seed_outdoors', '2027-08-01');
    expect(s.window).toMatchObject({ kind: 'fall_sow', from: '2027-10-27', to: '2027-11-24' });
  });

  it('the suggested start date is never before today', () => {
    expect(startFrom({ from: '2027-01-23', to: '2027-02-06' }, '2027-01-30')).toBe('2027-01-30');
    expect(startFrom({ from: '2027-01-23', to: '2027-02-06' }, '2027-01-10')).toBe('2027-01-23');
  });
});
