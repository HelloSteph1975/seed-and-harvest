import { transaction } from '../db/connection.js';
import { NOW } from '../db/migrations.js';
import { repos } from '../db/repos.js';
import { VersionConflict } from '../db/repo.js';
import { HttpError, notFound, notInTrash } from '../http.js';
import { validate } from '../validate.js';
import { addErrors, collector, invalid, monthList, textList } from './fields.js';
import { cascadeDeletePhotos, cascadeRestorePhotos, purgeOwnerPhotos } from './photos.js';
import { livePlantingCount, purgePlantingsWhere } from './plantings.js';
import { liveTrayCount, purgeTraysWhere } from './trays.js';

export const PLANT_KINDS = ['vegetable', 'herb', 'microgreen', 'fruit_tree', 'shrub', 'vine'];
export const SAFETY = ['safe', 'small', 'avoid'];
const WEEKS = { type: 'int', min: -26, max: 26 };

export const PLANT_SCHEMA = {
  name: { type: 'string!', maxLength: 80 },
  latin_name: { type: 'string', maxLength: 120 },
  kind: { type: PLANT_KINDS, required: true },
  family: { type: 'string', maxLength: 80 },
  summary: { type: 'string', maxLength: 600 },
  sun: ['full', 'part', 'shade'],
  water: ['low', 'medium', 'high'],
  spacing_cm: { type: 'number', min: 0, max: 5000 },
  container_liters: { type: 'number', min: 0, max: 100000 },
  container_ok: 'bool',
  greenhouse_notes: { type: 'string', maxLength: 2000 },
  zone_min: { type: 'int', min: 1, max: 13 },
  zone_max: { type: 'int', min: 1, max: 13 },
  perennial: 'bool',
  start_indoors_min: WEEKS, start_indoors_max: WEEKS,
  transplant_min: WEEKS, transplant_max: WEEKS,
  sow_min: WEEKS, sow_max: WEEKS,
  fall_sow_min: WEEKS, fall_sow_max: WEEKS,
  days_min: { type: 'int', min: 1, max: 730 }, days_max: { type: 'int', min: 1, max: 730 },
  years_min: { type: 'int', min: 0, max: 30 }, years_max: { type: 'int', min: 0, max: 30 },
  yield_kg: { type: 'number', min: 0, max: 10000 },
  yield_per: ['plant', 'meter'],
  problems: { type: 'string', maxLength: 4000 },
  notes: { type: 'string', maxLength: 4000 },
  soak_hours: { type: 'number', min: 0, max: 72 },
  seed_g_per_tray: { type: 'number', min: 0, max: 5000 },
  safety_goats: SAFETY,
  safety_chickens: SAFETY,
};

// Pairs whose first value must not be above the second.
const RANGES = [['start_indoors_min', 'start_indoors_max'], ['transplant_min', 'transplant_max'], ['sow_min', 'sow_max'],
  ['fall_sow_min', 'fall_sow_max'], ['days_min', 'days_max'], ['years_min', 'years_max'], ['zone_min', 'zone_max']];
const MICROGREEN_ONLY = ['soak_hours', 'seed_g_per_tray', 'safety_goats', 'safety_chickens'];
const PRESERVE_MAX = 10;

function preservesOf(v, c) {
  if (v === undefined) return undefined;
  if (v === null) return [];
  const ok = Array.isArray(v) && v.length <= PRESERVE_MAX && v.every(p => p && typeof p === 'object'
    && typeof p.form === 'string' && p.form.trim() && p.form.trim().length <= 80
    && typeof p.unit === 'string' && p.unit.trim() && p.unit.trim().length <= 40
    && typeof p.raw_kg === 'number' && Number.isFinite(p.raw_kg) && p.raw_kg > 0 && p.raw_kg <= 1000);
  if (!ok) { c.fail('preserves', 'Each preserving amount needs a name, a unit and a weight above 0', 'bad_format'); return undefined; }
  return v.map(p => ({ form: p.form.trim(), unit: p.unit.trim(), raw_kg: p.raw_kg }));
}

// Ratings for animals of kind "other" (goats and chickens have their own plant fields). Undefined when absent.
function animalSafetyOf(db, v, c) {
  if (v === undefined) return undefined;
  if (v === null) return [];
  const ok = Array.isArray(v) && v.length <= 50 && v.every(x => x && Number.isInteger(x.animal_id) && SAFETY.includes(x.safety))
    && new Set(v.map(x => x.animal_id)).size === v.length;
  if (!ok) { c.fail('animal_safety', 'Each rating needs one of your other animals and safe, small or avoid', 'bad_format'); return undefined; }
  // A rating for an animal that is gone or is now a goat or chicken is left out.
  return v.filter(x => db.prepare("SELECT 1 FROM animals WHERE id = ? AND kind = 'other'").get(x.animal_id))
    .map(x => ({ animal_id: x.animal_id, safety: x.safety }));
}

function parse(body, existing, db) {
  const c = collector();
  const src = body ?? {};
  const r = validate(PLANT_SCHEMA, src, { partial: Boolean(existing) });
  addErrors(c, r);
  const data = { ...(r.data ?? {}) };
  const months = monthList(src.frost_free_months, 'frost_free_months', c);
  if (months !== undefined) data.frost_free_months = months;
  for (const key of ['companions', 'avoid']) {
    const list = textList(src[key], key, c);
    if (list !== undefined) data[key] = list;
  }
  const preserves = preservesOf(src.preserves, c);
  let animalSafety = db ? animalSafetyOf(db, src.animal_safety, c) : undefined;
  if (c.any()) throw invalid(c.errors, c.codes);
  const merged = { ...existing, ...data };
  for (const [lo, hi] of RANGES) {
    if (merged[lo] != null && merged[hi] != null && merged[lo] > merged[hi]) c.fail(hi, 'This must not be below the first number', 'range_order');
  }
  if (c.any()) throw invalid(c.errors, c.codes);
  if ((data.kind ?? existing?.kind) !== 'microgreen') {
    for (const k of MICROGREEN_ONLY) data[k] = null;
    animalSafety = [];
  }
  return { data, preserves, animalSafety };
}

const listOf = (db, sql, id) => db.prepare(sql).all(id);
export const preservesFor = (db, id) => listOf(db, 'SELECT form, unit, raw_kg FROM plant_preserves WHERE plant_id = ? ORDER BY position', id);

export const animalSafetyFor = (db, id) => db.prepare('SELECT animal_id, safety FROM plant_animal_safety WHERE plant_id = ? ORDER BY animal_id').all(id);

function setAnimalSafety(db, id, list) {
  db.prepare('DELETE FROM plant_animal_safety WHERE plant_id = ?').run(id);
  const add = db.prepare('INSERT INTO plant_animal_safety (plant_id, animal_id, safety) VALUES (?, ?, ?)');
  for (const x of list) add.run(id, x.animal_id, x.safety);
}

function setPreserves(db, id, preserves) {
  db.prepare('DELETE FROM plant_preserves WHERE plant_id = ?').run(id);
  const add = db.prepare('INSERT INTO plant_preserves (plant_id, position, form, unit, raw_kg) VALUES (?, ?, ?, ?, ?)');
  preserves.forEach((p, i) => add.run(id, i + 1, p.form, p.unit, p.raw_kg));
}

const cover = `(SELECT filename FROM photos ph WHERE ph.owner_type = 'plant' AND ph.owner_id = p.id AND ph.deleted_at IS NULL
  ORDER BY ph.is_cover DESC, ph.sort_order, ph.id LIMIT 1)`;
export const fold = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function listPlants(db, { kind, q } = {}) {
  if (kind !== undefined && !PLANT_KINDS.includes(kind)) throw new HttpError(400, 'Unknown kind of plant', undefined, { code: 'not_one_of' });
  const rows = db.prepare(`SELECT p.id, p.name, p.latin_name, p.kind, p.summary, p.container_ok, p.zone_min, p.zone_max, p.perennial,
    p.starter_key, p.is_starter, ${cover} AS cover FROM plants p WHERE p.deleted_at IS NULL ${kind ? 'AND p.kind = ?' : ''}
    ORDER BY p.name COLLATE NOCASE, p.id`).all(...(kind ? [kind] : []));
  const words = fold(q ?? '').trim();
  return words ? rows.filter(p => [p.name, p.latin_name, p.summary].some(v => fold(v).includes(words))) : rows;
}

export function getPlant(db, id) {
  const p = repos(db).plants.get(id);
  if (!p) throw notFound();
  return {
    ...p,
    preserves: preservesFor(db, id),
    animal_safety: animalSafetyFor(db, id),
    varieties: listOf(db, 'SELECT * FROM plant_varieties WHERE plant_id = ? AND deleted_at IS NULL ORDER BY sort_order, name COLLATE NOCASE, id', id),
    guides: listOf(db, `SELECT id, title, stage, starter_key, is_starter FROM guides WHERE plant_id = ? AND deleted_at IS NULL
      ORDER BY sort_order, id`, id),
  };
}

export function createPlant(db, body) {
  return transaction(db, () => {
    const { data, preserves, animalSafety } = parse(body, null, db);
    const row = repos(db).plants.create(data);
    if (preserves) setPreserves(db, row.id, preserves);
    if (animalSafety) setAnimalSafety(db, row.id, animalSafety);
    return getPlant(db, row.id);
  });
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function updatePlant(db, id, body, version) {
  return transaction(db, () => {
    const existing = repos(db).plants.get(id);
    if (!existing) throw notFound();
    const { data, preserves, animalSafety } = parse(body, existing, db);
    // A save that changes nothing keeps the Starter tag. Ratings for the owner's own animals are
    // theirs alone, so they never drop it.
    const changed = Object.keys(data).some(k => !same(data[k], existing[k])) || (preserves && !same(preserves, preservesFor(db, id)));
    if (existing.is_starter && changed) data.is_starter = 0;
    let row;
    try { row = repos(db).plants.update(id, data, version); } catch (err) {
      if (err instanceof VersionConflict) throw new VersionConflict(getPlant(db, id));
      throw err;
    }
    if (!row) throw notFound();
    if (preserves) setPreserves(db, id, preserves);
    if (animalSafety) setAnimalSafety(db, id, animalSafety);
    return getPlant(db, id);
  });
}

// The plant's live varieties and guides (and its photos) go to the Trash with it, with the same
// deleted time, so they come back together.
export function deletePlant(ctx, id) {
  const { db } = ctx;
  transaction(db, () => {
    const stamp = new Date().toISOString();
    const n = livePlantingCount(db, id) + liveTrayCount(db, id);
    if (n > 0) throw new HttpError(409, 'This plant has plantings or trays. Delete those first.', undefined, { code: 'plant_in_use', vars: { n } });
    if (!repos(db).plants.remove(id, stamp)) throw notFound();
    db.prepare('UPDATE plant_varieties SET deleted_at = ?, version = version + 1 WHERE plant_id = ? AND deleted_at IS NULL').run(stamp, id);
    db.prepare('UPDATE guides SET deleted_at = ?, version = version + 1 WHERE plant_id = ? AND deleted_at IS NULL').run(stamp, id);
    cascadeDeletePhotos(ctx, 'plant', id, stamp);
  });
}

export function restorePlant(ctx, id) {
  const { db } = ctx;
  return transaction(db, () => {
    const row = repos(db).plants.get(id, { includeDeleted: true });
    if (!row || !row.deleted_at) throw notInTrash();
    repos(db).plants.restore(id);
    for (const table of ['plant_varieties', 'guides']) {
      db.prepare(`UPDATE ${table} SET deleted_at = NULL, version = version + 1, updated_at = ${NOW} WHERE plant_id = ? AND deleted_at = ?`).run(id, row.deleted_at);
    }
    cascadeRestorePhotos(ctx, 'plant', id, row.deleted_at);
    return repos(db).plants.get(id);
  });
}

const forget = (db, key) => { if (key) db.prepare('INSERT OR IGNORE INTO starter_removed (starter_key) VALUES (?)').run(key); };

// Children still in the Trash go first, so nothing is left pointing at a missing plant. Any row that
// came from starter content (edited or not) is remembered, so new starter content never brings it back.
export function purgePlant(ctx, row) {
  const { db } = ctx;
  purgePlantingsWhere(ctx, 'plant_id', row.id);
  purgeTraysWhere(ctx, 'plant_id', row.id);
  for (const g of db.prepare('SELECT id, starter_key FROM guides WHERE plant_id = ? AND deleted_at IS NOT NULL').all(row.id)) {
    forget(db, g.starter_key);
    db.prepare('UPDATE guides SET basics_id = NULL WHERE basics_id = ?').run(g.id);
    db.prepare('UPDATE tasks SET guide_id = NULL WHERE guide_id = ?').run(g.id);
    db.prepare('DELETE FROM guides WHERE id = ?').run(g.id);
  }
  db.prepare('UPDATE plantings SET variety_id = NULL WHERE variety_id IN (SELECT id FROM plant_varieties WHERE plant_id = ? AND deleted_at IS NOT NULL)').run(row.id);
  db.prepare('DELETE FROM plant_varieties WHERE plant_id = ? AND deleted_at IS NOT NULL').run(row.id);
  purgeOwnerPhotos(ctx, 'plant', row.id);
  forget(db, row.starter_key);
  repos(db).plants.purge(row.id);
}

// Varieties ---------------------------------------------------------------------------------

export const VARIETY_SCHEMA = {
  name: { type: 'string!', maxLength: 80 },
  days: { type: 'int', min: 1, max: 730 },
  notes: { type: 'string', maxLength: 2000 },
  sort_order: { type: 'int', min: 0, max: 10000 },
};

const livePlant = (db, id) => Boolean(db.prepare('SELECT 1 FROM plants WHERE id = ? AND deleted_at IS NULL').get(id));

export function createVariety(db, plantId, body) {
  return transaction(db, () => {
    if (!livePlant(db, plantId)) throw notFound();
    const r = validate(VARIETY_SCHEMA, body ?? {});
    if (r.errors) throw invalid(r.errors, r.codes);
    return repos(db).varieties.create({ ...r.data, plant_id: plantId });
  });
}

export function updateVariety(db, id, body, version) {
  return transaction(db, () => {
    const r = validate(VARIETY_SCHEMA, body ?? {}, { partial: true });
    if (r.errors) throw invalid(r.errors, r.codes);
    const row = repos(db).varieties.update(id, r.data, version);
    if (!row) throw notFound();
    return row;
  });
}

export function deleteVariety(db, id) {
  transaction(db, () => { if (!repos(db).varieties.remove(id)) throw notFound(); });
}

export function purgeVariety(ctx, row) {
  ctx.db.prepare('UPDATE plantings SET variety_id = NULL WHERE variety_id = ?').run(row.id);
  repos(ctx.db).varieties.purge(row.id);
}

export function restoreVariety(ctx, id) {
  const { db } = ctx;
  return transaction(db, () => {
    const row = repos(db).varieties.get(id, { includeDeleted: true });
    if (!row || !row.deleted_at) throw notInTrash();
    if (!livePlant(db, row.plant_id)) throw new HttpError(409, 'Restore its plant first.', undefined, { code: 'parent_in_trash' });
    repos(db).varieties.restore(id);
    return repos(db).varieties.get(id);
  });
}
