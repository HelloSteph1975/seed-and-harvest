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
const patch = (url, body) => t.http().patch(url).send(body);
const plantByKey = async key => (await t.http().get('/api/plants')).body.find(p => p.starter_key === key);
async function setup() {
  const place = await post('/api/places', { name: 'Springfield', last_frost: '04-01', first_frost: '10-30' });
  const space = await post('/api/spaces', { place_id: place.id, name: 'North bed', kind: 'bed' });
  const tomato = await plantByKey('plant.test-tomato');
  const p = await post('/api/plantings', { space_id: space.id, plant_id: tomato.id, how_started: 'seed_indoors', start_on: '2027-02-10' });
  return { place, space, tomato, p, task: kind => p.tasks.find(x => x.kind === kind) };
}

describe('tasks', () => {
  it('marking a task done logs it and moves the planting forward', async () => {
    const s = await setup();
    const start = s.task('start_seeds');
    const res = await patch(`/api/tasks/${start.id}`, { version: start.version, done_on: '2027-02-11' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ done_on: '2027-02-11', edited: 0 });
    const full = (await t.http().get(`/api/plantings/${s.p.id}`)).body;
    expect(full.status).toBe('started');
    expect(full.log[0]).toMatchObject({ on_date: '2027-02-11', kind: 'sowed', task_id: start.id });
    const tr = s.task('transplant');
    await patch(`/api/tasks/${tr.id}`, { version: tr.version, done_on: '2027-04-12' }).expect(200);
    expect((await t.http().get(`/api/plantings/${s.p.id}`)).body.status).toBe('growing');
  });

  it('marking done never moves the status back', async () => {
    const s = await setup();
    await patch(`/api/plantings/${s.p.id}`, { version: 1, status: 'harvesting' }).expect(200);
    const start = s.task('start_seeds');
    await patch(`/api/tasks/${start.id}`, { version: start.version, done_on: '2027-02-11' }).expect(200);
    expect((await t.http().get(`/api/plantings/${s.p.id}`)).body.status).toBe('harvesting');
  });

  it('un-marking removes that log entry and leaves the status', async () => {
    const s = await setup();
    const start = s.task('start_seeds');
    const done = (await patch(`/api/tasks/${start.id}`, { version: start.version, done_on: '2027-02-11' })).body;
    await patch(`/api/tasks/${start.id}`, { version: done.version, done_on: null }).expect(200);
    const full = (await t.http().get(`/api/plantings/${s.p.id}`)).body;
    expect(full.log).toEqual([]);
    expect(full.status).toBe('started');
  });

  it('editing a task\'s date marks it edited', async () => {
    const s = await setup();
    const feed = s.task('feed');
    const res = await patch(`/api/tasks/${feed.id}`, { version: feed.version, due_on: '2027-05-20' });
    expect(res.body).toMatchObject({ due_on: '2027-05-20', edited: 1 });
  });

  it('a window can\'t end before it starts, and a stale save is 409', async () => {
    const s = await setup();
    const h = s.task('harvest');
    const bad = await patch(`/api/tasks/${h.id}`, { version: h.version, end_on: '2027-01-01' });
    expect(bad.status).toBe(400);
    expect(bad.body.detailCodes.end_on.code).toBe('range_order');
    await patch(`/api/tasks/${h.id}`, { version: h.version, notes: 'a' }).expect(200);
    expect((await patch(`/api/tasks/${h.id}`, { version: h.version, notes: 'b' })).status).toBe(409);
  });

  it('an owner task needs a title', async () => {
    const s = await setup();
    const res = await t.http().post(`/api/plantings/${s.p.id}/tasks`).send({ due_on: '2027-03-01' });
    expect(res.status).toBe(400);
    expect(res.body.detailCodes.title.code).toBe('required');
    const ok = await post(`/api/plantings/${s.p.id}/tasks`, { due_on: '2027-03-01', title: 'Build the trellis' });
    expect(ok).toMatchObject({ kind: 'other', auto: 0, title: 'Build the trellis' });
  });

  it('a task deleted with the Trash can\'t come back while its planting is gone', async () => {
    const s = await setup();
    const feed = s.task('feed');
    await t.http().delete(`/api/tasks/${feed.id}`).expect(200);
    await t.http().delete(`/api/plantings/${s.p.id}`).expect(200);
    expect((await t.http().post(`/api/trash/task/${feed.id}/restore`)).status).toBe(409);
  });

  it('a log entry can\'t be restored while its planting is in the Trash', async () => {
    const s = await setup();
    const l = await post(`/api/plantings/${s.p.id}/log`, { on_date: '2027-02-12', kind: 'watered' });
    await t.http().delete(`/api/log/${l.id}`).expect(200);
    await t.http().delete(`/api/plantings/${s.p.id}`).expect(200);
    expect((await t.http().post(`/api/trash/log/${l.id}/restore`)).status).toBe(409);
  });

  it('tasks in a range include windows that overlap it and, with open, everything overdue and anything finished in the range', async () => {
    const s = await setup();
    const inRange = (await t.http().get(`/api/tasks?place_id=${s.place.id}&from=2027-06-15&to=2027-06-21`)).body;
    expect(inRange.map(x => x.kind)).toEqual(['harvest']);
    expect(inRange[0]).toMatchObject({ plant: { name: 'Test tomato' }, space: { name: 'North bed' }, planting: { id: s.p.id } });
    const open = (await t.http().get(`/api/tasks?place_id=${s.place.id}&from=2027-04-11&to=2027-04-11&open=1`)).body;
    expect(open.map(x => x.kind)).toEqual(['start_seeds', 'pot_up', 'harden_off', 'transplant']);
    const start = s.task('start_seeds');
    await patch(`/api/tasks/${start.id}`, { version: start.version, done_on: '2027-04-11' }).expect(200);
    const withDone = (await t.http().get(`/api/tasks?place_id=${s.place.id}&from=2027-04-11&to=2027-04-11&open=1`)).body;
    expect(withDone.find(x => x.kind === 'start_seeds').done_on).toBe('2027-04-11');
    const bad = await t.http().get(`/api/tasks?place_id=${s.place.id}&from=nope&to=2027-04-11`);
    expect(bad.status).toBe(400);
  });
});

describe('supplies', () => {
  it('supplies merge the same name across tasks regardless of case and accents', async () => {
    const s = await setup();
    const own = await post('/api/guides', { title: 'Mine', stage: 'care', plant_id: s.tomato.id, steps: ['Feed it'], supplies: [{ name: 'compost', amount: '2 cups' }] });
    const other = await post('/api/guides', { title: 'Mine too', stage: 'care', steps: ['Pests'], supplies: [{ name: 'Cómpost', amount: '1 bag' }] });
    const feed = s.task('feed');
    const pests = s.task('pests');
    await patch(`/api/tasks/${feed.id}`, { version: feed.version, guide_id: own.id }).expect(200);
    await patch(`/api/tasks/${pests.id}`, { version: pests.version, guide_id: other.id }).expect(200);
    const list = (await t.http().get(`/api/supplies?place_id=${s.place.id}&from=2027-04-20&to=2027-05-31`)).body;
    const compost = list.filter(x => /compost/i.test(x.name.normalize('NFD').replace(/\p{M}/gu, '')));
    expect(compost).toHaveLength(1);
    expect(compost[0].items.map(i => i.amount).sort()).toEqual(['1 bag', '2 cups']);
  });

  it('supplies skip done tasks, tasks outside the range and tasks without a guide', async () => {
    const s = await setup();
    const basics = (await t.http().get('/api/guides')).body.find(g => g.stage === 'start_indoors');
    let start = s.task('start_seeds');
    let pot = s.task('pot_up');
    start = (await patch(`/api/tasks/${start.id}`, { version: start.version, guide_id: basics.id })).body;
    pot = (await patch(`/api/tasks/${pot.id}`, { version: pot.version, guide_id: basics.id })).body;
    const all = (await t.http().get(`/api/supplies?place_id=${s.place.id}&from=2027-02-01&to=2027-03-31`)).body;
    expect(all.length).toBeGreaterThan(0);
    await patch(`/api/tasks/${start.id}`, { version: start.version, done_on: '2027-02-10' }).expect(200);
    await patch(`/api/tasks/${pot.id}`, { version: pot.version, done_on: '2027-03-03' }).expect(200);
    expect((await t.http().get(`/api/supplies?place_id=${s.place.id}&from=2027-02-01&to=2027-03-31`)).body).toEqual([]);
    expect((await t.http().get(`/api/supplies?place_id=${s.place.id}&from=2028-01-01&to=2028-01-31`)).body).toEqual([]);
  });
});
