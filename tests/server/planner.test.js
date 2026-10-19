import { describe, it, expect } from 'vitest';
import { suggestFor } from '../../server/services/planner.js';

const TOMATO = { yield_kg: 4.5, yield_per: 'plant', preserves: [{ form: 'Sauce', unit: 'quart', raw_kg: 4.5 }] };

describe('planner', () => {
  it('24 quarts of sauce at 4.5 kg per quart and 4.5 kg per plant suggests 24 plants', () => {
    const s = suggestFor({ goal_kind: 'preserve', amount: 24, preserve_position: 1 }, TOMATO, null);
    expect(s).toMatchObject({ per: 'plant', amount: 24, source: 'library', need: { kg: 108 } });
  });

  it('a per-meter crop suggests row length rounded up to half a meter', () => {
    const s = suggestFor({ goal_kind: 'raw', amount: 9, unit: 'kg' }, { yield_kg: 4, yield_per: 'meter', preserves: [] }, null);
    expect(s).toMatchObject({ per: 'meter', amount: 2.5, source: 'library' });
  });

  it("last year's real harvests replace the library yield when there is a known count", () => {
    const s = suggestFor({ goal_kind: 'raw', amount: 50, unit: 'kg' }, TOMATO, { per: 'plant', amount: 5 });
    expect(s).toMatchObject({ per: 'plant', amount: 10, source: 'last_year', yields: { library: { per: 'plant', amount: 4.5 }, last_year: { per: 'plant', amount: 5 } } });
  });

  it('no yield says so instead of suggesting a number', () => {
    expect(suggestFor({ goal_kind: 'raw', amount: 5, unit: 'kg' }, { yield_kg: null, yield_per: null, preserves: [] }, null)).toEqual({ needs: 'yield' });
    // Library yields are weights, so a count goal needs last year's counted harvests.
    expect(suggestFor({ goal_kind: 'raw', amount: 30, unit: 'count' }, TOMATO, null)).toEqual({ needs: 'yield' });
    expect(suggestFor({ goal_kind: 'raw', amount: 30, unit: 'count' }, TOMATO, { per: 'plant', amount: 4 })).toMatchObject({ per: 'plant', amount: 8, source: 'last_year' });
  });

  it('a removed preserving form asks for one', () => {
    expect(suggestFor({ goal_kind: 'preserve', amount: 4, preserve_position: 2 }, TOMATO, null)).toEqual({ needs: 'preserve' });
  });
});
