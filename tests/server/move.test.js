import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';
import { topUpCare } from '../../server/services/care.js';

let t;
beforeEach(() => { t = makeTestContext(); });
afterEach(() => t.cleanup());

async function post(url, body, status = 201) {
  const res = await t.http().post(url).send(body);
  if (res.status !== status) throw new Error(`${url} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const get = async url => (await t.http().get(url)).body;
const care = id => t.ctx.db.prepare('SELECT id, kind, due_on, edited, done_on FROM tasks WHERE planting_id = ? AND season_key IS NOT NULL AND deleted_at IS NULL ORDER BY due_on, id').all(id);
async function setup() {
  const home = await post('/api/places', { name: 'Springfield', last_frost: '04-01', first_frost: '10-30', zone: '7b', time_zone: 'UTC' });
  const later = await post('/api/places', { name: 'Shelbyville', last_frost: '05-10', first_frost: '10-01', zone: '6a', time_zone: 'UTC' });
  const pot = await post('/api/spaces', { place_id: home.id, name: 'Patio pot', kind: 'container' });
  const porch = await post('/api/spaces', { place_id: home.id, name: 'Porch', kind: 'bed' });
  const deck = await post('/api/spaces', { place_id: later.id, name: 'Deck', kind: 'bed' });
  const lemon = await post('/api/plants', { name: 'Lemon', kind: 'fruit_tree', perennial: true, zone_min: 9, zone_max: 11 });
  const p = await post('/api/plantings', { space_id: pot.id, plant_id: lemon.id, how_started: 'mature', start_on: '2027-02-01' });
  t.ctx.db.prepare('DELETE FROM tasks WHERE season_key IS NOT NULL').run();
  topUpCare(t.ctx.db, p.id, '2027-02-01');
  return { home, later, pot, porch, deck, lemon, p: await get(`/api/plantings/${p.id}`) };
}
const move = (s, body) => t.http().post(`/api/plantings/${s.p.id}/move`).send({ version: s.p.version, moved_on: '2027-06-01', ...body });

describe('moving a container plant', () => {
  it('moving a pot to another space logs the move and keeps its tasks', async () => {
    const s = await setup();
    const before = care(s.p.id);
    const res = await move(s, { space_id: s.porch.id });
    expect(res.status).toBe(200);
    expect(res.body.space).toMatchObject({ id: s.porch.id, name: 'Porch' });
    expect(res.body.log[0]).toMatchObject({ kind: 'moved', on_date: '2027-06-01', note: 'From Patio pot (Springfield) to Porch (Springfield)' });
    expect(care(s.p.id)).toEqual(before);
  });

  it('moving a pot to another place redoes its untouched future care for the new place', async () => {
    const s = await setup();
    const res = await move(s, { space_id: s.deck.id });
    expect(res.status).toBe(200);
    const after = care(s.p.id);
    expect(after.filter(c => c.due_on < '2027-06-01').map(c => c.kind)).toEqual(['check_pot', 'prune', 'feed']);
    expect(after.find(c => c.kind === 'protect').due_on).toBe('2027-09-24');
    expect(after.filter(c => c.kind === 'feed' && c.due_on >= '2027-06-01' && c.due_on < '2028-01-01').map(c => c.due_on)).toEqual(['2027-07-19']);
  });

  it('edited, added and finished care tasks stay through a move', async () => {
    const s = await setup();
    const tasks = care(s.p.id);
    const prot = tasks.find(c => c.kind === 'protect');
    const feed2 = tasks.find(c => c.kind === 'feed' && c.due_on === '2027-06-10');
    t.ctx.db.prepare("UPDATE tasks SET due_on = '2027-10-15', edited = 1 WHERE id = ?").run(prot.id);
    t.ctx.db.prepare("UPDATE tasks SET done_on = '2027-06-01' WHERE id = ?").run(feed2.id);
    const own = await post(`/api/plantings/${s.p.id}/tasks`, { title: 'Wrap the pot', due_on: '2027-11-01' });
    await move(s, { space_id: s.deck.id }).expect(200);
    const after = care(s.p.id);
    expect(after.find(c => c.id === prot.id).due_on).toBe('2027-10-15');
    expect(after.filter(c => c.kind === 'protect')).toHaveLength(1);
    expect(after.find(c => c.id === feed2.id).done_on).toBe('2027-06-01');
    expect((await get(`/api/plantings/${s.p.id}`)).tasks.some(x => x.id === own.id)).toBe(true);
  });

  it('a planting in the ground can’t be moved', async () => {
    const s = await setup();
    const tomato = (await get('/api/plants')).find(p => p.starter_key === 'plant.test-tomato');
    const q = await post('/api/plantings', { space_id: s.porch.id, plant_id: tomato.id, how_started: 'start', start_on: '2027-04-10' });
    const res = await t.http().post(`/api/plantings/${q.id}/move`).send({ version: q.version, space_id: s.deck.id, moved_on: '2027-06-01' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('not_in_container');
  });

  it('a stale move is 409, and moving to the same or a missing space is refused', async () => {
    const s = await setup();
    await t.http().patch(`/api/plantings/${s.p.id}`).send({ version: s.p.version, notes: 'x' }).expect(200);
    expect((await move(s, { space_id: s.porch.id })).status).toBe(409);
    const fresh = await get(`/api/plantings/${s.p.id}`);
    expect((await t.http().post(`/api/plantings/${s.p.id}/move`).send({ version: fresh.version, space_id: s.pot.id, moved_on: '2027-06-01' })).status).toBe(400);
    expect((await t.http().post(`/api/plantings/${s.p.id}/move`).send({ version: fresh.version, space_id: 999, moved_on: '2027-06-01' })).status).toBe(400);
  });
});
