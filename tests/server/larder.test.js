import { describe, it, expect, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';
import { retryPending } from '../../server/services/larder.js';

// A pretend Hearth & Larder: records every request and answers as told.
function fakeLarder() {
  const fake = { calls: [], down: false, status: 200 };
  fake.fetch = async (url, opts = {}) => {
    fake.calls.push({ url, method: opts.method ?? 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (fake.down) throw new TypeError('fetch failed');
    // Hearth & Larder took it, but the reply never came back.
    if (fake.lost) throw new DOMException('The operation timed out.', 'TimeoutError');
    if (fake.hold) await fake.hold;
    return new Response(JSON.stringify({ ok: true }), { status: fake.status });
  };
  return fake;
}

let t;
let fake;
afterEach(() => t?.cleanup());

async function setup({ link = true, units = 'metric' } = {}) {
  fake = fakeLarder();
  t = makeTestContext({ fetch: fake.fetch });
  const put = await t.http().put('/api/settings').send({ units, larder_link: link });
  if (put.status !== 200) throw new Error(JSON.stringify(put.body));
  const place = (await t.http().post('/api/places').send({ name: 'Springfield', time_zone: 'UTC' })).body;
  const bed = (await t.http().post('/api/spaces').send({ place_id: place.id, name: 'North bed', kind: 'bed' })).body;
  const tomato = (await t.http().get('/api/plants')).body.find(p => p.starter_key === 'plant.test-tomato');
  const planting = (await t.http().post('/api/plantings').send({ space_id: bed.id, plant_id: tomato.id, how_started: 'start', start_on: '2027-04-10' })).body;
  return { planting };
}
const idle = () => t.ctx.larder.idle();
const harvest = id => t.ctx.db.prepare('SELECT larder_state, larder_error, larder_sent_at FROM harvests WHERE id = ?').get(id);
async function record(planting, extra = {}) {
  const res = await t.http().post('/api/harvests').send({ planting_id: planting.id, harvested_on: '2027-07-01', quantity: 5, unit: 'kg', larder_qty: 2, ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

describe('Hearth & Larder link', () => {
  it('with the link off nothing is sent and the state is off', async () => {
    const { planting } = await setup({ link: false });
    const h = await record(planting);
    await idle();
    expect(fake.calls).toEqual([]);
    expect(harvest(h.id).larder_state).toBe('off');
  });

  it('a harvest with a larder part is sent once and marked sent', async () => {
    const { planting } = await setup({ units: 'us' });
    const h = await record(planting, { larder_qty: 0.45359237 });
    expect(h.larder_state).toBe('pending');
    await idle();
    expect(fake.calls).toHaveLength(1);
    const [c] = fake.calls;
    expect(c.method).toBe('PUT');
    expect(c.url).toBe(`http://127.0.0.1:4193/api/harvests/external/seed-and-harvest/${h.id}`);
    expect(c.body).toMatchObject({ crop: 'Test tomato', unit: 'lb', harvested_on: '2027-07-01', note: 'From Seed & Harvest: North bed, Springfield' });
    expect(c.body.quantity).toBeCloseTo(1, 6);
    expect(harvest(h.id)).toMatchObject({ larder_state: 'sent', larder_error: null });
    expect(harvest(h.id).larder_sent_at).toBeTruthy();
  });

  it('Hearth & Larder closed marks it failed with a reason, and Send again sends it', async () => {
    const { planting } = await setup();
    fake.down = true;
    const h = await record(planting);
    await idle();
    expect(harvest(h.id).larder_state).toBe('failed');
    expect(harvest(h.id).larder_error).toMatch(/not answering/);
    fake.down = false;
    const res = await t.http().post(`/api/harvests/${h.id}/send`);
    expect(res.status).toBe(200);
    await idle();
    expect(harvest(h.id).larder_state).toBe('sent');
    fake.status = 500;
    await t.http().patch(`/api/harvests/${h.id}`).send({ version: (await t.http().get(`/api/harvests/${h.id}`)).body.version, larder_qty: 3 });
    await idle();
    expect(harvest(h.id)).toMatchObject({ larder_state: 'failed' });
  });

  it('an edit resends and setting the larder part to zero removes it there', async () => {
    const { planting } = await setup();
    const h = await record(planting);
    await idle();
    const v = (await t.http().get(`/api/harvests/${h.id}`)).body.version;
    await t.http().patch(`/api/harvests/${h.id}`).send({ version: v, larder_qty: 3 });
    await idle();
    expect(fake.calls.at(-1)).toMatchObject({ method: 'PUT', body: { quantity: 3, unit: 'kg' } });
    await t.http().patch(`/api/harvests/${h.id}`).send({ version: v + 1, larder_qty: 0 });
    await idle();
    expect(fake.calls.at(-1)).toMatchObject({ method: 'DELETE', url: `http://127.0.0.1:4193/api/harvests/external/seed-and-harvest/${h.id}` });
    expect(harvest(h.id).larder_state).toBe('removed');
  });

  it('deleting a harvest removes it there, restoring sends it again', async () => {
    const { planting } = await setup();
    const h = await record(planting);
    await idle();
    await t.http().delete(`/api/harvests/${h.id}`);
    await idle();
    expect(fake.calls.at(-1).method).toBe('DELETE');
    await t.http().post(`/api/harvests/${h.id}/restore`);
    await idle();
    expect(fake.calls.at(-1).method).toBe('PUT');
    expect(harvest(h.id).larder_state).toBe('sent');
    // A planting going to the Trash takes its harvests out of the larder too.
    await t.http().delete(`/api/plantings/${planting.id}`);
    await idle();
    expect(fake.calls.at(-1).method).toBe('DELETE');
  });

  it('startup retries pending and failed sends', async () => {
    const { planting } = await setup();
    fake.down = true;
    const a = await record(planting);
    const b = await record(planting, { harvested_on: '2027-07-02' });
    await idle();
    t.ctx.db.prepare("UPDATE harvests SET larder_state = 'pending' WHERE id = ?").run(b.id);
    fake.down = false;
    fake.calls = [];
    await retryPending(t.ctx);
    await idle();
    expect(fake.calls.map(c => c.url.split('/').pop()).sort()).toEqual([String(a.id), String(b.id)].sort());
    expect([harvest(a.id).larder_state, harvest(b.id).larder_state]).toEqual(['sent', 'sent']);
  });

  it('the address must be on this computer', async () => {
    await setup();
    const bad = await t.http().put('/api/settings').send({ larder_url: 'http://example.com:4193' });
    expect(bad.status).toBe(400);
    expect(bad.body.detailCodes.larder_url.code).toBe('not_local');
    const ok = await t.http().put('/api/settings').send({ larder_url: 'http://localhost:4300/' });
    expect(ok.status).toBe(200);
    expect(ok.body.larder_url).toBe('http://localhost:4300');
  });

  it('Test says whether Hearth & Larder answered', async () => {
    await setup();
    const up = await t.http().post('/api/settings/larder-test');
    expect(up.body).toEqual({ ok: true });
    expect(fake.calls.at(-1).url).toBe('http://127.0.0.1:4193/api/health');
    fake.down = true;
    const down = await t.http().post('/api/settings/larder-test');
    expect(down.body).toMatchObject({ ok: false, code: 'not_answering' });
    expect(down.body.error).toMatch(/not answering/);
  });

  it('emptying the Trash before Hearth & Larder hears of a delete still removes the copy later', async () => {
    const { planting } = await setup();
    const h = await record(planting);
    await idle();
    fake.down = true;
    await t.http().delete(`/api/harvests/${h.id}`);
    await idle();
    expect(harvest(h.id).larder_state).toBe('failed');
    await t.http().post('/api/trash/empty').expect(200);
    await idle();
    fake.down = false;
    fake.calls = [];
    await retryPending(t.ctx);
    await idle();
    expect(fake.calls).toEqual([expect.objectContaining({ method: 'DELETE', url: `http://127.0.0.1:4193/api/harvests/external/seed-and-harvest/${h.id}` })]);
    fake.calls = [];
    await retryPending(t.ctx);
    await idle();
    expect(fake.calls).toEqual([]);
  });

  it('turning the link on sends the harvests saved while it was off', async () => {
    const { planting } = await setup({ link: false });
    const a = await record(planting);
    await record(planting, { larder_qty: 0, harvested_on: '2027-07-02' });
    await idle();
    expect(fake.calls).toEqual([]);
    await t.http().put('/api/settings').send({ larder_link: true }).expect(200);
    await idle();
    expect(fake.calls.map(c => [c.method, c.url.split('/').pop()])).toEqual([['PUT', String(a.id)]]);
    expect(harvest(a.id).larder_state).toBe('sent');
  });

  it('a send whose reply was lost still gets its removal', async () => {
    const { planting } = await setup();
    fake.lost = true;
    const h = await record(planting);
    await idle();
    expect(harvest(h.id).larder_state).toBe('failed');
    fake.lost = false;
    await t.http().delete(`/api/harvests/${h.id}`);
    await idle();
    expect(fake.calls.at(-1)).toMatchObject({ method: 'DELETE' });
    expect(harvest(h.id).larder_state).toBe('removed');
  });

  it('a lost first send of a harvest emptied from the Trash is removed later', async () => {
    const { planting } = await setup();
    fake.lost = true;
    const h = await record(planting);
    await idle();
    fake.down = true;
    await t.http().delete(`/api/harvests/${h.id}`);
    await idle();
    await t.http().post('/api/trash/empty').expect(200);
    await idle();
    fake.down = false;
    fake.lost = false;
    fake.calls = [];
    await retryPending(t.ctx);
    await idle();
    expect(fake.calls.map(c => c.method)).toEqual(['DELETE']);
  });

  it('a send in flight across a restore is sent again to the restored database', async () => {
    const { planting } = await setup();
    let release;
    fake.hold = new Promise(r => { release = r; });
    const h = await record(planting);
    await new Promise(r => setTimeout(r, 20));
    expect(fake.calls).toHaveLength(1);
    t.ctx.db.close();
    t.ctx.reopen();
    fake.hold = null;
    release();
    await idle();
    await idle();
    expect(fake.calls.length).toBe(2);
    expect(harvest(h.id).larder_state).toBe('sent');
  });
});
