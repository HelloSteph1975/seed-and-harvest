import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTestContext } from './helpers.js';

let t;
beforeEach(() => { t = makeTestContext(); });
afterEach(() => t.cleanup());

const search = async q => (await t.http().get(`/api/search?q=${encodeURIComponent(q)}`));

describe('search', () => {
  it('finds a plant by a word in its summary, ignoring accents and case', async () => {
    await t.http().post('/api/plants').send({ name: 'Jalapeño', kind: 'vegetable', summary: 'Hot PEPPER for salsa.' });
    const res = await search('pepper');
    expect(res.status).toBe(200);
    expect(res.body.groups.plants.items.map(p => p.name)).toEqual(['Jalapeño']);
    expect((await search('JALAPENO')).body.groups.plants.total).toBe(1);
  });

  it('finds a starter plant by its Spanish name when Spanish is on', async () => {
    const dir = path.join(t.dataDir, 'locales', 'es');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ui.json'), JSON.stringify({ _name: 'Español' }));
    fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify({ 'plant.test-tomato.name': 'Jitomate de prueba' }));
    expect((await search('jitomate')).body.groups.plants.total).toBe(0);
    await t.http().put('/api/settings').send({ language: 'es' });
    const res = await search('jitomate');
    expect(res.body.groups.plants.items.map(p => p.starter_key)).toEqual(['plant.test-tomato']);
  });

  it('finds a guide by a word in a step', async () => {
    const res = await search('trays');
    expect(res.body.groups.guides.items.map(g => g.title)).toContain('Fixture: starting seeds');
  });

  it('finds places and spaces', async () => {
    const place = (await t.http().post('/api/places').send({ name: 'Hilltop', notes: 'Windy ridge' })).body;
    await t.http().post('/api/spaces').send({ place_id: place.id, name: 'Ridge bed', kind: 'bed' });
    const res = await search('ridge');
    expect(res.body.groups.places.items.map(p => p.name)).toEqual(['Hilltop']);
    expect(res.body.groups.spaces.items.map(s => s.name)).toEqual(['Ridge bed']);
  });

  it('leaves out things in the Trash', async () => {
    const p = (await t.http().post('/api/plants').send({ name: 'Rhubarb', kind: 'vegetable' })).body;
    await t.http().delete(`/api/plants/${p.id}`);
    expect((await search('rhubarb')).body.groups.plants.total).toBe(0);
  });

  it('a one-letter search is refused', async () => {
    const res = await search('a');
    expect(res.status).toBe(400);
    expect(res.body.detailCodes.q.code).toBe('too_short');
  });

  it('guide results carry the plant starter key so the name can be translated', async () => {
    const res = await search('fixture: starting tomatoes');
    expect(res.body.groups.guides.items[0]).toMatchObject({ plant_name: 'Test tomato', plant_starter_key: 'plant.test-tomato', plant_is_starter: 1 });
  });

  it('search finds a planting by its plant Spanish name and a log entry by its note', async () => {
    const place = (await t.http().post('/api/places').send({ name: 'Springfield', last_frost: '04-01' })).body;
    const space = (await t.http().post('/api/spaces').send({ place_id: place.id, name: 'North bed', kind: 'bed' })).body;
    const tomato = (await t.http().get('/api/plants')).body.find(p => p.starter_key === 'plant.test-tomato');
    const p = (await t.http().post('/api/plantings').send({ space_id: space.id, plant_id: tomato.id, how_started: 'start', start_on: '2027-04-10' })).body;
    await t.http().post(`/api/plantings/${p.id}/log`).send({ on_date: '2027-04-12', kind: 'problem', note: 'Aphids on the new leaves' });
    const dir = path.join(t.dataDir, 'locales', 'es');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ui.json'), JSON.stringify({ _name: 'Español' }));
    fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify({ 'plant.test-tomato.name': 'Jitomate de prueba' }));
    await t.http().put('/api/settings').send({ language: 'es' });
    const res = (await search('jitomate')).body;
    expect(res.groups.plantings.items.map(x => x.id)).toEqual([p.id]);
    expect(res.groups.plantings.items[0]).toMatchObject({ space_name: 'North bed', plant_starter_key: 'plant.test-tomato' });
    expect((await search('aphids')).body.groups.log.items.map(x => x.planting_id)).toEqual([p.id]);
  });

  it('search finds a tray by its crop Spanish name and an animal by name', async () => {
    const place = (await t.http().post('/api/places').send({ name: 'Springfield' })).body;
    const rack = (await t.http().post('/api/spaces').send({ place_id: place.id, name: 'Rack', kind: 'microgreen_rack' })).body;
    const pea = (await t.http().post('/api/plants').send({ name: 'Pea shoots', kind: 'microgreen', days_min: 10 })).body;
    t.ctx.db.prepare("UPDATE plants SET starter_key = 'plant.micro-pea', is_starter = 1 WHERE id = ?").run(pea.id);
    const tray = (await t.http().post('/api/trays').send({ plant_id: pea.id, space_id: rack.id, sown_on: '2027-03-01', notes: 'Extra thick sowing' })).body;
    await t.http().post('/api/animals').send({ name: 'Nanny goats', kind: 'goat' });
    const dir = path.join(t.dataDir, 'locales', 'es');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ui.json'), JSON.stringify({ _name: 'Español' }));
    fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify({ 'plant.micro-pea.name': 'Brotes de chícharo' }));
    await t.http().put('/api/settings').send({ language: 'es' });
    expect((await search('chicharo')).body.groups.trays.items.map(x => x.id)).toEqual([tray.id]);
    expect((await search('thick')).body.groups.trays.items.map(x => x.id)).toEqual([tray.id]);
    expect((await search('nanny')).body.groups.animals.items.map(x => x.name)).toEqual(['Nanny goats']);
  });

  it('search finds a planting by where it was bought', async () => {
    const place = (await t.http().post('/api/places').send({ name: 'Springfield' })).body;
    const pot = (await t.http().post('/api/spaces').send({ place_id: place.id, name: 'Pot', kind: 'container' })).body;
    const fig = (await t.http().post('/api/plants').send({ name: 'Fig', kind: 'fruit_tree', perennial: true })).body;
    const p = (await t.http().post('/api/plantings').send({ space_id: pot.id, plant_id: fig.id, how_started: 'mature', start_on: '2027-03-01', bought_from: 'Valley Nursery' })).body;
    expect((await search('valley nursery')).body.groups.plantings.items.map(x => x.id)).toEqual([p.id]);
  });

  it('search finds a harvest by buyer', async () => {
    const place = (await t.http().post('/api/places').send({ name: 'Springfield' })).body;
    const bed = (await t.http().post('/api/spaces').send({ place_id: place.id, name: 'Bed', kind: 'bed' })).body;
    const pea = (await t.http().post('/api/plants').send({ name: 'Snap pea', kind: 'vegetable', yield_kg: 1, yield_per: 'meter' })).body;
    const p = (await t.http().post('/api/plantings').send({ space_id: bed.id, plant_id: pea.id, how_started: 'seed_outdoors', start_on: '2027-03-01' })).body;
    const h = (await t.http().post('/api/harvests').send({ planting_id: p.id, harvested_on: '2027-05-01', quantity: 3, unit: 'kg', sold_qty: 1, sold_price: 5, sold_to: 'Corner Market' })).body;
    await t.http().post('/api/harvests').send({ planting_id: p.id, harvested_on: '2027-05-02', quantity: 1, unit: 'kg', given_qty: 1, given_to: 'Neighbors', notes: 'Sweet' });
    const g = (await t.http().post('/api/goals').send({ year: 2028, plant_id: pea.id, goal_kind: 'raw', amount: 5, unit: 'kg', notes: 'For the freezer' })).body;
    const found = (await search('corner market')).body.groups.harvests;
    expect(found.items).toEqual([expect.objectContaining({ id: h.id, plant_name: 'Snap pea', planting_id: p.id, harvested_on: '2027-05-01' })]);
    expect((await search('neighbors')).body.groups.harvests.total).toBe(1);
    expect((await search('snap pea')).body.groups.goals.items).toEqual([expect.objectContaining({ id: g.id, year: 2028, plant_name: 'Snap pea' })]);
    expect((await search('freezer')).body.groups.goals.total).toBe(1);
  });
});
