import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';

let t;
let home;
beforeEach(async () => {
  t = makeTestContext();
  home = (await t.http().post('/api/places').send({ name: 'Home' })).body;
});
afterEach(() => t.cleanup());

const add = async body => {
  const res = await t.http().post('/api/spaces').send({ place_id: home.id, ...body });
  if (res.status !== 201) throw new Error(`add failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};
const items = rows => rows.map(r => ({ id: r.id, version: r.version }));

describe('spaces', () => {
  it('saves a bed with its size and sun', async () => {
    const bed = await add({ name: 'Bed 1', kind: 'bed', length_m: 3.048, width_m: 1.2192, sun: 'full' });
    expect(bed).toMatchObject({ place_id: home.id, name: 'Bed 1', kind: 'bed', length_m: 3.048, width_m: 1.2192, sun: 'full', version: 1 });
  });

  it('greenhouse season notes save and are cleared when the space becomes a bed', async () => {
    const gh = await add({ name: 'Big greenhouse', kind: 'greenhouse', notes_winter: 'Kale and lettuce', notes_summer: 'Shade cloth, peppers' });
    expect(gh).toMatchObject({ notes_winter: 'Kale and lettuce', notes_summer: 'Shade cloth, peppers', notes_spring: null });
    const bed = (await t.http().patch(`/api/spaces/${gh.id}`).send({ version: gh.version, kind: 'bed' })).body;
    expect(bed).toMatchObject({ notes_winter: null, notes_summer: null });
    const bad = await t.http().post('/api/spaces').send({ place_id: home.id, name: 'X', kind: 'greenhouse', notes_fall: 'x'.repeat(2001) });
    expect(bad.status).toBe(400);
  });

  it('a space needs a kind and a name', async () => {
    const res = await t.http().post('/api/spaces').send({ place_id: home.id });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.details).sort()).toEqual(['kind', 'name']);
  });

  it('a space needs a live place', async () => {
    await t.http().delete(`/api/places/${home.id}`);
    const res = await t.http().post('/api/spaces').send({ place_id: home.id, name: 'Bed', kind: 'bed' });
    expect(res.status).toBe(400);
    expect(res.body.detailCodes.place_id.code).toBe('place_gone');
    const none = await t.http().post('/api/spaces').send({ place_id: 999, name: 'Bed', kind: 'bed' });
    expect(none.status).toBe(400);
  });

  it("fields that don't fit the kind are cleared", async () => {
    const bed = await add({ name: 'Bed', kind: 'bed', pot_liters: 20, tray_count: 4, heated: true });
    expect(bed).toMatchObject({ pot_liters: null, tray_count: null, heated: 0 });
    expect((await add({ name: 'Pot', kind: 'container', pot_liters: 20, length_m: 2 })).pot_liters).toBe(20);
    expect((await add({ name: 'Pot', kind: 'container', pot_liters: 20, length_m: 2 })).length_m).toBeNull();
    expect((await add({ name: 'Rack', kind: 'microgreen_rack', tray_count: 8 })).tray_count).toBe(8);
    expect((await add({ name: 'Glass', kind: 'greenhouse', heated: true })).heated).toBe(1);
  });

  it("changing kind clears the old kind's field", async () => {
    const pot = await add({ name: 'Pot', kind: 'container', pot_liters: 20 });
    const res = await t.http().patch(`/api/spaces/${pot.id}`).send({ version: pot.version, kind: 'bed' });
    expect(res.body).toMatchObject({ kind: 'bed', pot_liters: null });
  });

  it('a space can move to another place', async () => {
    const later = (await t.http().post('/api/places').send({ name: 'Later' })).body;
    const pot = await add({ name: 'Pot', kind: 'container' });
    const res = await t.http().patch(`/api/spaces/${pot.id}`).send({ version: pot.version, place_id: later.id });
    expect(res.body.place_id).toBe(later.id);
  });

  it("listing by place hides deleted spaces and other places' spaces", async () => {
    const later = (await t.http().post('/api/places').send({ name: 'Later' })).body;
    await add({ name: 'Keep', kind: 'bed' });
    const gone = await add({ name: 'Gone', kind: 'bed' });
    await t.http().post('/api/spaces').send({ place_id: later.id, name: 'Elsewhere', kind: 'bed' });
    await t.http().delete(`/api/spaces/${gone.id}`);
    const res = await t.http().get(`/api/spaces?place_id=${home.id}`);
    expect(res.body.map(s => s.name)).toEqual(['Keep']);
  });

  it('listing needs a place', async () => {
    expect((await t.http().get('/api/spaces')).status).toBe(400);
  });

  it('reorder within a place', async () => {
    const a = await add({ name: 'A', kind: 'bed' });
    const b = await add({ name: 'B', kind: 'bed' });
    const later = (await t.http().post('/api/places').send({ name: 'Later' })).body;
    await t.http().post('/api/spaces').send({ place_id: later.id, name: 'Other', kind: 'bed' });
    const res = await t.http().post('/api/spaces/reorder').send({ place_id: home.id, items: items([b, a]) });
    expect(res.status).toBe(200);
    expect(res.body.map(s => s.name)).toEqual(['B', 'A']);
  });

  it('a stale save gets 409', async () => {
    const bed = await add({ name: 'Bed', kind: 'bed' });
    await t.http().patch(`/api/spaces/${bed.id}`).send({ version: 1, name: 'Bed 2' });
    expect((await t.http().patch(`/api/spaces/${bed.id}`).send({ version: 1, name: 'Bed 3' })).status).toBe(409);
  });
});

describe('spaces in the Trash', () => {
  it('deleting a place sends its spaces to the Trash with it, and restore brings them back', async () => {
    const early = await add({ name: 'Deleted earlier', kind: 'bed' });
    await t.http().delete(`/api/spaces/${early.id}`);
    await add({ name: 'Bed', kind: 'bed' });
    await add({ name: 'Pot', kind: 'container' });
    await t.http().delete(`/api/places/${home.id}`);
    const trash = (await t.http().get('/api/trash')).body;
    const place = trash.find(i => i.type === 'place');
    expect(place).toMatchObject({ id: home.id, extra: 2, earlier: 1 });
    expect(trash.filter(i => i.type === 'space').map(i => ({ title: i.title, parentInTrash: i.parentInTrash })))
      .toEqual([{ title: 'Deleted earlier', parentInTrash: true }]);
    await t.http().post(`/api/trash/place/${home.id}/restore`);
    expect((await t.http().get(`/api/spaces?place_id=${home.id}`)).body.map(s => s.name).sort()).toEqual(['Bed', 'Pot']);
    expect((await t.http().get('/api/trash')).body.map(i => i.title)).toEqual(['Deleted earlier']);
  });

  it('restoring a lone space whose place is in the Trash says to restore the place first', async () => {
    const bed = await add({ name: 'Bed', kind: 'bed' });
    await t.http().delete(`/api/spaces/${bed.id}`);
    await t.http().delete(`/api/places/${home.id}`);
    const res = await t.http().post(`/api/trash/space/${bed.id}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('parent_in_trash');
  });

  it('emptying the Trash purges spaces before their place', async () => {
    await add({ name: 'Bed', kind: 'bed' });
    await t.http().delete(`/api/places/${home.id}`);
    const res = await t.http().post('/api/trash/empty');
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(1);
    expect(t.ctx.db.prepare('SELECT count(*) n FROM spaces').get().n).toBe(0);
  });

  it('deleting a place forever takes its spaces in the Trash with it', async () => {
    const early = await add({ name: 'Early', kind: 'bed' });
    await t.http().delete(`/api/spaces/${early.id}`);
    await add({ name: 'Bed', kind: 'bed' });
    await t.http().delete(`/api/places/${home.id}`);
    expect((await t.http().delete(`/api/trash/place/${home.id}`)).status).toBe(200);
    expect(t.ctx.db.prepare('SELECT count(*) n FROM spaces').get().n).toBe(0);
  });
});
