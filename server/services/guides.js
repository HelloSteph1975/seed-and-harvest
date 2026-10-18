import { transaction } from '../db/connection.js';
import { repos } from '../db/repos.js';
import { HttpError, notFound, notInTrash } from '../http.js';
import { validate } from '../validate.js';
import { addErrors, collector, invalid } from './fields.js';

export const STAGES = ['start_indoors', 'transplant', 'sow_outdoors', 'container', 'greenhouse', 'care', 'harvest', 'preserve', 'microgreens', 'general'];
export const MAX_STEPS = 40;
export const MAX_SUPPLIES = 30;

export const GUIDE_SCHEMA = {
  title: { type: 'string!', maxLength: 120 },
  summary: { type: 'string', maxLength: 600 },
  plant_id: { type: 'int', min: 1 },
  basics_id: { type: 'int', min: 1 },
  stage: { type: STAGES, required: true },
  sort_order: { type: 'int', min: 0, max: 10000 },
};

function stepsOf(v, c, required) {
  if (v === undefined) { if (required) c.fail('steps', 'Add at least one step', 'required'); return undefined; }
  if (!Array.isArray(v) || !v.every(s => typeof s === 'string')) { c.fail('steps', 'Must be a list of text', 'not_text'); return undefined; }
  const list = v.map(s => s.trim()).filter(Boolean);
  if (!list.length) { c.fail('steps', 'Add at least one step', 'required'); return undefined; }
  if (list.length > MAX_STEPS) { c.fail('steps', `No more than ${MAX_STEPS}`, 'too_many', { max: MAX_STEPS }); return undefined; }
  if (list.some(s => s.length > 1000)) { c.fail('steps', 'Keep each step to 1000 characters or fewer', 'too_long', { max: 1000 }); return undefined; }
  return list;
}

function suppliesOf(v, c) {
  if (v === undefined) return undefined;
  if (v === null) return [];
  const ok = Array.isArray(v) && v.every(s => s && typeof s === 'object' && typeof s.name === 'string'
    && (s.amount == null || typeof s.amount === 'string'));
  if (!ok) { c.fail('supplies', 'Each supply needs a name', 'bad_format'); return undefined; }
  const list = v.map(s => ({ name: s.name.trim(), amount: s.amount?.trim() || null })).filter(s => s.name);
  if (list.length > MAX_SUPPLIES) { c.fail('supplies', `No more than ${MAX_SUPPLIES}`, 'too_many', { max: MAX_SUPPLIES }); return undefined; }
  if (list.some(s => s.name.length > 120 || (s.amount ?? '').length > 80)) { c.fail('supplies', 'Keep supplies short', 'too_long', { max: 120 }); return undefined; }
  return list;
}

const livePlant = (db, id) => Boolean(db.prepare('SELECT 1 FROM plants WHERE id = ? AND deleted_at IS NULL').get(id));

function parse(db, body, existing) {
  const c = collector();
  const src = body ?? {};
  const r = validate(GUIDE_SCHEMA, src, { partial: Boolean(existing) });
  addErrors(c, r);
  const data = { ...(r.data ?? {}) };
  const steps = stepsOf(src.steps, c, !existing);
  const supplies = suppliesOf(src.supplies, c);
  if (c.any()) throw invalid(c.errors, c.codes);
  if (data.plant_id != null && data.plant_id !== existing?.plant_id && !livePlant(db, data.plant_id)) {
    c.fail('plant_id', 'That plant is gone', 'plant_gone');
  }
  const merged = { ...existing, ...data };
  if (merged.basics_id != null && (Object.hasOwn(data, 'basics_id') || Object.hasOwn(data, 'plant_id'))) {
    const b = repos(db).guides.get(merged.basics_id, { includeDeleted: true });
    if (!b || b.plant_id != null || b.id === existing?.id) c.fail('basics_id', 'Pick one of the basics guides', 'not_basics');
  }
  if (c.any()) throw invalid(c.errors, c.codes);
  return { data, steps, supplies };
}

function setChildren(db, id, steps, supplies) {
  if (steps) {
    db.prepare('DELETE FROM guide_steps WHERE guide_id = ?').run(id);
    const add = db.prepare('INSERT INTO guide_steps (guide_id, position, text) VALUES (?, ?, ?)');
    steps.forEach((s, i) => add.run(id, i + 1, s));
  }
  if (supplies) {
    db.prepare('DELETE FROM guide_supplies WHERE guide_id = ?').run(id);
    const add = db.prepare('INSERT INTO guide_supplies (guide_id, position, name, amount) VALUES (?, ?, ?, ?)');
    supplies.forEach((s, i) => add.run(id, i + 1, s.name, s.amount));
  }
}

export const stepsFor = (db, id) => db.prepare('SELECT text FROM guide_steps WHERE guide_id = ? ORDER BY position').all(id).map(r => r.text);
export const suppliesFor = (db, id) => db.prepare('SELECT name, amount FROM guide_supplies WHERE guide_id = ? ORDER BY position').all(id);

export function getGuide(db, id) {
  const g = repos(db).guides.get(id);
  if (!g) throw notFound();
  const plant = g.plant_id == null ? null : db.prepare('SELECT id, name, starter_key, is_starter FROM plants WHERE id = ?').get(g.plant_id);
  const b = g.basics_id == null ? null : repos(db).guides.get(g.basics_id, { includeDeleted: true });
  return {
    ...g, steps: stepsFor(db, id), supplies: suppliesFor(db, id), plant,
    basics: b ? { id: b.id, title: b.title, live: !b.deleted_at, starter_key: b.starter_key, is_starter: b.is_starter } : null,
  };
}

export function listBasics(db) {
  return db.prepare(`SELECT id, title, summary, stage, starter_key, is_starter FROM guides
    WHERE plant_id IS NULL AND deleted_at IS NULL ORDER BY sort_order, title COLLATE NOCASE, id`).all();
}

export function createGuide(db, body) {
  return transaction(db, () => {
    const { data, steps, supplies } = parse(db, body, null);
    const row = repos(db).guides.create(data);
    setChildren(db, row.id, steps, supplies ?? []);
    return getGuide(db, row.id);
  });
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function updateGuide(db, id, body, version) {
  return transaction(db, () => {
    const existing = repos(db).guides.get(id);
    if (!existing) throw notFound();
    const { data, steps, supplies } = parse(db, body, existing);
    const changed = Object.keys(data).some(k => !same(data[k], existing[k]))
      || (steps && !same(steps, stepsFor(db, id))) || (supplies && !same(supplies, suppliesFor(db, id)));
    if (existing.is_starter && changed) data.is_starter = 0;
    const row = repos(db).guides.update(id, data, version);
    if (!row) throw notFound();
    setChildren(db, id, steps, supplies);
    return getGuide(db, id);
  });
}

export function deleteGuide(db, id) {
  transaction(db, () => { if (!repos(db).guides.remove(id)) throw notFound(); });
}

export function restoreGuide(ctx, id) {
  const { db } = ctx;
  return transaction(db, () => {
    const row = repos(db).guides.get(id, { includeDeleted: true });
    if (!row || !row.deleted_at) throw notInTrash();
    if (row.plant_id != null && !livePlant(db, row.plant_id)) throw new HttpError(409, 'Restore its plant first.', undefined, { code: 'parent_in_trash' });
    repos(db).guides.restore(id);
    return repos(db).guides.get(id);
  });
}

// Plant guides linking to it lose the link; steps and supplies go with it (foreign keys).
export function purgeGuide(ctx, row) {
  const { db } = ctx;
  if (row.starter_key) db.prepare('INSERT OR IGNORE INTO starter_removed (starter_key) VALUES (?)').run(row.starter_key);
  db.prepare('UPDATE guides SET basics_id = NULL WHERE basics_id = ?').run(row.id);
  repos(db).guides.purge(row.id);
}
