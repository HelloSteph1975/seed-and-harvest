import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';

let t;
beforeEach(() => { t = makeTestContext(); });
afterEach(() => t.cleanup());

export async function post(t, url, body, status = 201) {
  const res = await t.http().post(url).send(body);
  if (res.status !== status) throw new Error(`${url} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const plantByKey = async key => (await t.http().get('/api/plants')).body.find(p => p.starter_key === key);

// A place in Springfield with frost dates, one bed, and the fixture tomato.
async function setup() {
  const place = await post(t, '/api/places', { name: 'Springfield', last_frost: '04-01', first_frost: '10-30' });
  const space = await post(t, '/api/spaces', { place_id: place.id, name: 'North bed', kind: 'bed' });
  const tomato = await plantByKey('plant.test-tomato');
  return { place, space, tomato };
}
const planting = (s, extra = {}) => post(t, '/api/plantings', { space_id: s.space.id, plant_id: s.tomato.id, how_started: 'seed_indoors', start_on: '2027-02-10', count: 4, ...extra });

describe('plantings', () => {
  it('a planting saves and comes back with its plant, variety and space', async () => {
    const s = await setup();
    const v = await post(t, `/api/plants/${s.tomato.id}/varieties`, { name: 'Roma' });
    const p = await planting(s, { variety_id: v.id, notes: 'By the fence' });
    expect(p).toMatchObject({ status: 'planned', count: 4, how_started: 'seed_indoors', start_on: '2027-02-10', version: 1, notes: 'By the fence' });
    const full = (await t.http().get(`/api/plantings/${p.id}`)).body;
    expect(full.plant).toMatchObject({ id: s.tomato.id, name: 'Test tomato', starter_key: 'plant.test-tomato' });
    expect(full.variety).toEqual({ id: v.id, name: 'Roma' });
    expect(full.space).toMatchObject({ id: s.space.id, name: 'North bed', place_id: s.place.id });
    expect(Array.isArray(full.tasks)).toBe(true);
    expect(full.log).toEqual([]);
    const list = (await t.http().get(`/api/plantings?place_id=${s.place.id}`)).body;
    expect(list.map(x => x.id)).toEqual([p.id]);
    expect(list[0].plant.name).toBe('Test tomato');
  });

  it('a variety from another plant is refused', async () => {
    const s = await setup();
    const basil = await plantByKey('plant.test-basil');
    const v = await post(t, `/api/plants/${basil.id}/varieties`, { name: 'Genovese' });
    const res = await t.http().post('/api/plantings').send({ space_id: s.space.id, plant_id: s.tomato.id, variety_id: v.id, how_started: 'seed_indoors', start_on: '2027-02-10' });
    expect(res.status).toBe(400);
    expect(res.body.detailCodes.variety_id.code).toBe('wrong_variety');
  });

  it('mature start is refused for an annual, and indoor seed for a plant with no indoor timing', async () => {
    const s = await setup();
    const res = await t.http().post('/api/plantings').send({ space_id: s.space.id, plant_id: s.tomato.id, how_started: 'mature', start_on: '2027-04-10' });
    expect(res.status).toBe(400);
    expect(res.body.detailCodes.how_started.code).toBe('wrong_start');
    const basil = await plantByKey('plant.test-basil');
    const res2 = await t.http().post('/api/plantings').send({ space_id: s.space.id, plant_id: basil.id, how_started: 'seed_indoors', start_on: '2027-04-10' });
    expect(res2.body.detailCodes.how_started.code).toBe('wrong_start');
  });

  it('a bad date and a missing space are refused', async () => {
    const s = await setup();
    const res = await t.http().post('/api/plantings').send({ space_id: 999, plant_id: s.tomato.id, how_started: 'start', start_on: '2027-02-30' });
    expect(res.status).toBe(400);
    expect(res.body.detailCodes.start_on.code).toBe('not_date');
    expect(res.body.detailCodes.space_id.code).toBe('space_gone');
  });

  it('stale save 409', async () => {
    const s = await setup();
    const p = await planting(s);
    await t.http().patch(`/api/plantings/${p.id}`).send({ version: 1, notes: 'one' }).expect(200);
    const res = await t.http().patch(`/api/plantings/${p.id}`).send({ version: 1, notes: 'two' });
    expect(res.status).toBe(409);
    expect(res.body.current.notes).toBe('one');
  });

  it('deleting a space takes its plantings, tasks and log to the Trash and restore brings them back', async () => {
    const s = await setup();
    const p = await planting(s);
    await post(t, `/api/plantings/${p.id}/log`, { on_date: '2027-02-11', kind: 'note', note: 'Looking good' });
    await t.http().delete(`/api/spaces/${s.space.id}`).expect(200);
    expect((await t.http().get(`/api/plantings?place_id=${s.place.id}`)).body).toEqual([]);
    const trash = (await t.http().get('/api/trash')).body;
    expect(trash.map(x => x.type)).toEqual(['space']);
    expect(trash[0].extra).toBeGreaterThan(0);
    await t.http().post(`/api/trash/space/${s.space.id}/restore`).expect(200);
    const full = (await t.http().get(`/api/plantings/${p.id}`)).body;
    expect(full.log).toHaveLength(1);
    expect(Array.isArray(full.tasks)).toBe(true);
  });

  it('deleting a place takes its spaces\' plantings with it', async () => {
    const s = await setup();
    const p = await planting(s);
    await t.http().delete(`/api/places/${s.place.id}`).expect(200);
    expect((await t.http().get(`/api/plantings/${p.id}`)).status).toBe(404);
    await t.http().post(`/api/trash/place/${s.place.id}/restore`).expect(200);
    expect((await t.http().get(`/api/plantings/${p.id}`)).status).toBe(200);
  });

  it('a planting can\'t be restored while its space is in the Trash', async () => {
    const s = await setup();
    const p = await planting(s);
    await t.http().delete(`/api/plantings/${p.id}`).expect(200);
    await t.http().delete(`/api/spaces/${s.space.id}`).expect(200);
    const res = await t.http().post(`/api/trash/planting/${p.id}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('parent_in_trash');
  });

  it('a plant with plantings can\'t be deleted', async () => {
    const s = await setup();
    await planting(s);
    const res = await t.http().delete(`/api/plants/${s.tomato.id}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('plant_in_use');
  });

  it('a deleted variety shows as none on the planting', async () => {
    const s = await setup();
    const v = await post(t, `/api/plants/${s.tomato.id}/varieties`, { name: 'Roma' });
    const p = await planting(s, { variety_id: v.id });
    await t.http().delete(`/api/varieties/${v.id}`).expect(200);
    expect((await t.http().get(`/api/plantings/${p.id}`)).body.variety).toBeNull();
  });

  it('emptying the Trash removes plantings before spaces', async () => {
    const s = await setup();
    const p = await planting(s);
    await post(t, `/api/plantings/${p.id}/log`, { on_date: '2027-02-11', kind: 'note', note: 'x' });
    await t.http().delete(`/api/spaces/${s.space.id}`).expect(200);
    await t.http().post('/api/trash/empty').send({}).expect(200);
    const db = t.ctx.db;
    expect(db.prepare('SELECT COUNT(*) n FROM plantings').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM tasks').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM planting_log').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM spaces').get().n).toBe(0);
  });

  it('a planting saves its purchase details and comes back with them', async () => {
    const s = await setup();
    const fig = await post(t, '/api/plants', { name: 'Fig', kind: 'fruit_tree', perennial: true, years_min: 1, years_max: 2 });
    const p = await post(t, '/api/plantings', { space_id: s.space.id, plant_id: fig.id, how_started: 'mature', start_on: '2027-03-15',
      bought_from: 'Valley Nursery', bought_on: '2027-03-10', price: 45.5, size_when_bought: '3 years, 15 gal', bears_on: '2027-07-01' });
    expect(p).toMatchObject({ bought_from: 'Valley Nursery', bought_on: '2027-03-10', price: 45.5, size_when_bought: '3 years, 15 gal', bears_on: '2027-07-01', in_container: 0 });
  });

  it('a planting in a container space starts in a container', async () => {
    const s = await setup();
    const pot = await post(t, '/api/spaces', { place_id: s.place.id, name: 'Big pot', kind: 'container' });
    const p = await post(t, '/api/plantings', { space_id: pot.id, plant_id: s.tomato.id, how_started: 'start', start_on: '2027-04-10' });
    expect(p.in_container).toBe(1);
    const q = await post(t, '/api/plantings', { space_id: pot.id, plant_id: s.tomato.id, how_started: 'start', start_on: '2027-04-10', in_container: false });
    expect(q.in_container).toBe(0);
  });

  it('bearing cannot be before it was bought or planted', async () => {
    const s = await setup();
    const res = await t.http().post('/api/plantings').send({ space_id: s.space.id, plant_id: s.tomato.id, how_started: 'start', start_on: '2027-04-10', bears_on: '2027-04-01' });
    expect(res.status).toBe(400);
    expect(res.body.detailCodes.bears_on.code).toBe('range_order');
    const res2 = await t.http().post('/api/plantings').send({ space_id: s.space.id, plant_id: s.tomato.id, how_started: 'start', start_on: '2027-04-10', bought_on: '2027-05-01', bears_on: '2027-04-20' });
    expect(res2.body.detailCodes.bears_on.code).toBe('range_order');
  });

  it('the list filters to perennials', async () => {
    const s = await setup();
    const fig = await post(t, '/api/plants', { name: 'Fig', kind: 'fruit_tree', perennial: true });
    await planting(s);
    const p = await post(t, '/api/plantings', { space_id: s.space.id, plant_id: fig.id, how_started: 'mature', start_on: '2027-03-15' });
    expect((await t.http().get(`/api/plantings?place_id=${s.place.id}&perennial=1`)).body.map(x => x.id)).toEqual([p.id]);
  });
});
