import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTestContext } from './helpers.js';

// A 1x1 PNG.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082', 'hex');

let t;
let space;
let recycled;
beforeEach(async () => {
  recycled = [];
  t = makeTestContext({ recycle: file => { recycled.push(path.basename(file)); fs.rmSync(file); } });
  const place = (await t.http().post('/api/places').send({ name: 'Home' })).body;
  space = (await t.http().post('/api/spaces').send({ place_id: place.id, name: 'Bed', kind: 'bed' })).body;
});
afterEach(() => t.cleanup());

const upload = (buf = PNG, type = 'image/png', ownerId = space.id) => t.http().post('/api/photos')
  .field('owner_type', 'space').field('owner_id', String(ownerId)).field('caption', 'Spring')
  .attach('file', buf, { filename: 'p.png', contentType: type });
const live = name => path.join(t.dataDir, 'photos', name);
const trashed = name => path.join(t.dataDir, 'photos', '_trash', name);

describe('photos', () => {
  it('uploads a photo for a space and serves it', async () => {
    const res = await upload();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ owner_type: 'space', owner_id: space.id, caption: 'Spring', is_cover: 1, version: 1 });
    expect(fs.existsSync(live(res.body.filename))).toBe(true);
    const list = await t.http().get(`/api/photos?owner_type=space&owner_id=${space.id}`);
    expect(list.body.map(p => p.id)).toEqual([res.body.id]);
    const file = await t.http().get(`/photos/${res.body.filename}`);
    expect(file.status).toBe(200);
  });

  it('refuses a photo that is too big', async () => {
    const res = await upload(Buffer.alloc(16 * 1024 * 1024), 'image/png');
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('That photo is too big (15 MB max).');
  });

  it('refuses a file that is not a picture', async () => {
    const res = await upload(Buffer.from('hello'), 'text/plain');
    expect(res.status).toBe(400);
  });

  it('refuses a photo for a space that is gone', async () => {
    await t.http().delete(`/api/spaces/${space.id}`);
    expect((await upload()).status).toBe(400);
  });

  it("deleting the space takes its photo to the Trash, and restoring brings it back", async () => {
    const { body: photo } = await upload();
    await t.http().delete(`/api/spaces/${space.id}`);
    const row = t.ctx.db.prepare('SELECT deleted_at FROM photos WHERE id = ?').get(photo.id);
    const spaceRow = t.ctx.db.prepare('SELECT deleted_at FROM spaces WHERE id = ?').get(space.id);
    expect(row.deleted_at).toBe(spaceRow.deleted_at);
    expect(fs.existsSync(trashed(photo.filename))).toBe(true);
    expect(fs.existsSync(live(photo.filename))).toBe(false);
    expect((await t.http().get('/api/trash')).body.map(i => i.type)).toEqual(['space']);
    await t.http().post(`/api/trash/space/${space.id}/restore`);
    expect(fs.existsSync(live(photo.filename))).toBe(true);
    expect((await t.http().get(`/api/photos?owner_type=space&owner_id=${space.id}`)).body).toHaveLength(1);
  });

  it('deleting the place takes its spaces\' photos along too', async () => {
    const { body: photo } = await upload();
    await t.http().delete(`/api/places/${space.place_id}`);
    expect(fs.existsSync(trashed(photo.filename))).toBe(true);
    await t.http().post(`/api/trash/place/${space.place_id}/restore`);
    expect(fs.existsSync(live(photo.filename))).toBe(true);
  });

  it('emptying the Trash sends the photo file to the Recycle Bin', async () => {
    const { body: photo } = await upload();
    await t.http().delete(`/api/spaces/${space.id}`);
    await t.http().post('/api/trash/empty');
    expect(recycled).toEqual([photo.filename]);
    expect(t.ctx.db.prepare('SELECT count(*) n FROM photos').get().n).toBe(0);
  });

  it('a photo deleted on its own can be restored, unless its space is in the Trash', async () => {
    const { body: photo } = await upload();
    await t.http().delete(`/api/photos/${photo.id}`);
    expect((await t.http().get('/api/trash')).body.map(i => i.type)).toEqual(['photo']);
    expect((await t.http().post(`/api/trash/photo/${photo.id}/restore`)).status).toBe(200);
    await t.http().delete(`/api/photos/${photo.id}`);
    await t.http().delete(`/api/spaces/${space.id}`);
    const res = await t.http().post(`/api/trash/photo/${photo.id}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('parent_in_trash');
  });

  it('setting a cover clears the old cover', async () => {
    const { body: a } = await upload();
    const { body: b } = await upload();
    expect(b.is_cover).toBe(0);
    const res = await t.http().patch(`/api/photos/${b.id}`).send({ version: b.version, is_cover: true });
    expect(res.status).toBe(200);
    expect(res.body.is_cover).toBe(1);
    expect((await t.http().get(`/api/photos/${a.id}`)).body.is_cover).toBe(0);
  });

  it('deleting the cover makes the next photo the cover', async () => {
    const { body: a } = await upload();
    const { body: b } = await upload();
    await t.http().delete(`/api/photos/${a.id}`);
    expect((await t.http().get(`/api/photos/${b.id}`)).body.is_cover).toBe(1);
  });

  it('a stale caption save gets 409', async () => {
    const { body: p } = await upload();
    await t.http().patch(`/api/photos/${p.id}`).send({ version: 1, caption: 'One' });
    const res = await t.http().patch(`/api/photos/${p.id}`).send({ version: 1, caption: 'Two' });
    expect(res.status).toBe(409);
  });

  it('only photo-shaped names are served', async () => {
    expect((await t.http().get('/photos/garden.db')).status).toBe(404);
  });

  it('a photo left in the trash folder by a failed move is put back when the app starts', async () => {
    const { body: photo } = await upload();
    fs.mkdirSync(path.join(t.dataDir, 'photos', '_trash'), { recursive: true });
    fs.renameSync(live(photo.filename), trashed(photo.filename));
    t.ctx.db.close();
    const again = makeTestContext({ dataDir: t.dataDir });
    expect(fs.existsSync(live(photo.filename))).toBe(true);
    again.ctx.db.close();
    t.ctx.db = again.ctx.db;
  });

  it('a file that will not move does not stop the delete', async () => {
    const { body: photo } = await upload();
    const real = fs.renameSync;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from).endsWith(photo.filename)) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; }
      return real(from, to);
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await t.http().delete(`/api/spaces/${space.id}`);
    spy.mockRestore();
    logged.mockRestore();
    expect(res.status).toBe(200);
    expect(t.ctx.db.prepare('SELECT deleted_at FROM photos WHERE id = ?').get(photo.id).deleted_at).not.toBeNull();
    expect((await t.http().post(`/api/trash/space/${space.id}/restore`)).status).toBe(200);
    expect(fs.existsSync(live(photo.filename))).toBe(true);
  });
});
