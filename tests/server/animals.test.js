import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';
import { safetyFor } from '../../server/services/animals.js';

let t;
beforeEach(() => { t = makeTestContext(); });
afterEach(() => t.cleanup());

async function post(url, body, status = 201) {
  const res = await t.http().post(url).send(body);
  if (res.status !== status) throw new Error(`${url} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const MUSTARD = { name: 'Mustard', kind: 'microgreen', days_min: 8, days_max: 12, seed_g_per_tray: 20, safety_goats: 'avoid', safety_chickens: 'small' };

describe('animals', () => {
  it('an animal saves, lists in order and a stale save is 409', async () => {
    const b = await post('/api/animals', { name: 'The hens', kind: 'chicken', sort_order: 2 });
    const a = await post('/api/animals', { name: 'The goats', kind: 'goat', sort_order: 1 });
    expect((await t.http().get('/api/animals')).body.map(x => x.name)).toEqual(['The goats', 'The hens']);
    await t.http().patch(`/api/animals/${a.id}`).send({ version: 1, notes: 'Two does' }).expect(200);
    expect((await t.http().patch(`/api/animals/${a.id}`).send({ version: 1, notes: 'x' })).status).toBe(409);
    expect((await t.http().post('/api/animals').send({ name: '', kind: 'goat' })).status).toBe(400);
    expect((await t.http().post('/api/animals').send({ name: 'Rex', kind: 'dog' })).status).toBe(400);
    expect(b.kind).toBe('chicken');
  });

  it('goats and chickens read the plant\'s ratings, other animals read their own', async () => {
    const goat = await post('/api/animals', { name: 'The goats', kind: 'goat' });
    const hen = await post('/api/animals', { name: 'The hens', kind: 'chicken' });
    const rabbit = await post('/api/animals', { name: 'Rabbits', kind: 'other' });
    const m = await post('/api/plants', { ...MUSTARD, animal_safety: [{ animal_id: rabbit.id, safety: 'avoid' }] });
    const plant = t.ctx.db.prepare('SELECT * FROM plants WHERE id = ?').get(m.id);
    expect(safetyFor(t.ctx.db, plant, goat)).toBe('avoid');
    expect(safetyFor(t.ctx.db, plant, hen)).toBe('small');
    expect(safetyFor(t.ctx.db, plant, rabbit)).toBe('avoid');
    const duck = await post('/api/animals', { name: 'Ducks', kind: 'other' });
    expect(safetyFor(t.ctx.db, plant, duck)).toBeNull();
  });

  it('a plant saves ratings for other animals and replaces them whole', async () => {
    const rabbit = await post('/api/animals', { name: 'Rabbits', kind: 'other' });
    const duck = await post('/api/animals', { name: 'Ducks', kind: 'other' });
    const m = await post('/api/plants', { ...MUSTARD, animal_safety: [{ animal_id: rabbit.id, safety: 'avoid' }, { animal_id: duck.id, safety: 'small' }] });
    expect((await t.http().get(`/api/plants/${m.id}`)).body.animal_safety).toEqual([{ animal_id: duck.id, safety: 'small' }, { animal_id: rabbit.id, safety: 'avoid' }].sort((a, b) => a.animal_id - b.animal_id));
    await t.http().patch(`/api/plants/${m.id}`).send({ version: 1, animal_safety: [{ animal_id: duck.id, safety: 'safe' }] }).expect(200);
    expect((await t.http().get(`/api/plants/${m.id}`)).body.animal_safety).toEqual([{ animal_id: duck.id, safety: 'safe' }]);
  });

  it('ratings for goats or chickens can\'t be saved as other-animal ratings, and only microgreens keep them', async () => {
    const goat = await post('/api/animals', { name: 'The goats', kind: 'goat' });
    const res = await t.http().post('/api/plants').send({ ...MUSTARD, animal_safety: [{ animal_id: goat.id, safety: 'safe' }] });
    expect(res.status).toBe(201);
    expect(res.body.animal_safety).toEqual([]);
    const bad = await t.http().post('/api/plants').send({ ...MUSTARD, animal_safety: [{ animal_id: goat.id, safety: 'yummy' }] });
    expect(bad.body.detailCodes.animal_safety.code).toBe('bad_format');
    const rabbit = await post('/api/animals', { name: 'Rabbits', kind: 'other' });
    const kale = await post('/api/plants', { name: 'Kale', kind: 'vegetable', animal_safety: [{ animal_id: rabbit.id, safety: 'safe' }] });
    expect((await t.http().get(`/api/plants/${kale.id}`)).body.animal_safety).toEqual([]);
  });

  it('deleting an animal forever unlinks its trays and drops its ratings', async () => {
    const rabbit = await post('/api/animals', { name: 'Rabbits', kind: 'other' });
    const m = await post('/api/plants', { ...MUSTARD, animal_safety: [{ animal_id: rabbit.id, safety: 'avoid' }] });
    await t.http().delete(`/api/animals/${rabbit.id}`).expect(200);
    expect((await t.http().get('/api/trash')).body.map(x => x.type)).toEqual(['animal']);
    await t.http().delete(`/api/trash/animal/${rabbit.id}`).expect(200);
    expect((await t.http().get(`/api/plants/${m.id}`)).body.animal_safety).toEqual([]);
  });

  it('an animal changed from Other to Goat drops its own ratings, and its microgreens still save', async () => {
    const rabbit = await post('/api/animals', { name: 'Rabbits', kind: 'other' });
    const m = await post('/api/plants', { ...MUSTARD, animal_safety: [{ animal_id: rabbit.id, safety: 'avoid' }] });
    await t.http().patch(`/api/animals/${rabbit.id}`).send({ version: 1, kind: 'goat' }).expect(200);
    expect((await t.http().get(`/api/plants/${m.id}`)).body.animal_safety).toEqual([]);
    await t.http().patch(`/api/plants/${m.id}`).send({ version: 1, notes: 'x', animal_safety: [{ animal_id: rabbit.id, safety: 'avoid' }] }).expect(200);
  });
});
