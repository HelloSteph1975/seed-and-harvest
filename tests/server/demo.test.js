import { describe, it, expect, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';
import { seedDemo } from '../../server/demo/seed.js';
import { SPACE_KINDS } from '../../server/services/spaces.js';

let t;
afterEach(() => t?.cleanup());

describe('demo seed', () => {
  it('adds three generic places and a space of every kind, once', async () => {
    t = makeTestContext();
    seedDemo(t.ctx);
    seedDemo(t.ctx);
    const places = (await t.http().get('/api/places')).body;
    expect(places.map(p => p.name).sort()).toEqual(['High Desert Plot', 'Highland Valley', 'Riverside Homestead']);
    expect(places.find(p => p.name === 'Riverside Homestead')).toMatchObject({ status: 'current', zone: '8a', last_frost: '03-15', first_frost: '11-15' });
    expect(places.find(p => p.name === 'High Desert Plot')).toMatchObject({ status: 'future', zone: '6b', last_frost: '04-25', first_frost: '10-15' });
    expect(places.find(p => p.name === 'Highland Valley')).toMatchObject({ status: 'future', frost_free: 1, wet_months: [6, 7, 8, 9, 10] });
    const home = places.find(p => p.name === 'Riverside Homestead');
    const spaces = (await t.http().get(`/api/spaces?place_id=${home.id}`)).body;
    expect(new Set(spaces.map(s => s.kind))).toEqual(new Set(SPACE_KINDS));
  });

  it('a reset clears the samples and puts them back', async () => {
    t = makeTestContext();
    seedDemo(t.ctx);
    await t.http().post('/api/places').send({ name: 'Extra' });
    await t.http().put('/api/settings').send({ time_zone: 'Europe/Lisbon' });
    seedDemo(t.ctx, { reset: true });
    const names = (await t.http().get('/api/places')).body.map(p => p.name);
    expect(names).not.toContain('Extra');
    expect(names).toHaveLength(3);
    expect(t.ctx.db.prepare('SELECT count(*) n FROM settings').get().n).toBe(0);
  });
});
