import { describe, it, expect, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';
import { CONTENT_DIR, readFolder } from '../../server/services/starter.js';

let t;
afterEach(() => t?.cleanup());

describe('the real starter library', () => {
  it('seeds every plant and guide, with every plant guide linked to its plant', async () => {
    t = makeTestContext({ contentDir: CONTENT_DIR });
    const plants = readFolder(CONTENT_DIR, 'plants');
    const guides = readFolder(CONTENT_DIR, 'guides');
    const db = t.ctx.db;
    expect(db.prepare('SELECT count(*) n FROM plants WHERE is_starter = 1').get().n).toBe(plants.length);
    expect(db.prepare('SELECT count(*) n FROM guides WHERE is_starter = 1').get().n).toBe(guides.length);
    expect(db.prepare('SELECT count(*) n FROM guides WHERE plant_id IS NULL').get().n).toBe(guides.filter(g => !g.plant).length);
    expect(db.prepare('SELECT count(*) n FROM guides WHERE basics_id IS NULL AND plant_id IS NOT NULL').get().n)
      .toBe(guides.filter(g => g.plant && !g.basics).length);
    const tomato = (await t.http().get('/api/plants?q=tomato')).body.find(p => p.starter_key === 'plant.tomato');
    const full = (await t.http().get(`/api/plants/${tomato.id}`)).body;
    expect(full.guides.length).toBeGreaterThanOrEqual(2);
    expect(full.preserves.length).toBeGreaterThan(0);
  });
});
