import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';
import { topUpCare, topUpAllCare } from '../../server/services/care.js';

let t;
beforeEach(() => { t = makeTestContext(); });
afterEach(() => t.cleanup());

async function post(url, body, status = 201) {
  const res = await t.http().post(url).send(body);
  if (res.status !== status) throw new Error(`${url} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const careOf = id => t.ctx.db.prepare("SELECT kind, due_on, season_key, deleted_at FROM tasks WHERE planting_id = ? AND season_key IS NOT NULL ORDER BY due_on, id").all(id);
async function setup() {
  const place = await post('/api/places', { name: 'Springfield', last_frost: '04-01', first_frost: '10-30', zone: '7b', time_zone: 'UTC' });
  const pot = await post('/api/spaces', { place_id: place.id, name: 'Patio pot', kind: 'container' });
  const lemon = await post('/api/plants', { name: 'Lemon', kind: 'fruit_tree', perennial: true, zone_min: 9, zone_max: 11 });
  const p = await post('/api/plantings', { space_id: pot.id, plant_id: lemon.id, how_started: 'mature', start_on: '2027-02-01' });
  return { place, pot, lemon, p };
}

describe('care tasks', () => {
  it('a new perennial gets its care tasks for the coming year, linked to guides', async () => {
    const s = await setup();
    topUpCare(t.ctx.db, s.p.id, '2027-02-01');
    const care = careOf(s.p.id);
    expect(care.map(c => c.kind)).toEqual(['check_pot', 'prune', 'feed', 'feed', 'protect']);
    expect(care.every(c => c.due_on >= '2027-02-01' && c.due_on <= '2028-02-01')).toBe(true);
  });

  it('topping up twice makes no duplicates', async () => {
    const s = await setup();
    topUpCare(t.ctx.db, s.p.id, '2027-02-01');
    const n = careOf(s.p.id).length;
    topUpCare(t.ctx.db, s.p.id, '2027-02-01');
    expect(careOf(s.p.id).length).toBe(n);
    topUpCare(t.ctx.db, s.p.id, '2027-03-01');
    const keys = careOf(s.p.id).map(c => c.season_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a care task the owner deleted is not made again', async () => {
    const s = await setup();
    topUpCare(t.ctx.db, s.p.id, '2027-02-01');
    const prune = t.ctx.db.prepare("SELECT id FROM tasks WHERE planting_id = ? AND kind = 'prune'").get(s.p.id);
    await t.http().delete(`/api/tasks/${prune.id}`).expect(200);
    topUpCare(t.ctx.db, s.p.id, '2027-02-01');
    expect(careOf(s.p.id).filter(c => c.kind === 'prune' && !c.deleted_at)).toEqual([]);
  });

  it('finished, done and non-perennial plantings get no care', async () => {
    const s = await setup();
    await t.http().patch(`/api/plantings/${s.p.id}`).send({ version: 1, status: 'done' }).expect(200);
    const before = careOf(s.p.id).length;
    topUpCare(t.ctx.db, s.p.id, '2027-06-01');
    expect(careOf(s.p.id).length).toBe(before);
    const tomato = (await t.http().get('/api/plants')).body.find(p => p.starter_key === 'plant.test-tomato');
    const bed = await post('/api/spaces', { place_id: s.place.id, name: 'Bed', kind: 'bed' });
    const q = await post('/api/plantings', { space_id: bed.id, plant_id: tomato.id, how_started: 'start', start_on: '2027-04-10' });
    topUpCare(t.ctx.db, q.id, '2027-04-10');
    expect(careOf(q.id)).toEqual([]);
  });

  it('creating a perennial planting adds its care, and the startup top-up covers every planting', async () => {
    const s = await setup();
    expect(careOf(s.p.id).length).toBeGreaterThan(0);
    t.ctx.db.prepare('DELETE FROM tasks WHERE season_key IS NOT NULL').run();
    topUpAllCare(t.ctx, () => '2027-02-01');
    expect(careOf(s.p.id).length).toBeGreaterThan(0);
  });

  it('finishing a pruning task logs it as pruned', async () => {
    const s = await setup();
    topUpCare(t.ctx.db, s.p.id, '2027-02-01');
    const prune = t.ctx.db.prepare("SELECT id, version FROM tasks WHERE planting_id = ? AND kind = 'prune'").get(s.p.id);
    await t.http().patch(`/api/tasks/${prune.id}`).send({ version: prune.version, done_on: '2027-03-04' }).expect(200);
    expect((await t.http().get(`/api/plantings/${s.p.id}`)).body.log[0].kind).toBe('pruned');
  });
});
