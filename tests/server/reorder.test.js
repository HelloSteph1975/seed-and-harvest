import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';

let t;
let list;
beforeEach(async () => {
  t = makeTestContext();
  for (const name of ['Alpha', 'Bravo', 'Charlie']) await t.http().post('/api/places').send({ name });
  list = (await t.http().get('/api/places')).body;
});
afterEach(() => t.cleanup());
const items = rows => rows.map(r => ({ id: r.id, version: r.version }));

describe('POST /api/places/reorder', () => {
  it('saves a new order and bumps versions', async () => {
    const res = await t.http().post('/api/places/reorder').send({ items: items([list[2], list[0], list[1]]) });
    expect(res.body.map(r => r.name)).toEqual(['Charlie', 'Alpha', 'Bravo']);
    expect(res.body.every(r => r.version > 1)).toBe(true);
  });
  it('refuses a stale version', async () => {
    await t.http().patch(`/api/places/${list[0].id}`).send({ version: list[0].version, notes: 'x' });
    const res = await t.http().post('/api/places/reorder').send({ items: items(list).reverse() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('reorder_conflict');
    expect((await t.http().get('/api/places')).body.map(r => r.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });
  it('refuses a list that is missing a row or has an extra one', async () => {
    expect((await t.http().post('/api/places/reorder').send({ items: items(list.slice(1)) })).body.code).toBe('reorder_conflict');
    await t.http().post('/api/places').send({ name: 'New' });
    expect((await t.http().post('/api/places/reorder').send({ items: items(list) })).body.code).toBe('reorder_conflict');
  });
  it('rejects bad input', async () => {
    expect((await t.http().post('/api/places/reorder').send({ items: 'x' })).status).toBe(400);
  });
});
