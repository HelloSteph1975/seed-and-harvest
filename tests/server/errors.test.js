import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTestContext } from './helpers.js';

let t;
afterEach(() => t?.cleanup());

describe('error codes', () => {
  it('sends field codes with a 400', async () => {
    t = makeTestContext();
    const res = await t.http().post('/api/places').send({ name: '', zone: 'red' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid');
    expect(res.body.detailCodes).toEqual({ name: { code: 'required' }, zone: { code: 'bad_format', hint: 'zone' } });
    expect(res.body.details.name).toBe('Required');
  });
  it('sends too_long with its limit', async () => {
    t = makeTestContext();
    const res = await t.http().post('/api/places').send({ name: 'x'.repeat(81) });
    expect(res.body.detailCodes.name).toEqual({ code: 'too_long', max: 80 });
  });
  it('sends not_found, missing_version and conflict', async () => {
    t = makeTestContext();
    expect((await t.http().get('/api/places/999')).body.code).toBe('not_found');
    const { body: a } = await t.http().post('/api/places').send({ name: 'A' });
    expect((await t.http().patch(`/api/places/${a.id}`).send({ name: 'B' })).body.code).toBe('missing_version');
    await t.http().patch(`/api/places/${a.id}`).send({ version: 1, name: 'B' });
    const stale = await t.http().patch(`/api/places/${a.id}`).send({ version: 1, name: 'C' });
    expect(stale.body).toMatchObject({ code: 'conflict', current: { name: 'B' } });
  });
  it('sends unknown_kind and not_in_trash', async () => {
    t = makeTestContext();
    expect((await t.http().post('/api/trash/nope/1/restore')).body.code).toBe('unknown_kind');
    const { body: a } = await t.http().post('/api/places').send({ name: 'Alive' });
    expect((await t.http().delete(`/api/trash/place/${a.id}`)).body.code).toBe('not_in_trash');
  });
  it('sends restored for a write from before a restore', async () => {
    t = makeTestContext();
    const res = await t.http().post('/api/places').set('X-Garden-Epoch', 'old').send({ name: 'X' });
    expect(res.body).toMatchObject({ code: 'restored', restored: true });
  });
  it('sends bad_id for a bad id', async () => {
    t = makeTestContext();
    expect((await t.http().get('/api/places/abc')).body.code).toBe('bad_id');
  });
  it('keeps the explicit code and message of a 500 it raised on purpose', async () => {
    t = makeTestContext();
    const { body: b } = await t.http().post('/api/backups');
    // Another program's log file appears once our connection closes.
    const close = t.ctx.db.close.bind(t.ctx.db);
    t.ctx.db.close = () => { close(); fs.writeFileSync(path.join(t.dataDir, 'garden.db-wal'), ''); };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await t.http().post('/api/backups/restore').send({ name: b.name });
    logged.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('in_use');
    expect(res.body.error).toMatch(/in use by another program/);
  });
  it('sends server_error and the generic message for an unexpected error', async () => {
    t = makeTestContext();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(t.ctx.db, 'prepare').mockImplementation(() => { throw new Error('secret detail'); });
    const res = await t.http().get('/api/places');
    logged.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: 'server_error', error: 'Something went wrong on our side.' });
  });
});
