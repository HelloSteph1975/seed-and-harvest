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
async function setup() {
  const home = await post('/api/places', { name: 'Springfield', time_zone: 'UTC' });
  const far = await post('/api/places', { name: 'Shelbyville', time_zone: 'UTC' });
  const bed = await post('/api/spaces', { place_id: home.id, name: 'Bed', kind: 'bed' });
  const farBed = await post('/api/spaces', { place_id: far.id, name: 'Far bed', kind: 'bed' });
  const rack = await post('/api/spaces', { place_id: home.id, name: 'Rack', kind: 'microgreen_rack' });
  const tomato = (await t.http().get('/api/plants')).body.find(p => p.starter_key === 'plant.test-tomato');
  const pea = await post('/api/plants', { name: 'Pea shoots', kind: 'microgreen', days_min: 10 });
  const p = await post('/api/plantings', { space_id: bed.id, plant_id: tomato.id, how_started: 'start', start_on: '2027-04-10' });
  const q = await post('/api/plantings', { space_id: farBed.id, plant_id: tomato.id, how_started: 'start', start_on: '2027-04-10' });
  const tray1 = await post('/api/trays', { plant_id: pea.id, space_id: rack.id, sown_on: '2027-03-01' });
  const tray2 = await post('/api/trays', { plant_id: pea.id, space_id: rack.id, sown_on: '2027-03-05' });
  return { home, far, tomato, pea, p, q, tray1, tray2 };
}

describe('year summary', () => {
  it('the summary adds up each crop and place for the year, counting trays under their crop', async () => {
    const s = await setup();
    await post('/api/harvests', { planting_id: s.p.id, harvested_on: '2027-07-01', quantity: 5, unit: 'kg', larder_qty: 2, sold_qty: 1, sold_price: 6 });
    await post('/api/harvests', { planting_id: s.q.id, harvested_on: '2027-07-02', quantity: 3, unit: 'kg', given_qty: 1 });
    await post('/api/harvests', { tray_id: s.tray1.id, harvested_on: '2027-03-11', quantity: 0.25, unit: 'kg' });
    await post('/api/harvests', { tray_id: s.tray2.id, harvested_on: '2027-03-15', quantity: 0.25, unit: 'kg' });
    const sum = (await t.http().get('/api/summary?year=2027')).body;
    const tomato = sum.by_crop.find(c => c.plant_id === s.tomato.id);
    expect(tomato).toMatchObject({ name: 'Test tomato', totals: { kg: 8 }, larder: { kg: 2 }, sold: { kg: 1 }, given: { kg: 1 }, kept: { kg: 4 }, income: 6 });
    expect(sum.by_crop.find(c => c.plant_id === s.pea.id).totals.kg).toBeCloseTo(0.5);
    expect(sum.by_crop.map(c => c.name)).toEqual(['Test tomato', 'Pea shoots']);
    expect(sum.by_place.map(p => [p.name, p.kg])).toEqual([['Springfield', 5.5], ['Shelbyville', 3]]);
    expect(sum.totals).toMatchObject({ kg: 8.5, income: 6 });
    const home = (await t.http().get(`/api/summary?year=2027&place_id=${s.home.id}`)).body;
    expect(home.totals.kg).toBeCloseTo(5.5);
  });

  it('December 31 counts in its own year', async () => {
    const s = await setup();
    await post('/api/harvests', { planting_id: s.p.id, harvested_on: '2026-12-31', quantity: 2, unit: 'kg' });
    await post('/api/harvests', { planting_id: s.p.id, harvested_on: '2027-01-01', quantity: 1, unit: 'kg' });
    expect((await t.http().get('/api/summary?year=2026')).body.totals.kg).toBe(2);
    expect((await t.http().get('/api/summary?year=2027')).body.totals.kg).toBe(1);
  });

  it('income adds only sold prices, and counts stay apart from weights', async () => {
    const s = await setup();
    await post('/api/harvests', { planting_id: s.p.id, harvested_on: '2027-07-01', quantity: 12, unit: 'count', sold_qty: 6, sold_price: 9 });
    await post('/api/harvests', { planting_id: s.p.id, harvested_on: '2027-07-03', quantity: 2, unit: 'kg', given_qty: 2 });
    const sum = (await t.http().get('/api/summary?year=2027')).body;
    expect(sum.totals).toMatchObject({ kg: 2, count: 12, bunch: 0, income: 9 });
    expect((await t.http().get('/api/summary?year=27')).status).toBe(400);
  });
});
