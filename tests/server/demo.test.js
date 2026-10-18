import { describe, it, expect, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';
import { seedDemo } from '../../server/demo/seed.js';
import { SPACE_KINDS } from '../../server/services/spaces.js';
import { CONTENT_DIR } from '../../server/services/starter.js';

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

  it('adds a sample variety to a starter plant and one plant of its own, once', async () => {
    t = makeTestContext({ contentDir: CONTENT_DIR });
    seedDemo(t.ctx);
    seedDemo(t.ctx);
    const own = t.ctx.db.prepare("SELECT * FROM plants WHERE name = 'Heirloom chile' AND deleted_at IS NULL").all();
    expect(own).toHaveLength(1);
    expect(own[0].is_starter).toBe(0);
    const tomato = t.ctx.db.prepare("SELECT id FROM plants WHERE starter_key = 'plant.tomato'").get();
    expect(t.ctx.db.prepare('SELECT name FROM plant_varieties WHERE plant_id = ?').all(tomato.id).map(v => v.name)).toEqual(['Roma']);
  });

  it('the demo has plantings with overdue, open and done tasks', async () => {
    t = makeTestContext({ contentDir: CONTENT_DIR });
    seedDemo(t.ctx);
    seedDemo(t.ctx);
    const home = (await t.http().get('/api/places')).body.find(p => p.name === 'Riverside Homestead');
    const plantings = (await t.http().get(`/api/plantings?place_id=${home.id}`)).body;
    expect(plantings.length).toBe(3);
    const today = new Date().toISOString().slice(0, 10);
    const tasks = (await t.http().get(`/api/tasks?place_id=${home.id}&from=${today}&to=${today}&open=1`)).body;
    expect(tasks.some(x => !x.done_on && (x.end_on ?? x.due_on) < today)).toBe(true);
    expect(tasks.some(x => x.kind === 'harvest' && x.due_on <= today && x.end_on >= today)).toBe(true);
    expect(t.ctx.db.prepare('SELECT COUNT(*) n FROM tasks WHERE done_on IS NOT NULL').get().n).toBeGreaterThan(0);
  });

  it('the demo has animals, a repeating series and a tray ready to cut', async () => {
    t = makeTestContext({ contentDir: CONTENT_DIR });
    seedDemo(t.ctx);
    seedDemo(t.ctx);
    expect((await t.http().get('/api/animals')).body.map(a => a.kind).sort()).toEqual(['chicken', 'goat']);
    const home = (await t.http().get('/api/places')).body.find(p => p.name === 'Riverside Homestead');
    const today = new Date().toISOString().slice(0, 10);
    const trays = (await t.http().get(`/api/trays?place_id=${home.id}`)).body;
    expect(trays.some(x => x.repeat_days && x.next_sow_on)).toBe(true);
    expect(trays.some(x => x.status === 'growing' && x.harvest_on <= today)).toBe(true);
    const gh = (await t.http().get(`/api/spaces?place_id=${home.id}`)).body.find(s => s.kind === 'greenhouse');
    expect(gh.notes_winter).toBeTruthy();
  });
});
