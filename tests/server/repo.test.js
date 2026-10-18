import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../server/db/connection.js';
import { createRepo, VersionConflict } from '../../server/db/repo.js';

let dir, db, repo;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-repo-'));
  db = openDb(dir);
  repo = createRepo(db, 'places', ['name', 'notes', 'zone', 'sort_order'], { orderBy: 'sort_order, id' });
});
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('versioned repo', () => {
  it('creates rows at version 1', () => {
    expect(repo.create({ name: 'Eclectic' })).toMatchObject({ name: 'Eclectic', version: 1, deleted_at: null });
  });
  it('updates with the right version and bumps it', () => {
    const a = repo.create({ name: 'A' });
    expect(repo.update(a.id, { name: 'B' }, 1)).toMatchObject({ name: 'B', version: 2 });
  });
  it('refuses a stale version and hands back the current row', () => {
    const a = repo.create({ name: 'A' });
    repo.update(a.id, { name: 'B' }, 1);
    let err;
    try { repo.update(a.id, { name: 'C' }, 1); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(VersionConflict);
    expect(err.current).toMatchObject({ name: 'B', version: 2 });
    expect(repo.get(a.id).name).toBe('B');
  });
  it('requires a version on update', () => {
    const a = repo.create({ name: 'A' });
    expect(() => repo.update(a.id, { name: 'B' })).toThrow(TypeError);
  });
  it('returns null when updating a missing or deleted row', () => {
    const a = repo.create({ name: 'A' });
    repo.remove(a.id);
    expect(repo.update(a.id, { name: 'B' }, 2)).toBeNull();
    expect(repo.update(999, { name: 'B' }, 1)).toBeNull();
  });
  it('soft-deletes, lists the Trash, and restores', () => {
    const a = repo.create({ name: 'A' });
    expect(repo.remove(a.id)).toBe(true);
    expect(repo.list()).toEqual([]);
    expect(repo.listDeleted().map(r => r.id)).toEqual([a.id]);
    expect(repo.restore(a.id)).toBe(true);
    expect(repo.get(a.id)).toMatchObject({ deleted_at: null, version: 3 });
  });
  it('purges only rows already in the Trash', () => {
    const a = repo.create({ name: 'A' });
    expect(repo.purge(a.id)).toBe(false);
    repo.remove(a.id);
    expect(repo.purge(a.id)).toBe(true);
    expect(repo.get(a.id, { includeDeleted: true })).toBeNull();
  });
  it('maps rows on the way out and data on the way in', () => {
    const r = createRepo(db, 'places', ['name', 'wet_months'], {
      fromRow: row => ({ ...row, wet_months: JSON.parse(row.wet_months) }),
      toRow: d => (d.wet_months ? { ...d, wet_months: JSON.stringify(d.wet_months) } : d),
    });
    const a = r.create({ name: 'A', wet_months: [6, 7] });
    expect(a.wet_months).toEqual([6, 7]);
    expect(r.update(a.id, { wet_months: [8] }, 1).wet_months).toEqual([8]);
    expect(r.list()[0].wet_months).toEqual([8]);
    expect(db.prepare('SELECT wet_months FROM places').get().wet_months).toBe('[8]');
  });
});
