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
});
