import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';
import { planTasks } from '../../server/services/taskRules.js';

let t;
beforeEach(() => { t = makeTestContext(); });
afterEach(() => t.cleanup());

async function post(url, body, status = 201) {
  const res = await t.http().post(url).send(body);
  if (res.status !== status) throw new Error(`${url} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const plantByKey = async key => (await t.http().get('/api/plants')).body.find(p => p.starter_key === key);
async function setup() {
  const place = await post('/api/places', { name: 'Springfield', last_frost: '04-01', first_frost: '10-30' });
  const space = await post('/api/spaces', { place_id: place.id, name: 'North bed', kind: 'bed' });
  const tomato = await plantByKey('plant.test-tomato');
  const p = await post('/api/plantings', { space_id: space.id, plant_id: tomato.id, how_started: 'seed_indoors', start_on: '2027-02-10' });
  return { place, space, tomato, p };
}

describe('review fixes', () => {
  it('restoring a space leaves a planting whose plant is in the Trash where it is, and the Trash still empties', async () => {
    const s = await setup();
    await t.http().delete(`/api/spaces/${s.space.id}`).expect(200);
    await t.http().delete(`/api/plants/${s.tomato.id}`).expect(200);
    await t.http().post(`/api/trash/space/${s.space.id}/restore`).expect(200);
    expect((await t.http().get(`/api/plantings/${s.p.id}`)).status).toBe(404);
    await t.http().post(`/api/trash/plant/${s.tomato.id}/restore`).expect(200);
    await t.http().post(`/api/trash/planting/${s.p.id}/restore`).expect(200);
    await t.http().delete(`/api/spaces/${s.space.id}`).expect(200);
    await t.http().delete(`/api/plants/${s.tomato.id}`).expect(200);
    await t.http().post('/api/trash/empty').send({}).expect(200);
  });

  it('un-ticking a task trashes its untouched log entry with its photos, and keeps an entry the owner wrote on', async () => {
    const s = await setup();
    let start = s.p.tasks.find(x => x.kind === 'start_seeds');
    start = (await t.http().patch(`/api/tasks/${start.id}`).send({ version: start.version, done_on: '2027-02-10' })).body;
    const entry = (await t.http().get(`/api/plantings/${s.p.id}`)).body.log[0];
    t.ctx.db.prepare("INSERT INTO photos (owner_type, owner_id, filename) VALUES ('log', ?, 'x.jpg')").run(entry.id);
    start = (await t.http().patch(`/api/tasks/${start.id}`).send({ version: start.version, done_on: null })).body;
    expect(t.ctx.db.prepare("SELECT deleted_at FROM photos WHERE owner_type = 'log'").get().deleted_at).not.toBeNull();
    await t.http().post('/api/trash/empty').send({}).expect(200);
    expect(t.ctx.db.prepare("SELECT COUNT(*) n FROM photos WHERE owner_type = 'log'").get().n).toBe(0);
    start = (await t.http().patch(`/api/tasks/${start.id}`).send({ version: start.version, done_on: '2027-02-11' })).body;
    const mine = (await t.http().get(`/api/plantings/${s.p.id}`)).body.log[0];
    await t.http().patch(`/api/log/${mine.id}`).send({ version: mine.version, note: 'Used the old seed packet' }).expect(200);
    await t.http().patch(`/api/tasks/${start.id}`).send({ version: start.version, done_on: null }).expect(200);
    const log = (await t.http().get(`/api/plantings/${s.p.id}`)).body.log;
    expect(log.map(l => l.note)).toEqual(['Used the old seed packet']);
  });

  it('moving a start date leaves nothing in the Trash and no duplicates', async () => {
    const s = await setup();
    await t.http().patch(`/api/plantings/${s.p.id}`).send({ version: 1, start_on: '2027-02-17' }).expect(200);
    expect((await t.http().get('/api/trash')).body).toEqual([]);
    const kinds = (await t.http().get(`/api/plantings/${s.p.id}`)).body.tasks.map(x => x.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('a planting marked done stops showing its tasks and supplies', async () => {
    const s = await setup();
    const q = '/api/tasks?place_id=' + s.place.id + '&from=2027-06-01&to=2027-06-30&open=1';
    expect((await t.http().get(q)).body.length).toBeGreaterThan(0);
    await t.http().patch(`/api/plantings/${s.p.id}`).send({ version: 1, status: 'done' }).expect(200);
    expect((await t.http().get(q)).body).toEqual([]);
  });

  it('cloves and tubers are not thinned or hardened off', () => {
    const garlic = { kind: 'vegetable', starter_key: 'plant.garlic', spacing_cm: 15, fall_sow_min: -2, fall_sow_max: 2, perennial: 0 };
    expect(planTasks(garlic, 'seed_outdoors', '2027-10-20').map(x => x.kind)).not.toContain('thin');
    expect(planTasks(garlic, 'start', '2027-10-20').map(x => x.kind)).not.toContain('harden_off');
    expect(planTasks({ kind: 'vegetable', starter_key: 'plant.potato', spacing_cm: 30 }, 'seed_outdoors', '2027-03-20').map(x => x.kind)).not.toContain('thin');
    expect(planTasks({ kind: 'vegetable', starter_key: 'plant.carrot', spacing_cm: 5 }, 'seed_outdoors', '2027-03-20').map(x => x.kind)).toContain('thin');
  });
});
