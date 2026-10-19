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
async function plant(extra) {
  return post('/api/plants', { name: 'Paste tomato', kind: 'vegetable', yield_kg: 4.5, yield_per: 'plant', preserves: [{ form: 'Sauce', unit: 'quart', raw_kg: 4.5 }], ...extra });
}

describe('pantry goals', () => {
  it('goals list in order with their suggestions; stale save 409', async () => {
    const p = await plant();
    const bean = await plant({ name: 'Bush bean', yield_kg: 1.5, yield_per: 'meter', preserves: [] });
    const a = await post('/api/goals', { year: 2027, plant_id: p.id, goal_kind: 'preserve', amount: 24, preserve_position: 1 });
    const b = await post('/api/goals', { year: 2027, plant_id: bean.id, goal_kind: 'raw', amount: 6, unit: 'kg' });
    await post('/api/goals', { year: 2028, plant_id: bean.id, goal_kind: 'raw', amount: 1, unit: 'kg' });
    let list = (await t.http().get('/api/goals?year=2027')).body;
    expect(list.map(g => g.id)).toEqual([a.id, b.id]);
    expect(list[0]).toMatchObject({ plant: { name: 'Paste tomato' }, preserve: { form: 'Sauce', unit: 'quart' }, suggestion: { per: 'plant', amount: 24 } });
    expect(list[1].suggestion).toMatchObject({ per: 'meter', amount: 4 });
    const moved = await post('/api/goals/reorder?year=2027', { items: [{ id: b.id, version: b.version }, { id: a.id, version: a.version }] }, 200);
    expect(moved.map(g => g.id)).toEqual([b.id, a.id]);
    const stale = await t.http().patch(`/api/goals/${a.id}`).send({ version: a.version, amount: 30 });
    expect(stale.status).toBe(409);
    expect(stale.body.current).toMatchObject({ id: a.id, amount: 24 });
    const bad = await t.http().post('/api/goals').send({ year: 2027, plant_id: p.id, goal_kind: 'preserve', amount: 3 });
    expect(bad.status).toBe(400);
    expect(bad.body.details.preserve_position).toBeTruthy();
    expect((await t.http().get('/api/goals')).status).toBe(400);
    list = (await t.http().get('/api/goals?year=2027')).body;
    expect(list).toHaveLength(2);
  });

  it("last year's harvests from plantings with a known count set the yield", async () => {
    const p = await plant();
    const place = await post('/api/places', { name: 'Springfield', time_zone: 'UTC' });
    const bed = await post('/api/spaces', { place_id: place.id, name: 'Bed', kind: 'bed' });
    const counted = await post('/api/plantings', { space_id: bed.id, plant_id: p.id, how_started: 'start', start_on: '2026-04-10', count: 4 });
    const unknown = await post('/api/plantings', { space_id: bed.id, plant_id: p.id, how_started: 'start', start_on: '2026-04-10' });
    await post('/api/harvests', { planting_id: counted.id, harvested_on: '2026-08-01', quantity: 20, unit: 'kg' });
    await post('/api/harvests', { planting_id: unknown.id, harvested_on: '2026-08-01', quantity: 50, unit: 'kg' });
    await post('/api/goals', { year: 2027, plant_id: p.id, goal_kind: 'raw', amount: 50, unit: 'kg' });
    const [g] = (await t.http().get('/api/goals?year=2027')).body;
    expect(g.suggestion).toMatchObject({ amount: 10, source: 'last_year', yields: { last_year: { per: 'plant', amount: 5 } } });
  });

  it('a goal goes to the Trash and back, and goes with its plant', async () => {
    const p = await plant();
    const g = await post('/api/goals', { year: 2027, plant_id: p.id, goal_kind: 'raw', amount: 5, unit: 'kg' });
    await t.http().delete(`/api/goals/${g.id}`).expect(200);
    expect((await t.http().get('/api/goals?year=2027')).body).toEqual([]);
    await post(`/api/goals/${g.id}/restore`, {}, 200);
    await t.http().delete(`/api/plants/${p.id}`).expect(200);
    expect((await t.http().get('/api/goals?year=2027')).body).toEqual([]);
    await post(`/api/trash/plant/${p.id}/restore`, {}, 200);
    expect((await t.http().get('/api/goals?year=2027')).body).toHaveLength(1);
    await t.http().delete(`/api/plants/${p.id}`).expect(200);
    await post('/api/trash/empty', {}, 200);
    expect(t.ctx.db.prepare('SELECT COUNT(*) n FROM pantry_goals').get().n).toBe(0);
  });
});

describe('to buy', () => {
  async function garden() {
    const place = await post('/api/places', { name: 'Springfield', time_zone: 'UTC', last_frost: '04-01', first_frost: '10-30' });
    const far = await post('/api/places', { name: 'Shelbyville', time_zone: 'UTC' });
    const bed = await post('/api/spaces', { place_id: place.id, name: 'North bed', kind: 'bed' });
    const box = await post('/api/spaces', { place_id: place.id, name: 'Box', kind: 'bed' });
    const farBed = await post('/api/spaces', { place_id: far.id, name: 'Far bed', kind: 'bed' });
    const tomato = (await t.http().get('/api/plants')).body.find(p => p.starter_key === 'plant.test-tomato');
    const roma = await post(`/api/plants/${tomato.id}/varieties`, { name: 'Roma' });
    return { place, far, bed, box, farBed, tomato, roma };
  }
  const planting = (g, extra) => post('/api/plantings', { plant_id: g.tomato.id, start_on: '2027-03-01', status: 'planned', ...extra });

  it("to buy lists seeds and plants from next year's planned plantings, grouped by plant and variety", async () => {
    const g = await garden();
    await planting(g, { space_id: g.bed.id, how_started: 'seed_outdoors', count: 6, variety_id: g.roma.id });
    await planting(g, { space_id: g.box.id, how_started: 'seed_outdoors', count: 4, row_m: 2, variety_id: g.roma.id });
    await planting(g, { space_id: g.bed.id, how_started: 'seed_outdoors', count: 2 });
    await planting(g, { space_id: g.bed.id, how_started: 'start', count: 3 });
    await planting(g, { space_id: g.bed.id, how_started: 'start', count: 5, start_on: '2026-05-01' });
    await planting(g, { space_id: g.bed.id, how_started: 'start', count: 7, status: 'growing' });
    await planting(g, { space_id: g.farBed.id, how_started: 'start', count: 9 });
    const out = (await t.http().get(`/api/plan/to-buy?year=2027&place_id=${g.place.id}`)).body;
    expect(out.seeds).toEqual([
      expect.objectContaining({ plant: expect.objectContaining({ name: 'Test tomato' }), variety: null, count: 2, row_m: null, spaces: ['North bed'] }),
      expect.objectContaining({ variety: { id: g.roma.id, name: 'Roma' }, count: 10, row_m: 2, spaces: ['Box', 'North bed'] }),
    ]);
    expect(out.plants).toEqual([expect.objectContaining({ variety: null, count: 3, spaces: ['North bed'] })]);
    expect((await t.http().get('/api/plan/to-buy?year=2027')).status).toBe(400);
  });

  it("supplies for the year come from those plantings' guides", async () => {
    const g = await garden();
    await post('/api/guides', { plant_id: g.tomato.id, stage: 'sow_outdoors', title: 'Sowing tomatoes', steps: ['Sow.'], supplies: [{ name: 'Row cover', amount: '1 roll' }] });
    await planting(g, { space_id: g.bed.id, how_started: 'seed_outdoors', count: 6 });
    const out = (await t.http().get(`/api/plan/to-buy?year=2027&place_id=${g.place.id}`)).body;
    expect(out.supplies.map(s => s.name)).toContain('Row cover');
  });
});
