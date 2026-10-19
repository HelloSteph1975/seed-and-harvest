import { describe, it, expect } from 'vitest';
import { toDisplay, toMetric, unitLabel, keepOrConvert, UnitError } from '../../client/src/lib/units.js';

describe('units', () => {
  it('shows metres as feet in US units', () => {
    expect(toDisplay('length', 3.048, 'us')).toBe('10');
    expect(toDisplay('length', 1.2192, 'us')).toBe('4');
    expect(toDisplay('length', 1, 'us')).toBe('3.3');
    expect(toDisplay('length', 3.048, 'metric')).toBe('3');
    expect(toDisplay('length', 1.25, 'metric')).toBe('1.3');
  });
  it('shows litres as gallons in US units', () => {
    expect(toDisplay('volume', 18.927, 'us')).toBe('5');
    expect(toDisplay('volume', 20, 'metric')).toBe('20');
  });
  it('shows temperatures', () => {
    expect(toDisplay('temp', -2, 'us')).toBe('28.4');
    expect(toDisplay('temp', -2, 'metric')).toBe('-2');
  });
  it('shows nothing for no value', () => {
    expect(toDisplay('length', null, 'us')).toBe('');
  });
  it('turns typed text back into metric', () => {
    expect(toMetric('length', '10', 'us')).toBeCloseTo(3.048, 9);
    expect(toMetric('volume', '5', 'us')).toBeCloseTo(18.92705892, 6);
    expect(toMetric('length', ' 2,5 ', 'metric')).toBe(2.5);
    expect(toMetric('length', '', 'us')).toBeNull();
    expect(() => toMetric('length', 'abc', 'us')).toThrow(UnitError);
    expect(() => toMetric('length', '-1', 'us')).toThrow(UnitError);
  });
  it('labels units', () => {
    expect(unitLabel('length', 'us')).toBe('ft');
    expect(unitLabel('length', 'metric')).toBe('m');
    expect(unitLabel('volume', 'us')).toBe('gal');
    expect(unitLabel('volume', 'metric')).toBe('L');
    expect(unitLabel('temp', 'us')).toBe('°F');
    expect(unitLabel('temp', 'metric')).toBe('°C');
  });
  it('keeps the stored value when the text was not touched', () => {
    expect(keepOrConvert('length', '10', '10', 3.048, 'us')).toBe(3.048);
    expect(keepOrConvert('length', '3.3', '3.3', 1, 'us')).toBe(1);
    expect(keepOrConvert('length', '12', '10', 3.048, 'us')).toBeCloseTo(3.6576, 9);
  });
  it('feet convert exactly', () => {
    expect(toMetric('length', '10', 'us')).toBe(3.048);
    expect(toDisplay('length', 3.048, 'us')).toBe('10');
  });
  it('shows spacing in inches, whole above 3 in', () => {
    expect(toDisplay('spacing', 45.72, 'us')).toBe('18');
    expect(toDisplay('spacing', 5, 'us')).toBe('2');
    expect(toDisplay('spacing', 2.54, 'us')).toBe('1');
    expect(toDisplay('spacing', 1.27, 'us')).toBe('0.5');
    expect(toDisplay('spacing', 46, 'metric')).toBe('46');
    expect(toMetric('spacing', '18', 'us')).toBeCloseTo(45.72, 9);
    expect(unitLabel('spacing', 'us')).toBe('in');
    expect(unitLabel('spacing', 'metric')).toBe('cm');
  });
  it('shows weights in pounds and seed in ounces', () => {
    expect(toDisplay('weight', 4.5359237, 'us')).toBe('10');
    expect(toDisplay('weight', 4.5, 'metric')).toBe('4.5');
    expect(toDisplay('seed', 3, 'us')).toBe('0.1');
    expect(toDisplay('seed', 1, 'us')).toBe('0.1');
    expect(toDisplay('seed', 200, 'us')).toBe('7.1');
    expect(toDisplay('weight', 0.01, 'us')).toBe('0.02');
    expect(toDisplay('weight', 0.01, 'metric')).toBe('0.01');
    expect(toDisplay('weight', 0.001, 'metric')).toBe('0.01');
    expect(toDisplay('weight', 0, 'us')).toBe('0');
    expect(unitLabel('weight', 'us')).toBe('lb');
    expect(unitLabel('seed', 'us')).toBe('oz');
    expect(unitLabel('seed', 'metric')).toBe('g');
  });
  it('an untouched small value saves back exactly', () => {
    expect(keepOrConvert('spacing', '18', '18', 46, 'us')).toBe(46);
    expect(keepOrConvert('seed', '0.1', '0.1', 3, 'us')).toBe(3);
  });

  it('a light harvest under one pound or kilogram shows two decimals', () => {
    expect(toDisplay('weight', 0.05, 'metric')).toBe('0.05');
    expect(toDisplay('weight', 0.05, 'us')).toBe('0.11');
    expect(toDisplay('weight', 0.2, 'us')).toBe('0.44');
    expect(toDisplay('weight', 1.25, 'metric')).toBe('1.3');
  });
});
