import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';
import { seedStarter } from '../../server/services/starter.js';

let t;
beforeEach(() => { t = makeTestContext(); });
afterEach(() => t.cleanup());

const add = async body => {
  const res = await t.http().post('/api/plants').send(body);
  if (res.status !== 201) throw new Error(`add failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};
const TOMATO = {
  name: 'Tomato', latin_name: 'Solanum lycopersicum', kind: 'vegetable', family: 'Nightshade', summary: 'Sweet fruit for sauce.',
  sun: 'full', water: 'medium', spacing_cm: 60, container_liters: 38, container_ok: true,
  start_indoors_min: 6, start_indoors_max: 8, transplant_min: 1, transplant_max: 2,
  frost_free_months: [9, 2, 3], days_min: 60, days_max: 85, yield_kg: 4.5, yield_per: 'plant',
  companions: ['plant.basil', 'Marigold'], avoid: ['plant.fennel'],
  preserves: [{ form: 'Quart of sauce', unit: 'quart', raw_kg: 4.5 }, { form: 'Pint of salsa', unit: 'pint', raw_kg: 1.2 }],
};

describe('plants', () => {
  it('a plant saves with its timing and comes back with lists parsed', async () => {
    const p = await add(TOMATO);
    expect(p).toMatchObject({ name: 'Tomato', kind: 'vegetable', container_ok: 1, start_indoors_min: 6, transplant_max: 2,
      frost_free_months: [2, 3, 9], companions: ['plant.basil', 'Marigold'], avoid: ['plant.fennel'], version: 1 });
    const full = (await t.http().get(`/api/plants/${p.id}`)).body;
    expect(full.preserves).toEqual([{ form: 'Quart of sauce', unit: 'quart', raw_kg: 4.5 }, { form: 'Pint of salsa', unit: 'pint', raw_kg: 1.2 }]);
    expect(full.varieties).toEqual([]);
    expect(full.guides).toEqual([]);
  });

  it('min after max is refused', async () => {
    const res = await t.http().post('/api/plants').send({ name: 'X', kind: 'vegetable', start_indoors_min: 8, start_indoors_max: 6 });
    expect(res.status).toBe(400);
    expect(res.body.detailCodes.start_indoors_max.code).toBe('range_order');
    const zones = await t.http().post('/api/plants').send({ name: 'X', kind: 'fruit_tree', zone_min: 9, zone_max: 5 });
    expect(zones.body.detailCodes.zone_max.code).toBe('range_order');
  });

  it('min after max is caught against stored values on a partial save', async () => {
    const p = await add({ name: 'X', kind: 'vegetable', days_min: 50, days_max: 60 });
    const res = await t.http().patch(`/api/plants/${p.id}`).send({ version: 1, days_min: 70 });
    expect(res.status).toBe(400);
  });

  it('microgreen fields are cleared for other kinds', async () => {
    const p = await add({ name: 'X', kind: 'vegetable', soak_hours: 8, seed_g_per_tray: 20, safety_goats: 'safe' });
    expect(p).toMatchObject({ soak_hours: null, seed_g_per_tray: null, safety_goats: null });
    const m = await add({ name: 'Pea shoots', kind: 'microgreen', soak_hours: 8, seed_g_per_tray: 200, safety_goats: 'safe', safety_chickens: 'small' });
    expect(m).toMatchObject({ soak_hours: 8, seed_g_per_tray: 200, safety_goats: 'safe', safety_chickens: 'small' });
  });

  it('preserves are replaced whole and come back in order', async () => {
    const p = await add(TOMATO);
    await t.http().patch(`/api/plants/${p.id}`).send({ version: 1, preserves: [{ form: 'Quart of juice', unit: 'quart', raw_kg: 3 }] });
    expect((await t.http().get(`/api/plants/${p.id}`)).body.preserves).toEqual([{ form: 'Quart of juice', unit: 'quart', raw_kg: 3 }]);
    const bad = await t.http().patch(`/api/plants/${p.id}`).send({ version: 2, preserves: [{ form: '', unit: 'quart', raw_kg: -1 }] });
    expect(bad.status).toBe(400);
  });

  it('list filters by kind and by words in name, latin name or summary', async () => {
    await add(TOMATO);
    await add({ name: 'Basil', kind: 'herb', summary: 'Pesto leaves.' });
    const herbs = (await t.http().get('/api/plants?kind=herb')).body;
    expect(herbs.map(p => p.name)).toContain('Basil');
    expect(herbs.every(p => p.kind === 'herb')).toBe(true);
    expect((await t.http().get('/api/plants?q=solanum')).body.map(p => p.name)).toEqual(['Test tomato', 'Tomato']);
    expect((await t.http().get('/api/plants?q=pesto')).body.map(p => p.name)).toEqual(['Basil']);
  });

  it('stale save gets 409', async () => {
    const p = await add({ name: 'X', kind: 'herb' });
    await t.http().patch(`/api/plants/${p.id}`).send({ version: 1, name: 'Y' });
    expect((await t.http().patch(`/api/plants/${p.id}`).send({ version: 1, name: 'Z' })).status).toBe(409);
  });
});

describe('varieties', () => {
  it('adds, edits and lists varieties on the plant', async () => {
    const p = await add(TOMATO);
    const v = (await t.http().post(`/api/plants/${p.id}/varieties`).send({ name: 'Roma', days: 75, notes: 'Paste tomato' })).body;
    expect(v).toMatchObject({ plant_id: p.id, name: 'Roma', days: 75, version: 1 });
    await t.http().patch(`/api/varieties/${v.id}`).send({ version: 1, notes: 'Best for sauce' });
    expect((await t.http().get(`/api/plants/${p.id}`)).body.varieties.map(x => x.notes)).toEqual(['Best for sauce']);
  });

  it("a variety can't be restored while its plant is in the Trash", async () => {
    const p = await add(TOMATO);
    const v = (await t.http().post(`/api/plants/${p.id}/varieties`).send({ name: 'Roma' })).body;
    await t.http().delete(`/api/varieties/${v.id}`);
    await t.http().delete(`/api/plants/${p.id}`);
    const res = await t.http().post(`/api/trash/variety/${v.id}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('parent_in_trash');
  });
});

describe('plants in the Trash', () => {
  it('deleting a plant takes its varieties and guides to the Trash and restore brings them back', async () => {
    const p = await add(TOMATO);
    await t.http().post(`/api/plants/${p.id}/varieties`).send({ name: 'Roma' });
    await t.http().post('/api/guides').send({ title: 'Start tomatoes', stage: 'start_indoors', plant_id: p.id, steps: ['Sow'] });
    await t.http().delete(`/api/plants/${p.id}`);
    const trash = (await t.http().get('/api/trash')).body;
    expect(trash.map(i => i.type)).toEqual(['plant']);
    expect(trash[0].extra).toBe(2);
    await t.http().post(`/api/trash/plant/${p.id}/restore`);
    const full = (await t.http().get(`/api/plants/${p.id}`)).body;
    expect(full.varieties).toHaveLength(1);
    expect(full.guides).toHaveLength(1);
  });

  it('emptying the Trash removes a plant with its children', async () => {
    const p = await add(TOMATO);
    await t.http().post(`/api/plants/${p.id}/varieties`).send({ name: 'Roma' });
    await t.http().post('/api/guides').send({ title: 'Start tomatoes', stage: 'start_indoors', plant_id: p.id, steps: ['Sow'] });
    await t.http().delete(`/api/plants/${p.id}`);
    expect((await t.http().post('/api/trash/empty')).status).toBe(200);
    expect(t.ctx.db.prepare('SELECT count(*) n FROM plants WHERE id = ?').get(p.id).n).toBe(0);
    for (const table of ['plant_varieties', 'guides', 'plant_preserves']) {
      expect(t.ctx.db.prepare(`SELECT count(*) n FROM ${table} WHERE plant_id = ?`).get(p.id).n).toBe(0);
    }
    expect(t.ctx.db.prepare('SELECT count(*) n FROM guide_steps WHERE guide_id NOT IN (SELECT id FROM guides)').get().n).toBe(0);
  });
});

describe('starter plants', () => {
  it('editing a starter plant drops the Starter tag, a no-change save keeps it', async () => {
    const p = (await t.http().get('/api/plants')).body.find(x => x.starter_key === 'plant.test-tomato');
    const full = (await t.http().get(`/api/plants/${p.id}`)).body;
    const same = await t.http().patch(`/api/plants/${p.id}`).send({ version: full.version, name: full.name });
    expect(same.body.is_starter).toBe(1);
    const changed = await t.http().patch(`/api/plants/${p.id}`).send({ version: same.body.version, summary: 'Mine now' });
    expect(changed.body.is_starter).toBe(0);
  });

  it('deleting a starter plant forever keeps it from being seeded again', async () => {
    const p = (await t.http().get('/api/plants')).body.find(x => x.starter_key === 'plant.test-tomato');
    await t.http().delete(`/api/plants/${p.id}`);
    await t.http().delete(`/api/trash/plant/${p.id}`);
    seedStarter(t.ctx.db, { content: t.ctx.config.contentDir });
    expect((await t.http().get('/api/plants')).body.map(x => x.starter_key)).not.toContain('plant.test-tomato');
  });

  it('a conflict hands back the whole plant, preserving amounts included', async () => {
    const p = await add(TOMATO);
    await t.http().patch(`/api/plants/${p.id}`).send({ version: 1, name: 'A' });
    const res = await t.http().patch(`/api/plants/${p.id}`).send({ version: 1, name: 'B' });
    expect(res.status).toBe(409);
    expect(res.body.current.preserves).toHaveLength(2);
  });
});
