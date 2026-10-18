import { describe, it, expect } from 'vitest';
import { nextFrostEvent, todayIn } from '../../client/src/lib/frost.js';

const north = { hemisphere: 'north', last_frost: '03-20', first_frost: '11-10', frost_free: 0 };
const south = { hemisphere: 'south', last_frost: '09-15', first_frost: '05-05', frost_free: 0 };

describe('nextFrostEvent', () => {
  it('counts to the last spring frost in late winter', () => {
    expect(nextFrostEvent(north, '2027-02-25')).toEqual({ kind: 'last', date: '2027-03-20', days: 23 });
  });
  it('counts the day itself as 0 days', () => {
    expect(nextFrostEvent(north, '2027-03-20')).toEqual({ kind: 'last', date: '2027-03-20', days: 0 });
  });
  it('counts to the first fall frost in summer', () => {
    expect(nextFrostEvent(north, '2027-11-01')).toEqual({ kind: 'first', date: '2027-11-10', days: 9 });
  });
  it('rolls over to next spring after the first fall frost', () => {
    expect(nextFrostEvent(north, '2027-12-01')).toMatchObject({ kind: 'last', date: '2028-03-20' });
  });
  it('works in the south', () => {
    expect(nextFrostEvent(south, '2027-06-01')).toMatchObject({ kind: 'last', date: '2027-09-15' });
    expect(nextFrostEvent(south, '2027-01-10')).toMatchObject({ kind: 'first', date: '2027-05-05' });
  });
  it('works with only one date', () => {
    expect(nextFrostEvent({ last_frost: '03-20', frost_free: 0 }, '2027-04-01')).toMatchObject({ kind: 'last', date: '2028-03-20' });
  });
  it('is null for frost-free places and places with no dates', () => {
    expect(nextFrostEvent({ ...north, frost_free: 1 }, '2027-02-25')).toBeNull();
    expect(nextFrostEvent({ frost_free: 0 }, '2027-02-25')).toBeNull();
  });
  it('handles Feb 29 in a year without one', () => {
    expect(nextFrostEvent({ last_frost: '02-29', frost_free: 0 }, '2027-02-01')).toMatchObject({ date: '2027-02-28' });
  });
});

describe('todayIn', () => {
  it('gives the date in that time zone', () => {
    expect(todayIn('America/Mexico_City', new Date('2027-01-01T03:00:00Z'))).toBe('2026-12-31');
    expect(todayIn('UTC', new Date('2027-01-01T03:00:00Z'))).toBe('2027-01-01');
  });
  it('falls back to UTC for a zone it does not know', () => {
    expect(todayIn('Mars/Base', new Date('2027-01-01T03:00:00Z'))).toBe('2027-01-01');
  });
});
