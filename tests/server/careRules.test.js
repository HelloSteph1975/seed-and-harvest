import { describe, it, expect } from 'vitest';
import { careEvents } from '../../server/services/careRules.js';

const HOME = { frost_free: 0, last_frost: '04-01', first_frost: '10-30', zone: '7b', hemisphere: 'north', wet_months: [] };
const SOUTH = { frost_free: 0, last_frost: '09-15', first_frost: '05-01', zone: '8a', hemisphere: 'south', wet_months: [] };
const VALLEY = { frost_free: 1, last_frost: null, first_frost: null, zone: '10b', hemisphere: 'north', wet_months: [6, 7, 8, 9, 10] };
const FIG = { kind: 'fruit_tree', perennial: 1, zone_min: 7, zone_max: 11 };
const LEMON = { kind: 'fruit_tree', perennial: 1, zone_min: 9, zone_max: 11 };
const APPLE = { kind: 'fruit_tree', perennial: 1, zone_min: 4, zone_max: 8 };
const YEAR = ['2027-01-01', '2027-12-31'];
const plan = list => list.map(e => [e.kind, e.due_on, e.season_key]);

describe('care rules', () => {
  it('a fig in the ground at a frost place gets prune, feed and mulch on the right days', () => {
    expect(plan(careEvents(FIG, HOME, false, ...YEAR))).toEqual([
      ['prune', '2027-03-04', 'prune:2027'], ['feed', '2027-04-15', 'feed:2027:1'], ['mulch', '2027-04-29', 'mulch:2027'],
    ]);
  });

  it('a lemon in a pot gets two feeds, a pot check and a move to shelter before the first frost', () => {
    expect(plan(careEvents(LEMON, HOME, true, ...YEAR))).toEqual([
      ['check_pot', '2027-02-18', 'check_pot:2027'], ['prune', '2027-03-04', 'prune:2027'], ['feed', '2027-04-15', 'feed:2027:1'],
      ['feed', '2027-06-10', 'feed:2027:2'], ['protect', '2027-10-23', 'protect:2027'],
    ]);
  });

  it('a hardy apple in the ground gets no winter protection, a tender one in the ground does', () => {
    expect(careEvents(APPLE, HOME, false, ...YEAR).map(e => e.kind)).not.toContain('protect');
    expect(careEvents(LEMON, HOME, false, ...YEAR).map(e => e.kind)).toContain('protect');
  });

  it('a southern place gets its winter care in its own winter', () => {
    const list = plan(careEvents(LEMON, SOUTH, true, ...YEAR));
    expect(list).toContainEqual(['protect', '2027-04-24', 'protect:2027']);
    expect(list).toContainEqual(['prune', '2027-08-18', 'prune:2027']);
  });

  it('a frost-free place uses its coolest and wet months and never protects', () => {
    expect(plan(careEvents(FIG, VALLEY, true, ...YEAR))).toEqual([
      ['check_pot', '2027-01-01', 'check_pot:2027'], ['prune', '2027-01-15', 'prune:2027'], ['feed', '2027-06-01', 'feed:2027:1'],
      ['mulch', '2027-11-01', 'mulch:2027'],
    ]);
    const south = plan(careEvents(FIG, { ...VALLEY, hemisphere: 'south', wet_months: [] }, false, ...YEAR));
    expect(south).toEqual([['prune', '2027-07-15', 'prune:2027'], ['feed', '2027-09-01', 'feed:2027:1'], ['mulch', '2027-09-29', 'mulch:2027']]);
  });

  it('a place with no frost dates gets no frost-based care', () => {
    expect(careEvents(FIG, { ...HOME, last_frost: null, first_frost: null }, true, ...YEAR)).toEqual([]);
  });

  it('annuals get none, and the range is respected across years', () => {
    expect(careEvents({ kind: 'vegetable', perennial: 0 }, HOME, false, ...YEAR)).toEqual([]);
    expect(plan(careEvents(FIG, HOME, false, '2027-04-10', '2028-03-10'))).toEqual([
      ['feed', '2027-04-15', 'feed:2027:1'], ['mulch', '2027-04-29', 'mulch:2027'], ['prune', '2028-03-04', 'prune:2028'],
    ]);
  });
});
