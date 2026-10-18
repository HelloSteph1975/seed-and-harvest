import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTestContext } from './helpers.js';
import { emptyTrash } from '../../server/services/trash.js';
import { backupNow, listBackups } from '../../server/services/backup.js';

let t;
beforeEach(() => { t = makeTestContext(); });
afterEach(() => t.cleanup());

const addAndDelete = async name => {
  const { body } = await t.http().post('/api/places').send({ name });
  await t.http().delete(`/api/places/${body.id}`);
  return body.id;
};

describe('/api/trash', () => {
  it('lists deleted records with type, title and date', async () => {
    const id = await addAndDelete('Old path');
    const res = await t.http().get('/api/trash');
    expect(res.body).toEqual([{ type: 'place', id, title: 'Old path', deleted_at: expect.any(String), starter_key: null }]);
  });
  it('restores from the Trash', async () => {
    const id = await addAndDelete('Back again');
    const res = await t.http().post(`/api/trash/place/${id}/restore`);
    expect(res.body).toMatchObject({ id, deleted_at: null });
    expect((await t.http().get('/api/trash')).body).toEqual([]);
  });
  it('deletes one record forever', async () => {
    const id = await addAndDelete('Gone');
    expect((await t.http().delete(`/api/trash/place/${id}`)).body).toEqual({ ok: true });
    expect((await t.http().get('/api/trash')).body).toEqual([]);
    expect((await t.http().post(`/api/places/${id}/restore`)).status).toBe(404);
  });
  it('will not delete forever a record that is not in the Trash', async () => {
    const { body } = await t.http().post('/api/places').send({ name: 'Alive' });
    expect((await t.http().delete(`/api/trash/place/${body.id}`)).status).toBe(404);
  });
  it('rejects unknown types', async () => {
    const restore = await t.http().post('/api/trash/nope/1/restore');
    expect(restore.status).toBe(404);
    expect(restore.body.error).toBe('Unknown kind of record');
    const purge = await t.http().delete('/api/trash/nope/1');
    expect(purge.status).toBe(404);
    expect(purge.body.error).toBe('Unknown kind of record');
  });
  it('empties the Trash after making a pre-empty backup', async () => {
    await addAndDelete('One');
    await addAndDelete('Two');
    const res = await t.http().post('/api/trash/empty');
    expect(res.body.removed).toBe(2);
    expect(res.body.backup).toMatch(/^pre-empty-/);
    expect((await t.http().get('/api/trash')).body).toEqual([]);
  });
  it('keeps 30 backups after emptying, including the pre-empty one', async () => {
    for (let i = 0; i < 30; i++) backupNow(t.ctx.db, t.dataDir, { now: new Date(2026, 0, 1 + i, 9, 0) });
    await addAndDelete('One');
    const discarded = [];
    const out = emptyTrash(t.ctx, { discard: f => { discarded.push(path.basename(f)); fs.rmSync(f); } });
    expect(discarded).toEqual(['garden-2026-01-01-0900.db']);
    const left = listBackups(t.dataDir).map(b => b.name);
    expect(left).toHaveLength(30);
    expect(left).toContain(out.backup);
  });
  it('logs a failed rotation after emptying and still empties the Trash', async () => {
    for (let i = 0; i < 30; i++) backupNow(t.ctx.db, t.dataDir, { now: new Date(2026, 0, 1 + i, 9, 0) });
    await addAndDelete('One');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = emptyTrash(t.ctx, { discard: () => { throw new Error('locked'); } });
    expect(out.removed).toBe(1);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
