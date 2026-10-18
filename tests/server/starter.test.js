import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTestContext, BASE_CONTENT } from './helpers.js';
import { seedStarter } from '../../server/services/starter.js';

let t;
let dirs = [];
beforeEach(() => { t = makeTestContext(); });
afterEach(() => { t.cleanup(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); dirs = []; });

const byKey = (table, key) => t.ctx.db.prepare(`SELECT * FROM ${table} WHERE starter_key = ?`).get(key);

// A copy of the fixture content with one file's entries changed.
function contentWith(change) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-content-'));
  dirs.push(dir);
  fs.cpSync(BASE_CONTENT, dir, { recursive: true });
  for (const [rel, edit] of Object.entries(change)) {
    const file = path.join(dir, rel);
    fs.writeFileSync(file, JSON.stringify(edit(JSON.parse(fs.readFileSync(file, 'utf8')))));
  }
  return dir;
}

describe('starter content', () => {
  it('seeds plants, basics guides and plant guides with their links', async () => {
    const tomato = byKey('plants', 'plant.test-tomato');
    expect(tomato).toMatchObject({ name: 'Test tomato', start_indoors_min: 6, start_indoors_max: 8, transplant_min: 1, days_max: 85,
      container_ok: 1, is_starter: 1, content_version: 1 });
    const full = (await t.http().get(`/api/plants/${tomato.id}`)).body;
    expect(full.companions).toEqual(['plant.test-basil']);
    expect(full.preserves).toEqual([{ form: 'Quart of sauce', unit: 'quart', raw_kg: 4.5 }]);
    expect(full.guides.map(g => g.title)).toEqual(['Fixture: starting tomatoes']);
    const guide = (await t.http().get(`/api/guides/${full.guides[0].id}`)).body;
    expect(guide.basics).toMatchObject({ title: 'Fixture: starting seeds', live: true });
    expect(guide.steps).toEqual(['Sow 6 mm deep.']);
  });

  it('seeding twice adds nothing', () => {
    expect(seedStarter(t.ctx.db, { content: BASE_CONTENT })).toBe(0);
  });

  it('never re-adds an edited, trashed or deleted-forever starter row', async () => {
    const basil = byKey('plants', 'plant.test-basil');
    await t.http().delete(`/api/plants/${basil.id}`);
    expect(seedStarter(t.ctx.db, { content: BASE_CONTENT })).toBe(0);
    await t.http().delete(`/api/trash/plant/${basil.id}`);
    expect(seedStarter(t.ctx.db, { content: BASE_CONTENT })).toBe(0);
    expect(byKey('plants', 'plant.test-basil')).toBeUndefined();
  });

  it('updates an untouched starter row whose content_version went up, children included', () => {
    const dir = contentWith({
      'plants/test.json': rows => rows.map(r => (r.starter_key === 'plant.test-tomato'
        ? { ...r, content_version: 2, summary: 'Newer words.', preserves: [{ form: 'Pint of salsa', unit: 'pint', raw_kg: 1.2 }] } : r)),
      'guides/test.json': rows => rows.map(r => (r.starter_key === 'guide.test-tomato.start_indoors' ? { ...r, content_version: 2, steps: ['Sow 5 mm deep.', 'Keep warm.'] } : r)),
    });
    seedStarter(t.ctx.db, { content: dir });
    const tomato = byKey('plants', 'plant.test-tomato');
    expect(tomato).toMatchObject({ summary: 'Newer words.', content_version: 2, version: 2 });
    expect(t.ctx.db.prepare('SELECT form FROM plant_preserves WHERE plant_id = ?').all(tomato.id).map(r => r.form)).toEqual(['Pint of salsa']);
    const g = byKey('guides', 'guide.test-tomato.start_indoors');
    expect(t.ctx.db.prepare('SELECT text FROM guide_steps WHERE guide_id = ? ORDER BY position').all(g.id).map(r => r.text)).toEqual(['Sow 5 mm deep.', 'Keep warm.']);
  });

  it('does not update a starter row the owner edited', async () => {
    const tomato = byKey('plants', 'plant.test-tomato');
    await t.http().patch(`/api/plants/${tomato.id}`).send({ version: tomato.version, summary: 'My words.' });
    const dir = contentWith({ 'plants/test.json': rows => rows.map(r => (r.starter_key === 'plant.test-tomato' ? { ...r, content_version: 2, summary: 'Newer words.' } : r)) });
    seedStarter(t.ctx.db, { content: dir });
    expect(byKey('plants', 'plant.test-tomato').summary).toBe('My words.');
  });

  it('a plant guide whose plant is in the Trash is seeded into the Trash with it', async () => {
    const tomato = byKey('plants', 'plant.test-tomato');
    await t.http().delete(`/api/plants/${tomato.id}`);
    const dir = contentWith({ 'guides/test.json': rows => [...rows, { starter_key: 'guide.test-tomato.harvest', content_version: 1, title: 'Fixture: harvest',
      stage: 'harvest', plant: 'plant.test-tomato', basics: null, steps: ['Pick when red.'], supplies: [] }] });
    seedStarter(t.ctx.db, { content: dir });
    const g = byKey('guides', 'guide.test-tomato.harvest');
    expect(g.deleted_at).toBe(byKey('plants', 'plant.test-tomato').deleted_at);
    await t.http().post(`/api/trash/plant/${tomato.id}/restore`);
    expect(byKey('guides', 'guide.test-tomato.harvest').deleted_at).toBeNull();
  });

  it('a starter plant the owner edited and then deleted forever stays gone', async () => {
    const tomato = byKey('plants', 'plant.test-tomato');
    await t.http().patch(`/api/plants/${tomato.id}`).send({ version: tomato.version, summary: 'My words.' });
    await t.http().delete(`/api/plants/${tomato.id}`);
    await t.http().delete(`/api/trash/plant/${tomato.id}`);
    expect(seedStarter(t.ctx.db, { content: BASE_CONTENT })).toBe(0);
    expect(byKey('plants', 'plant.test-tomato')).toBeUndefined();
    expect(byKey('guides', 'guide.test-tomato.start_indoors')).toBeUndefined();
  });

  it('a starter guide the owner edited and then deleted forever stays gone', async () => {
    const g = byKey('guides', 'guide.basics.test-start');
    await t.http().patch(`/api/guides/${g.id}`).send({ version: 1, title: 'My way' });
    await t.http().delete(`/api/guides/${g.id}`);
    await t.http().delete(`/api/trash/guide/${g.id}`);
    expect(seedStarter(t.ctx.db, { content: BASE_CONTENT })).toBe(0);
    expect(byKey('guides', 'guide.basics.test-start')).toBeUndefined();
  });
});
