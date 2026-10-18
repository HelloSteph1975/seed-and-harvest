import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';

let t;
let plant;
beforeEach(async () => {
  t = makeTestContext();
  plant = (await t.http().post('/api/plants').send({ name: 'Tomato', kind: 'vegetable' })).body;
});
afterEach(() => t.cleanup());

const add = async body => {
  const res = await t.http().post('/api/guides').send(body);
  if (res.status !== 201) throw new Error(`add failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};
const BASICS = {
  title: 'Starting seeds indoors', summary: 'Give seeds a head start.', stage: 'start_indoors',
  steps: ['Fill trays with damp seed-starting mix.', 'Sow seeds at the depth on the packet.', 'Keep warm until they sprout.'],
  supplies: [{ name: 'Seed trays', amount: '1 per 72 seedlings' }, { name: 'Seed-starting mix' }],
};

describe('guides', () => {
  it('a basics guide saves with steps and supplies in order', async () => {
    const g = await add(BASICS);
    expect(g).toMatchObject({ title: 'Starting seeds indoors', plant_id: null, stage: 'start_indoors', version: 1 });
    expect(g.steps).toEqual(BASICS.steps);
    expect(g.supplies).toEqual([{ name: 'Seed trays', amount: '1 per 72 seedlings' }, { name: 'Seed-starting mix', amount: null }]);
    expect((await t.http().get('/api/guides')).body.map(x => x.title)).toContain('Starting seeds indoors');
  });

  it('a plant guide links to a basics guide', async () => {
    const basics = await add(BASICS);
    const g = await add({ title: 'Starting tomatoes', stage: 'start_indoors', plant_id: plant.id, basics_id: basics.id, steps: ['Sow 6 mm deep.'] });
    const full = (await t.http().get(`/api/guides/${g.id}`)).body;
    expect(full.plant).toMatchObject({ id: plant.id, name: 'Tomato' });
    expect(full.basics).toMatchObject({ id: basics.id, title: 'Starting seeds indoors', live: true });
    expect((await t.http().get(`/api/plants/${plant.id}`)).body.guides.map(x => x.title)).toEqual(['Starting tomatoes']);
  });

  it('a link to a plant guide or to itself is refused', async () => {
    const pg = await add({ title: 'Starting tomatoes', stage: 'start_indoors', plant_id: plant.id, steps: ['Sow.'] });
    const res = await t.http().post('/api/guides').send({ title: 'X', stage: 'care', plant_id: plant.id, basics_id: pg.id, steps: ['a'] });
    expect(res.status).toBe(400);
    expect(res.body.detailCodes.basics_id.code).toBe('not_basics');
    const basics = await add(BASICS);
    const self = await t.http().patch(`/api/guides/${basics.id}`).send({ version: 1, basics_id: basics.id });
    expect(self.status).toBe(400);
  });

  it('steps over the limit are refused', async () => {
    const res = await t.http().post('/api/guides').send({ ...BASICS, steps: Array.from({ length: 41 }, (_, i) => `Step ${i}`) });
    expect(res.status).toBe(400);
    expect(res.body.detailCodes.steps.code).toBe('too_many');
  });

  it('a guide needs at least one step', async () => {
    const res = await t.http().post('/api/guides').send({ title: 'Empty', stage: 'care', steps: [] });
    expect(res.status).toBe(400);
  });

  it('a basics guide in the Trash shows as not live on linked guides, and purging it clears the link', async () => {
    const basics = await add(BASICS);
    const g = await add({ title: 'Starting tomatoes', stage: 'start_indoors', plant_id: plant.id, basics_id: basics.id, steps: ['Sow.'] });
    await t.http().delete(`/api/guides/${basics.id}`);
    expect((await t.http().get(`/api/guides/${g.id}`)).body.basics).toMatchObject({ id: basics.id, title: 'Starting seeds indoors', live: false });
    await t.http().delete(`/api/trash/guide/${basics.id}`);
    expect((await t.http().get(`/api/guides/${g.id}`)).body).toMatchObject({ basics_id: null, basics: null });
  });

  it('restoring a plant guide whose plant is in the Trash says to restore the plant first', async () => {
    const g = await add({ title: 'Starting tomatoes', stage: 'start_indoors', plant_id: plant.id, steps: ['Sow.'] });
    await t.http().delete(`/api/guides/${g.id}`);
    await t.http().delete(`/api/plants/${plant.id}`);
    const res = await t.http().post(`/api/trash/guide/${g.id}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('parent_in_trash');
  });

  it('steps and supplies are replaced whole on save', async () => {
    const g = await add(BASICS);
    const res = await t.http().patch(`/api/guides/${g.id}`).send({ version: 1, steps: ['Only step'], supplies: [] });
    expect(res.body).toMatchObject({ steps: ['Only step'], supplies: [] });
  });

  it('stale save gets 409', async () => {
    const g = await add(BASICS);
    await t.http().patch(`/api/guides/${g.id}`).send({ version: 1, title: 'A' });
    expect((await t.http().patch(`/api/guides/${g.id}`).send({ version: 1, title: 'B' })).status).toBe(409);
  });

  it('a guide page carries the plant starter key so its name can be translated', async () => {
    const tomato = (await t.http().get('/api/plants')).body.find(p => p.starter_key === 'plant.test-tomato');
    const gid = (await t.http().get(`/api/plants/${tomato.id}`)).body.guides[0].id;
    expect((await t.http().get(`/api/guides/${gid}`)).body.plant).toMatchObject({ name: 'Test tomato', starter_key: 'plant.test-tomato', is_starter: 1 });
  });

  it('a conflict hands back the whole guide, steps and supplies included', async () => {
    const g = await add(BASICS);
    await t.http().patch(`/api/guides/${g.id}`).send({ version: 1, title: 'A' });
    const res = await t.http().patch(`/api/guides/${g.id}`).send({ version: 1, title: 'B' });
    expect(res.status).toBe(409);
    expect(res.body.current).toMatchObject({ title: 'A', steps: BASICS.steps });
    expect(res.body.current.supplies).toHaveLength(2);
  });

  it('a basics guide other guides build on cannot be turned into a plant guide', async () => {
    const basics = await add(BASICS);
    await add({ title: 'Starting tomatoes', stage: 'start_indoors', plant_id: plant.id, basics_id: basics.id, steps: ['Sow.'] });
    const res = await t.http().patch(`/api/guides/${basics.id}`).send({ version: 1, plant_id: plant.id });
    expect(res.status).toBe(400);
    expect(res.body.detailCodes.plant_id.code).toBe('has_links');
  });
});
