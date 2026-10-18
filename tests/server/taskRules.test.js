import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';
import { planTasks } from '../../server/services/taskRules.js';
import { addDays } from '../../server/services/dates.js';

let t;
beforeEach(() => { t = makeTestContext(); });
afterEach(() => t.cleanup());

async function post(url, body, status = 201) {
  const res = await t.http().post(url).send(body);
  if (res.status !== status) throw new Error(`${url} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const plantByKey = async key => (await t.http().get('/api/plants')).body.find(p => p.starter_key === key);
async function bed() {
  const place = await post('/api/places', { name: 'Springfield', last_frost: '04-01', first_frost: '10-30' });
  return post('/api/spaces', { place_id: place.id, name: 'North bed', kind: 'bed' });
}
const plan = tasks => tasks.map(x => [x.kind, x.due_on, x.end_on ?? null]);

const TOMATO = { kind: 'vegetable', start_indoors_min: 6, start_indoors_max: 8, transplant_min: 1, transplant_max: 2, spacing_cm: 60, days_min: 60, days_max: 85, perennial: 0 };
const BASIL = { kind: 'herb', transplant_min: 1, transplant_max: 3, spacing_cm: 25, days_min: 50, days_max: 70, perennial: 0 };

describe('dates', () => {
  it('adds days across months and the new year', () => {
    expect(addDays('2027-02-10', 60)).toBe('2027-04-11');
    expect(addDays('2027-12-30', 5)).toBe('2028-01-04');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });
});

describe('task rules', () => {
  it('indoor tomato: start, pot up, harden off, transplant, feed, pests, harvest window on the right days', () => {
    expect(plan(planTasks(TOMATO, 'seed_indoors', '2027-02-10'))).toEqual([
      ['start_seeds', '2027-02-10', null], ['pot_up', '2027-03-03', null], ['harden_off', '2027-04-04', null], ['transplant', '2027-04-11', null],
      ['pests', '2027-05-02', null], ['feed', '2027-05-09', null], ['harvest', '2027-06-10', '2027-07-05'],
    ]);
  });

  it('direct-sown beans: sow, thin, feed, pests, harvest', () => {
    expect(plan(planTasks(BASIL, 'seed_outdoors', '2027-05-01'))).toEqual([
      ['sow', '2027-05-01', null], ['thin', '2027-05-15', null], ['pests', '2027-05-22', null], ['feed', '2027-05-29', null], ['harvest', '2027-06-20', '2027-07-10'],
    ]);
  });

  it('a bought start hardens off a week before planting', () => {
    expect(plan(planTasks(BASIL, 'start', '2027-05-01')).slice(0, 2)).toEqual([['harden_off', '2027-04-24', null], ['transplant', '2027-05-01', null]]);
  });

  it('a mature fig gets one Plant task', () => {
    expect(plan(planTasks({ kind: 'fruit_tree', perennial: 1, transplant_min: 0, transplant_max: 4, years_min: 1, years_max: 2 }, 'mature', '2027-03-15')))
      .toEqual([['plant', '2027-03-15', null]]);
  });

  it('a microgreen gets sow and harvest', () => {
    expect(plan(planTasks({ kind: 'microgreen', days_min: 10, days_max: 14 }, 'seed_indoors', '2027-12-20')))
      .toEqual([['sow', '2027-12-20', null], ['harvest', '2027-12-30', '2028-01-03']]);
  });

  it('no thinning for big seeds planted far apart is not assumed; tiny spacing skips thinning', () => {
    expect(plan(planTasks({ ...BASIL, spacing_cm: 3 }, 'seed_outdoors', '2027-05-01')).map(x => x[0])).not.toContain('thin');
  });
});

describe('plantings make their tasks', () => {
  it('tasks link the plant\'s own guide first, then a basics guide', async () => {
    const space = await bed();
    const tomato = await plantByKey('plant.test-tomato');
    const p = await post('/api/plantings', { space_id: space.id, plant_id: tomato.id, how_started: 'seed_indoors', start_on: '2027-02-10' });
    const own = p.tasks.find(x => x.kind === 'start_seeds');
    expect(own.guide.title).toBe('Fixture: starting tomatoes');
    expect(own.auto).toBe(1);
    const pepper = await post('/api/plants', { name: 'Pepper', kind: 'vegetable', start_indoors_min: 8, start_indoors_max: 10, transplant_min: 2, transplant_max: 3 });
    const q = await post('/api/plantings', { space_id: space.id, plant_id: pepper.id, how_started: 'seed_indoors', start_on: '2027-01-20' });
    const basics = (await t.http().get('/api/guides')).body.find(g => g.stage === 'start_indoors');
    expect(q.tasks.find(x => x.kind === 'start_seeds').guide.id).toBe(basics.id);
    expect(q.tasks.find(x => x.kind === 'feed').guide).toBeNull();
  });

  it('moving the start date moves untouched tasks and leaves edited and done ones', async () => {
    const space = await bed();
    const tomato = await plantByKey('plant.test-tomato');
    const p = await post('/api/plantings', { space_id: space.id, plant_id: tomato.id, how_started: 'seed_indoors', start_on: '2027-02-10' });
    const start = p.tasks.find(x => x.kind === 'start_seeds');
    const feed = p.tasks.find(x => x.kind === 'feed');
    t.ctx.db.prepare('UPDATE tasks SET done_on = ? WHERE id = ?').run('2027-02-10', start.id);
    t.ctx.db.prepare('UPDATE tasks SET due_on = ?, edited = 1 WHERE id = ?').run('2027-05-20', feed.id);
    const moved = (await t.http().patch(`/api/plantings/${p.id}`).send({ version: 1, start_on: '2027-02-17' })).body;
    const kinds = plan(moved.tasks);
    expect(kinds).toContainEqual(['start_seeds', '2027-02-10', null]);
    expect(kinds).toContainEqual(['feed', '2027-05-20', null]);
    expect(kinds).toContainEqual(['transplant', '2027-04-18', null]);
    expect(kinds.filter(k => k[0] === 'start_seeds')).toHaveLength(1);
    expect(kinds.filter(k => k[0] === 'feed')).toHaveLength(1);
    expect(kinds).not.toContainEqual(['transplant', '2027-04-11', null]);
  });

  it('a note change leaves the tasks alone', async () => {
    const space = await bed();
    const tomato = await plantByKey('plant.test-tomato');
    const p = await post('/api/plantings', { space_id: space.id, plant_id: tomato.id, how_started: 'seed_indoors', start_on: '2027-02-10' });
    const after = (await t.http().patch(`/api/plantings/${p.id}`).send({ version: 1, notes: 'x' })).body;
    expect(after.tasks.map(x => x.id)).toEqual(p.tasks.map(x => x.id));
  });

  it('preview returns tasks with guide titles and saves nothing', async () => {
    const space = await bed();
    const tomato = await plantByKey('plant.test-tomato');
    const res = await t.http().post('/api/plantings/preview').send({ space_id: space.id, plant_id: tomato.id, how_started: 'seed_indoors', start_on: '2027-02-10' });
    expect(res.status).toBe(200);
    expect(res.body.tasks[0]).toMatchObject({ kind: 'start_seeds', due_on: '2027-02-10', guide: { title: 'Fixture: starting tomatoes' } });
    expect(Array.isArray(res.body.tasks[0].supplies)).toBe(true);
    expect((await t.http().get('/api/plantings')).body).toEqual([]);
    const bad = await t.http().post('/api/plantings/preview').send({ space_id: space.id, plant_id: tomato.id, how_started: 'mature', start_on: '2027-02-10' });
    expect(bad.status).toBe(400);
  });
});
