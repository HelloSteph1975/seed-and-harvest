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
async function setup() {
  const place = await post('/api/places', { name: 'Springfield', last_frost: '04-01' });
  const rack = await post('/api/spaces', { place_id: place.id, name: 'Rack', kind: 'microgreen_rack', tray_count: 4 });
  const pea = await post('/api/plants', { name: 'Pea shoots', kind: 'microgreen', days_min: 10, days_max: 14, seed_g_per_tray: 280, safety_goats: 'safe', safety_chickens: 'safe' });
  const goats = await post('/api/animals', { name: 'The goats', kind: 'goat' });
  return { place, rack, pea, goats };
}
const tray = (s, extra = {}) => post('/api/trays', { plant_id: s.pea.id, space_id: s.rack.id, sown_on: '2027-03-01', ...extra });

describe('trays', () => {
  it('a tray defaults its harvest date and seed amount from the plant', async () => {
    const s = await setup();
    const x = await tray(s, { tray_count: 2, animal_id: s.goats.id });
    expect(x).toMatchObject({ harvest_on: '2027-03-11', seed_g: 560, status: 'growing', series_id: x.id, tray_count: 2 });
    const full = await get(`/api/trays/${x.id}`);
    expect(full).toMatchObject({ plant: { name: 'Pea shoots' }, space: { name: 'Rack', tray_count: 4 }, animal: { name: 'The goats', kind: 'goat' }, safety: 'safe' });
    const own = await tray(s, { harvest_on: '2027-03-09', seed_g: 300 });
    expect(own).toMatchObject({ harvest_on: '2027-03-09', seed_g: 300 });
    const bad = await t.http().post('/api/trays').send({ plant_id: s.pea.id, space_id: s.rack.id, sown_on: '2027-03-01', harvest_on: '2027-02-01' });
    expect(bad.body.detailCodes.harvest_on.code).toBe('range_order');
  });

  it('a crop that isn\'t a microgreen is refused', async () => {
    const s = await setup();
    const kale = await post('/api/plants', { name: 'Kale', kind: 'vegetable' });
    const res = await t.http().post('/api/trays').send({ plant_id: kale.id, space_id: s.rack.id, sown_on: '2027-03-01' });
    expect(res.status).toBe(400);
    expect(res.body.detailCodes.plant_id.code).toBe('not_microgreen');
  });

  it('sow again joins the series and moves the repeat to the new tray', async () => {
    const s = await setup();
    const a = await tray(s, { repeat_days: 5, animal_id: s.goats.id });
    expect((await get(`/api/trays/${a.id}`)).next_sow_on).toBe('2027-03-06');
    const b = await post(`/api/trays/${a.id}/sow-again`, { sown_on: '2027-03-06' });
    expect(b).toMatchObject({ series_id: a.id, repeat_days: 5, sown_on: '2027-03-06', harvest_on: '2027-03-16', animal_id: s.goats.id, status: 'growing' });
    expect((await get(`/api/trays/${a.id}`)).repeat_days).toBeNull();
    expect((await get(`/api/trays/${a.id}`)).next_sow_on).toBeNull();
    expect((await get(`/api/trays/${b.id}`)).next_sow_on).toBe('2027-03-11');
  });

  it('sow again from an older tray goes to the end of the chain', async () => {
    const s = await setup();
    const a = await tray(s, { repeat_days: 5 });
    const b = await post(`/api/trays/${a.id}/sow-again`, { sown_on: '2027-03-06' });
    const c = await post(`/api/trays/${a.id}/sow-again`, { sown_on: '2027-03-11' });
    expect(c.repeat_days).toBe(5);
    expect((await get(`/api/trays/${b.id}`)).repeat_days).toBeNull();
    expect((await get(`/api/trays/${c.id}`)).next_sow_on).toBe('2027-03-16');
  });

  it('stopping the repeat clears the next sowing', async () => {
    const s = await setup();
    const a = await tray(s, { repeat_days: 5 });
    await t.http().patch(`/api/trays/${a.id}`).send({ version: a.version, repeat_days: null }).expect(200);
    expect((await get(`/api/trays/${a.id}`)).next_sow_on).toBeNull();
  });

  it('deleting the newest tray hands the repeat back, restore takes it again', async () => {
    const s = await setup();
    const a = await tray(s, { repeat_days: 5 });
    const b = await post(`/api/trays/${a.id}/sow-again`, { sown_on: '2027-03-06' });
    await t.http().delete(`/api/trays/${b.id}`).expect(200);
    expect((await get(`/api/trays/${a.id}`)).next_sow_on).toBe('2027-03-06');
    await t.http().post(`/api/trash/tray/${b.id}/restore`).expect(200);
    expect((await get(`/api/trays/${a.id}`)).next_sow_on).toBeNull();
    expect((await get(`/api/trays/${b.id}`)).next_sow_on).toBe('2027-03-11');
  });

  it('trays go to the Trash with their rack and come back with it', async () => {
    const s = await setup();
    const a = await tray(s);
    await t.http().delete(`/api/spaces/${s.rack.id}`).expect(200);
    expect((await t.http().get(`/api/trays/${a.id}`)).status).toBe(404);
    expect((await get('/api/trash')).map(x => x.type)).toEqual(['space']);
    await t.http().post(`/api/trash/space/${s.rack.id}/restore`).expect(200);
    expect((await t.http().get(`/api/trays/${a.id}`)).status).toBe(200);
    await t.http().delete(`/api/trays/${a.id}`).expect(200);
    await t.http().delete(`/api/spaces/${s.rack.id}`).expect(200);
    expect((await t.http().post(`/api/trash/tray/${a.id}/restore`)).status).toBe(409);
    await t.http().post('/api/trash/empty').send({}).expect(200);
  });

  it('due lists trays ready to cut and series due to sow in the range', async () => {
    const s = await setup();
    const a = await tray(s, { repeat_days: 5 });
    await tray(s, { sown_on: '2027-03-20', status: 'planned' });
    const due = await get(`/api/trays/due?place_id=${s.place.id}&from=2027-03-05&to=2027-03-11`);
    expect(due.ready.map(x => x.id)).toEqual([a.id]);
    expect(due.sow.map(x => [x.tray.id, x.on])).toEqual([[a.id, '2027-03-06']]);
    const later = await get(`/api/trays/due?place_id=${s.place.id}&from=2027-03-18&to=2027-03-24`);
    expect(later.sow.map(x => x.planned)).toContain(true);
  });

  it('a plant with live trays can\'t be deleted', async () => {
    const s = await setup();
    await tray(s);
    const res = await t.http().delete(`/api/plants/${s.pea.id}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('plant_in_use');
  });

  it('harvested without a date takes the date sent', async () => {
    const s = await setup();
    const a = await tray(s);
    const res = await t.http().patch(`/api/trays/${a.id}`).send({ version: a.version, status: 'harvested', harvested_on: '2027-03-11' });
    expect(res.body).toMatchObject({ status: 'harvested', harvested_on: '2027-03-11' });
    const b = await tray(s);
    const bad = await t.http().patch(`/api/trays/${b.id}`).send({ version: b.version, status: 'harvested' });
    expect(bad.status).toBe(400);
    expect(bad.body.detailCodes.harvested_on.code).toBe('required');
  });

  it('a stale save is 409 and lists filter by place', async () => {
    const s = await setup();
    const a = await tray(s);
    await t.http().patch(`/api/trays/${a.id}`).send({ version: 1, notes: 'one' }).expect(200);
    expect((await t.http().patch(`/api/trays/${a.id}`).send({ version: 1, notes: 'two' })).status).toBe(409);
    expect((await get(`/api/trays?place_id=${s.place.id}`)).map(x => x.id)).toEqual([a.id]);
  });

  it('sowing again with a date before the newest tray keeps the repeat on the newest', async () => {
    const s = await setup();
    const a = await tray(s, { repeat_days: 7 });
    const planned = await post(`/api/trays/${a.id}/sow-again`, { sown_on: '2027-03-20', status: 'planned' });
    await post(`/api/trays/${a.id}/sow-again`, { sown_on: '2027-03-08' });
    const all = await get(`/api/trays?place_id=${s.place.id}`);
    expect(all.filter(x => x.repeat_days).map(x => x.id)).toEqual([planned.id]);
    expect(all.find(x => x.id === planned.id).next_sow_on).toBe('2027-03-27');
  });

  it('a repeat set on an older tray moves to the newest tray of its series', async () => {
    const s = await setup();
    const a = await tray(s);
    const b = await post(`/api/trays/${a.id}/sow-again`, { sown_on: '2027-03-06' });
    const fresh = await get(`/api/trays/${a.id}`);
    await t.http().patch(`/api/trays/${a.id}`).send({ version: fresh.version, repeat_days: 3 }).expect(200);
    const all = await get(`/api/trays?place_id=${s.place.id}`);
    expect(all.filter(x => x.repeat_days).map(x => x.id)).toEqual([b.id]);
    expect(all.find(x => x.id === b.id).next_sow_on).toBe('2027-03-09');
  });

  it('a tray whose animal is in the Trash can still be edited', async () => {
    const s = await setup();
    const a = await tray(s, { animal_id: s.goats.id });
    await t.http().delete(`/api/animals/${s.goats.id}`).expect(200);
    const res = await t.http().patch(`/api/trays/${a.id}`).send({ version: a.version, animal_id: s.goats.id, notes: 'still fine' });
    expect(res.status).toBe(200);
    expect((await get(`/api/trays/${a.id}`)).animal).toMatchObject({ id: s.goats.id, deleted: true });
  });

  it('an update returns the whole tray, with its crop, rack and safety', async () => {
    const s = await setup();
    const a = await tray(s, { animal_id: s.goats.id });
    const res = await t.http().patch(`/api/trays/${a.id}`).send({ version: a.version, status: 'harvested', harvested_on: '2027-03-11' });
    expect(res.body).toMatchObject({ plant: { name: 'Pea shoots' }, space: { name: 'Rack' }, animal: { name: 'The goats' }, safety: 'safe', status: 'harvested' });
    const stale = await t.http().patch(`/api/trays/${a.id}`).send({ version: a.version, notes: 'x' });
    expect(stale.status).toBe(409);
    expect(stale.body.current.space).toMatchObject({ name: 'Rack' });
  });

  it('a new repeat set on an older tray replaces the series interval', async () => {
    const s = await setup();
    const a = await tray(s, { repeat_days: 5 });
    const b = await post(`/api/trays/${a.id}/sow-again`, { sown_on: '2027-03-06' });
    const old = await get(`/api/trays/${a.id}`);
    await t.http().patch(`/api/trays/${a.id}`).send({ version: old.version, repeat_days: 3 }).expect(200);
    expect((await get(`/api/trays/${b.id}`)).repeat_days).toBe(3);
    expect((await get(`/api/trays/${a.id}`)).repeat_days).toBeNull();
  });

  it('clearing the ready date on an edit puts back the crop default', async () => {
    const s = await setup();
    const a = await tray(s, { harvest_on: '2027-03-09' });
    const res = await t.http().patch(`/api/trays/${a.id}`).send({ version: a.version, harvest_on: null });
    expect(res.status).toBe(200);
    expect(res.body.harvest_on).toBe('2027-03-11');
  });
});
