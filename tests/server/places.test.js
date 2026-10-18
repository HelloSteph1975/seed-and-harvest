import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';

let t;
beforeEach(() => { t = makeTestContext(); });
afterEach(() => t.cleanup());

const add = async body => {
  const res = await t.http().post('/api/places').send(body);
  if (res.status !== 201) throw new Error(`add failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};
const get = async id => (await t.http().get(`/api/places/${id}`)).body;

describe('places', () => {
  it('the first place is current when no status is sent', async () => {
    expect((await add({ name: 'Home' })).status).toBe('current');
    expect((await add({ name: 'Later' })).status).toBe('future');
  });

  it('saving a place as current makes the old current place past', async () => {
    const home = await add({ name: 'Home' });
    const later = await add({ name: 'Later' });
    const res = await t.http().patch(`/api/places/${later.id}`).send({ version: later.version, status: 'current' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('current');
    const old = await get(home.id);
    expect(old.status).toBe('past');
    expect(old.version).toBe(home.version + 1);
  });

  it('a new place sent as current takes over from the old one', async () => {
    const home = await add({ name: 'Home' });
    expect((await add({ name: 'New home', status: 'current' })).status).toBe('current');
    expect((await get(home.id)).status).toBe('past');
  });

  it('frost dates in the wrong order are refused in the north', async () => {
    const res = await t.http().post('/api/places').send({ name: 'X', hemisphere: 'north', last_frost: '11-15', first_frost: '03-15' });
    expect(res.status).toBe(400);
    expect(res.body.details.first_frost).toBeTruthy();
    expect(res.body.detailCodes.first_frost.code).toBe('frost_order');
  });

  it('southern frost dates are accepted', async () => {
    const res = await t.http().post('/api/places').send({ name: 'South', hemisphere: 'south', last_frost: '09-20', first_frost: '05-10' });
    expect(res.status).toBe(201);
  });

  it('northern-order dates are refused in the south', async () => {
    const res = await t.http().post('/api/places').send({ name: 'South', hemisphere: 'south', last_frost: '03-15', first_frost: '11-15' });
    expect(res.status).toBe(400);
  });

  it('the frost order is checked against the stored dates on a partial save', async () => {
    const p = await add({ name: 'X', last_frost: '03-20', first_frost: '11-10' });
    const res = await t.http().patch(`/api/places/${p.id}`).send({ version: p.version, first_frost: '02-01' });
    expect(res.status).toBe(400);
  });

  it('frost-free places clear their frost dates', async () => {
    const p = await add({ name: 'Warm', frost_free: true, last_frost: '03-01', first_frost: '11-01' });
    expect(p).toMatchObject({ frost_free: 1, last_frost: null, first_frost: null });
  });

  it('only one frost date is fine', async () => {
    expect((await add({ name: 'Half', last_frost: '03-20' })).last_frost).toBe('03-20');
  });

  it('wet months come back as a sorted list', async () => {
    const p = await add({ name: 'Rainy', frost_free: true, wet_months: [10, 6, 6, 7] });
    expect(p.wet_months).toEqual([6, 7, 10]);
    expect((await get(p.id)).wet_months).toEqual([6, 7, 10]);
    expect((await t.http().get('/api/places')).body[0].wet_months).toEqual([6, 7, 10]);
  });

  it('bad wet months are refused', async () => {
    expect((await t.http().post('/api/places').send({ name: 'X', wet_months: [0] })).status).toBe(400);
    expect((await t.http().post('/api/places').send({ name: 'X', wet_months: [13] })).status).toBe(400);
    expect((await t.http().post('/api/places').send({ name: 'X', wet_months: 'june' })).status).toBe(400);
  });

  it('a bad zone is refused', async () => {
    expect((await t.http().post('/api/places').send({ name: 'X', zone: '14a' })).status).toBe(400);
    expect((await t.http().post('/api/places').send({ name: 'X', zone: '7c' })).status).toBe(400);
    expect((await t.http().post('/api/places').send({ name: 'X', zone: '7b' })).status).toBe(201);
  });

  it('a bad time zone is refused', async () => {
    expect((await t.http().post('/api/places').send({ name: 'X', time_zone: 'Mars/Base' })).status).toBe(400);
    expect((await t.http().post('/api/places').send({ name: 'X', time_zone: 'America/Chicago' })).status).toBe(201);
  });

  it('stale save gets 409 with the current place', async () => {
    const p = await add({ name: 'A' });
    await t.http().patch(`/api/places/${p.id}`).send({ version: p.version, name: 'B' });
    const res = await t.http().patch(`/api/places/${p.id}`).send({ version: p.version, name: 'C' });
    expect(res.status).toBe(409);
    expect(res.body.current).toMatchObject({ name: 'B' });
  });


  it('restoring a current place while another is current brings it back as past', async () => {
    const home = await add({ name: 'Home' });
    await t.http().delete(`/api/places/${home.id}`);
    await add({ name: 'New home', status: 'current' });
    const res = await t.http().post(`/api/trash/place/${home.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('past');
    const current = (await t.http().get('/api/places')).body.filter(p => p.status === 'current');
    expect(current.map(p => p.name)).toEqual(['New home']);
  });

  it('restoring a current place with no other current place keeps it current', async () => {
    const home = await add({ name: 'Home' });
    await t.http().delete(`/api/places/${home.id}`);
    expect((await t.http().post(`/api/places/${home.id}/restore`)).body.status).toBe('current');
  });

  it('deleting the current place leaves no current place', async () => {
    const home = await add({ name: 'Home' });
    await add({ name: 'Later' });
    await t.http().delete(`/api/places/${home.id}`);
    expect((await t.http().get('/api/places')).body.some(p => p.status === 'current')).toBe(false);
  });

  it('a new place after the current one was deleted becomes current', async () => {
    const home = await add({ name: 'Home' });
    await t.http().delete(`/api/places/${home.id}`);
    expect((await add({ name: 'Next' })).status).toBe('current');
  });
});
