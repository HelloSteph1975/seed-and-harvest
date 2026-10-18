import { describe, it, expect } from 'vitest';
import { frostDay } from '../../client/src/lib/places.js';

describe('frostDay', () => {
  it('shows February 29 as February 29', () => {
    expect(frostDay('02-29', 'en')).toBe('February 29');
    expect(frostDay('03-20', 'en')).toBe('March 20');
  });
});
