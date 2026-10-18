import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../server/db/connection.js';
import { migrations } from '../../server/db/migrations.js';
import { makeTestContext } from './helpers.js';
import { topUpCare, topUpAllCare } from '../../server/services/care.js';

describe('migration 10 keeps id counters', () => {
  it('ids used before the upgrade are never handed out again, and foreign keys end up on', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-m10b-'));
    const raw = new DatabaseSync(path.join(dir, 'garden.db'));
    for (let i = 0; i < 9; i++) raw.exec(migrations[i]);
    raw.exec('PRAGMA user_version = 9');
    raw.exec(`INSERT INTO places (id, name) VALUES (1, 'Springfield'); INSERT INTO spaces (id, place_id, name, kind) VALUES (1, 1, 'Bed', 'bed');
      INSERT INTO plants (id, name, kind) VALUES (1, 'Fig', 'fruit_tree');
      INSERT INTO plantings (id, space_id, plant_id, how_started, start_on) VALUES (1, 1, 1, 'mature', '2027-03-01');
      INSERT INTO tasks (id, planting_id, kind, due_on) VALUES (5, 1, 'plant', '2027-03-01'), (50, 1, 'plant', '2027-03-01');
      DELETE FROM tasks WHERE id = 50;
      INSERT INTO planting_log (id, planting_id, on_date, kind) VALUES (9, 1, '2027-03-01', 'note'), (90, 1, '2027-03-01', 'note');
      DELETE FROM planting_log WHERE id = 90;`);
    raw.close();
    const db = openDb(dir);
    expect(db.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1);
    const t = db.prepare("INSERT INTO tasks (planting_id, kind, due_on) VALUES (1, 'plant', '2027-03-02') RETURNING id").get();
    const l = db.prepare("INSERT INTO planting_log (planting_id, on_date, kind) VALUES (1, '2027-03-02', 'note') RETURNING id").get();
    expect(t.id).toBeGreaterThan(50);
    expect(l.id).toBeGreaterThan(90);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

let t;
beforeEach(() => { t = makeTestContext(); });
afterEach(() => t.cleanup());
async function post(url, body, status = 201) {
  const res = await t.http().post(url).send(body);
  if (res.status !== status) throw new Error(`${url} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const careKeys = id => t.ctx.db.prepare('SELECT season_key, due_on FROM tasks WHERE planting_id = ? AND season_key IS NOT NULL AND deleted_at IS NULL ORDER BY season_key').all(id);
async function setup() {
  const home = await post('/api/places', { name: 'Springfield', last_frost: '04-01', first_frost: '10-30', zone: '7b', time_zone: 'UTC' });
  const later = await post('/api/places', { name: 'Shelbyville', last_frost: '05-10', first_frost: '10-01', zone: '6a', time_zone: 'UTC' });
  const pot = await post('/api/spaces', { place_id: home.id, name: 'Patio pot', kind: 'container' });
  const deck = await post('/api/spaces', { place_id: later.id, name: 'Deck', kind: 'bed' });
  const lemon = await post('/api/plants', { name: 'Lemon', kind: 'fruit_tree', perennial: true, zone_min: 9, zone_max: 11 });
  const p = await post('/api/plantings', { space_id: pot.id, plant_id: lemon.id, how_started: 'mature', start_on: '2027-02-01' });
  t.ctx.db.prepare('DELETE FROM tasks WHERE season_key IS NOT NULL').run();
  topUpCare(t.ctx.db, p.id, '2027-02-01');
  return { home, later, pot, deck, lemon, p: (await t.http().get(`/api/plantings/${p.id}`)).body };
}

describe('review fixes', () => {
  it('changing the start date keeps the care tasks', async () => {
    const s = await setup();
    const before = careKeys(s.p.id);
    await t.http().patch(`/api/plantings/${s.p.id}`).send({ version: s.p.version, start_on: '2027-02-05' }).expect(200);
    expect(careKeys(s.p.id)).toEqual(before);
  });

  it('changing the place on an edit redoes the care for the new place', async () => {
    const s = await setup();
    await t.http().patch(`/api/plantings/${s.p.id}`).send({ version: s.p.version, space_id: s.deck.id }).expect(200);
    const protect = careKeys(s.p.id).filter(k => k.season_key.startsWith('protect:'));
    expect(protect.every(k => k.due_on.endsWith('-09-24'))).toBe(true);
  });

  it('taking a plant out of its pot on an edit drops its pot care', async () => {
    const s = await setup();
    await t.http().patch(`/api/plantings/${s.p.id}`).send({ version: s.p.version, in_container: false }).expect(200);
    const today = new Date().toISOString().slice(0, 10);
    expect(careKeys(s.p.id).filter(k => k.season_key.startsWith('check_pot:') && k.due_on >= today)).toEqual([]);
  });

  it('a care task deleted forever does not come back', async () => {
    const s = await setup();
    const prune = t.ctx.db.prepare("SELECT id FROM tasks WHERE planting_id = ? AND kind = 'prune'").get(s.p.id);
    await t.http().delete(`/api/tasks/${prune.id}`).expect(200);
    await t.http().delete(`/api/trash/task/${prune.id}`).expect(200);
    topUpCare(t.ctx.db, s.p.id, '2027-02-01');
    expect(careKeys(s.p.id).filter(k => k.season_key === 'prune:2027')).toEqual([]);
    await t.http().delete(`/api/plantings/${s.p.id}`).expect(200);
    await t.http().post('/api/trash/empty').send({}).expect(200);
  });

  it('one bad planting does not stop the morning top-up for the others', async () => {
    const s = await setup();
    const fig = await post('/api/plants', { name: 'Fig', kind: 'fruit_tree', perennial: true, zone_min: 7, zone_max: 11 });
    const q = await post('/api/plantings', { space_id: s.pot.id, plant_id: fig.id, how_started: 'mature', start_on: '2027-02-01' });
    t.ctx.db.prepare('DELETE FROM tasks WHERE season_key IS NOT NULL').run();
    let calls = 0;
    topUpAllCare(t.ctx, id => { calls++; if (id === s.p.id) throw new Error('boom'); return '2027-02-01'; });
    expect(calls).toBe(2);
    expect(careKeys(q.id).length).toBeGreaterThan(0);
  });
});
