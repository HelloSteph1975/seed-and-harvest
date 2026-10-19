import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';

let t;
beforeEach(() => { t = makeTestContext(); });
afterEach(() => t.cleanup());

async function post(url, body, status = 201) {
  const res = await t.http().post(url).send(body);
  if (res.status !== status) throw new Error(`${url} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const get = async url => (await t.http().get(url)).body;
const plantByKey = async key => (await get('/api/plants')).find(p => p.starter_key === key);
async function setup() {
  const place = await post('/api/places', { name: 'Springfield', last_frost: '04-01', time_zone: 'UTC' });
  const other = await post('/api/places', { name: 'Shelbyville', time_zone: 'UTC' });
  const bed = await post('/api/spaces', { place_id: place.id, name: 'North bed', kind: 'bed' });
  const far = await post('/api/spaces', { place_id: other.id, name: 'Far bed', kind: 'bed' });
  const rack = await post('/api/spaces', { place_id: place.id, name: 'Rack', kind: 'microgreen_rack' });
  const tomato = await plantByKey('plant.test-tomato');
  const pea = await post('/api/plants', { name: 'Pea shoots', kind: 'microgreen', days_min: 10 });
  const goats = await post('/api/animals', { name: 'The goats', kind: 'goat' });
  const p = await post('/api/plantings', { space_id: bed.id, plant_id: tomato.id, how_started: 'start', start_on: '2027-04-10', status: 'growing' });
  const q = await post('/api/plantings', { space_id: far.id, plant_id: tomato.id, how_started: 'start', start_on: '2027-04-10' });
  const tray = await post('/api/trays', { plant_id: pea.id, space_id: rack.id, sown_on: '2027-03-01' });
  return { place, other, bed, rack, tomato, pea, goats, p, q, tray };
}
const harvest = (s, extra = {}) => post('/api/harvests', { planting_id: s.p.id, harvested_on: '2027-07-01', quantity: 5, unit: 'kg', ...extra });

describe('harvests', () => {
  it('a harvest saves with its split and works out what was kept fresh', async () => {
    const s = await setup();
    const h = await harvest(s, { larder_qty: 2, animals_qty: 0.5, animal_id: s.goats.id, given_qty: 1, given_to: 'Neighbors', sold_qty: 0.5, sold_price: 6, sold_to: 'Market' });
    expect(h).toMatchObject({ quantity: 5, unit: 'kg', larder_qty: 2, kept_qty: 1, larder_state: 'off', version: 1 });
    const full = await get(`/api/harvests/${h.id}`);
    expect(full).toMatchObject({ crop: { plant_id: s.tomato.id, name: 'Test tomato' }, place_id: s.place.id, source: { kind: 'planting', id: s.p.id }, kept_qty: 1 });
  });

  it('parts that add up to more than the harvest are refused', async () => {
    const s = await setup();
    const res = await t.http().post('/api/harvests').send({ planting_id: s.p.id, harvested_on: '2027-07-01', quantity: 2, unit: 'kg', larder_qty: 1.5, sold_qty: 1 });
    expect(res.status).toBe(400);
    expect(res.body.detailCodes.larder_qty.code).toBe('split_too_big');
  });

  it('animals need an animal', async () => {
    const s = await setup();
    const res = await t.http().post('/api/harvests').send({ planting_id: s.p.id, harvested_on: '2027-07-01', quantity: 2, unit: 'kg', animals_qty: 1 });
    expect(res.body.detailCodes.animal_id.code).toBe('required');
  });

  it('a harvest needs a planting or a tray, not both', async () => {
    const s = await setup();
    const both = await t.http().post('/api/harvests').send({ planting_id: s.p.id, tray_id: s.tray.id, harvested_on: '2027-07-01', quantity: 1, unit: 'kg' });
    expect(both.body.detailCodes.planting_id.code).toBe('pick_one');
    const none = await t.http().post('/api/harvests').send({ harvested_on: '2027-07-01', quantity: 1, unit: 'kg' });
    expect(none.body.detailCodes.planting_id.code).toBe('pick_one');
  });

  it('the first harvest moves the planting to harvesting, a tray harvest marks the tray harvested', async () => {
    const s = await setup();
    await harvest(s);
    expect((await get(`/api/plantings/${s.p.id}`)).status).toBe('harvesting');
    await post('/api/harvests', { tray_id: s.tray.id, harvested_on: '2027-03-11', quantity: 0.3, unit: 'kg' });
    expect(await get(`/api/trays/${s.tray.id}`)).toMatchObject({ status: 'harvested', harvested_on: '2027-03-11' });
  });

  it('deleting a planting takes its harvests to the Trash and restore brings them back', async () => {
    const s = await setup();
    const h = await harvest(s);
    await t.http().delete(`/api/plantings/${s.p.id}`).expect(200);
    expect((await t.http().get(`/api/harvests/${h.id}`)).status).toBe(404);
    expect((await get('/api/trash')).map(x => x.type)).toEqual(['planting']);
    await t.http().post(`/api/trash/planting/${s.p.id}/restore`).expect(200);
    expect((await t.http().get(`/api/harvests/${h.id}`)).status).toBe(200);
    await t.http().delete(`/api/plantings/${s.p.id}`).expect(200);
    await t.http().post('/api/trash/empty').send({}).expect(200);
    expect(t.ctx.db.prepare('SELECT COUNT(*) n FROM harvests').get().n).toBe(0);
  });

  it('a harvest can’t be restored while its planting is in the Trash', async () => {
    const s = await setup();
    const h = await harvest(s);
    await t.http().delete(`/api/harvests/${h.id}`).expect(200);
    await t.http().delete(`/api/plantings/${s.p.id}`).expect(200);
    expect((await t.http().post(`/api/trash/harvest/${h.id}/restore`)).status).toBe(409);
  });

  it('stale save 409', async () => {
    const s = await setup();
    const h = await harvest(s);
    await t.http().patch(`/api/harvests/${h.id}`).send({ version: 1, notes: 'a' }).expect(200);
    const res = await t.http().patch(`/api/harvests/${h.id}`).send({ version: 1, notes: 'b' });
    expect(res.status).toBe(409);
    expect(res.body.current.crop.name).toBe('Test tomato');
  });

  it('the list filters by place and year', async () => {
    const s = await setup();
    const a = await harvest(s);
    await harvest(s, { harvested_on: '2026-12-31' });
    await post('/api/harvests', { planting_id: s.q.id, harvested_on: '2027-07-02', quantity: 1, unit: 'kg' });
    expect((await get(`/api/harvests?place_id=${s.place.id}&year=2027`)).map(h => h.id)).toEqual([a.id]);
  });

  it('emptying the Trash works when a harvest went to an animal that is in the Trash', async () => {
    const place = (await t.http().post('/api/places').send({ name: 'Springfield', time_zone: 'UTC' })).body;
    const bed = (await t.http().post('/api/spaces').send({ place_id: place.id, name: 'Bed', kind: 'bed' })).body;
    const tomato = (await t.http().get('/api/plants')).body.find(p => p.starter_key === 'plant.test-tomato');
    const p = (await t.http().post('/api/plantings').send({ space_id: bed.id, plant_id: tomato.id, how_started: 'start', start_on: '2027-04-10' })).body;
    const goats = (await t.http().post('/api/animals').send({ name: 'Goats', kind: 'goat' })).body;
    const h = (await t.http().post('/api/harvests').send({ planting_id: p.id, harvested_on: '2027-07-01', quantity: 2, unit: 'kg', animals_qty: 1, animal_id: goats.id })).body;
    await t.http().delete(`/api/animals/${goats.id}`).expect(200);
    await t.http().post('/api/trash/empty').expect(200);
    expect((await t.http().get(`/api/harvests/${h.id}`)).body).toMatchObject({ animal_id: null, animals_qty: 1 });
  });

  it('a harvest whose animal was emptied from the Trash still saves a note', async () => {
    const place = (await t.http().post('/api/places').send({ name: 'Springfield', time_zone: 'UTC' })).body;
    const bed = (await t.http().post('/api/spaces').send({ place_id: place.id, name: 'Bed', kind: 'bed' })).body;
    const tomato = (await t.http().get('/api/plants')).body.find(p => p.starter_key === 'plant.test-tomato');
    const p = (await t.http().post('/api/plantings').send({ space_id: bed.id, plant_id: tomato.id, how_started: 'start', start_on: '2027-04-10' })).body;
    const goats = (await t.http().post('/api/animals').send({ name: 'Goats', kind: 'goat' })).body;
    const h = (await t.http().post('/api/harvests').send({ planting_id: p.id, harvested_on: '2027-07-01', quantity: 2, unit: 'kg', animals_qty: 1, animal_id: goats.id })).body;
    await t.http().delete(`/api/animals/${goats.id}`).expect(200);
    await t.http().post('/api/trash/empty').expect(200);
    const v = (await t.http().get(`/api/harvests/${h.id}`)).body.version;
    const res = await t.http().patch(`/api/harvests/${h.id}`).send({ version: v, notes: 'Good year', quantity: 2, animals_qty: 1, animal_id: null });
    expect(res.status).toBe(200);
    const raised = await t.http().patch(`/api/harvests/${h.id}`).send({ version: res.body.version, animals_qty: 1.5, animal_id: null });
    expect(raised.status).toBe(400);
  });
});
