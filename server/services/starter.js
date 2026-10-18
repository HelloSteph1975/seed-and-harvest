import fs from 'node:fs';
import path from 'node:path';
import { transaction } from '../db/connection.js';
import { NOW } from '../db/migrations.js';

export const CONTENT_DIR = path.join(import.meta.dirname, '..', 'content');

export const readJson = (dir, rel) => {
  const file = path.join(dir, rel);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
};

// Every entry of every .json file in a content subfolder, files in name order.
export function readFolder(dir, sub) {
  const folder = path.join(dir, sub);
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder).filter(f => f.endsWith('.json')).sort().flatMap(f => readJson(dir, `${sub}/${f}`));
}

// Seeds one simple table from a list of starter rows. Skips rows already here (edited or in the
// Trash) and rows the owner deleted forever. Returns how many rows were added.
export function seedSimple(db, table, columns, rows) {
  const removed = db.prepare('SELECT 1 FROM starter_removed WHERE starter_key = ?');
  const exists = db.prepare(`SELECT 1 FROM ${table} WHERE starter_key = ?`);
  const cols = [...columns, 'starter_key', 'is_starter', 'content_version'];
  const insert = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
  let added = 0;
  for (const e of rows) {
    if (exists.get(e.starter_key) || removed.get(e.starter_key)) continue;
    insert.run(...columns.map(c => e[c] ?? null), e.starter_key, 1, e.content_version ?? 1);
    added++;
  }
  return added;
}

// Plants -----------------------------------------------------------------------------------

const RANGE_FIELDS = ['start_indoors', 'transplant', 'sow', 'fall_sow', 'days', 'years'];

// A content entry as plant columns: [min, max] ranges split in two, flags as 0/1, lists as JSON.
export function plantColumns(e) {
  const out = {
    name: e.name, latin_name: e.latin_name ?? null, kind: e.kind, family: e.family ?? null, summary: e.summary ?? null,
    sun: e.sun ?? null, water: e.water ?? null, spacing_cm: e.spacing_cm ?? null, container_liters: e.container_liters ?? null,
    container_ok: e.container_ok ? 1 : 0, greenhouse_notes: e.greenhouse_notes ?? null, perennial: e.perennial ? 1 : 0,
    zone_min: Array.isArray(e.zones) ? e.zones[0] : null, zone_max: Array.isArray(e.zones) ? e.zones[1] : null,
    frost_free_months: JSON.stringify(e.frost_free_months ?? []), yield_kg: e.yield_kg ?? null, yield_per: e.yield_per ?? null,
    companions: JSON.stringify(e.companions ?? []), avoid: JSON.stringify(e.avoid ?? []), problems: e.problems ?? null, notes: e.notes ?? null,
    soak_hours: e.soak_hours ?? null, seed_g_per_tray: e.seed_g_per_tray ?? null,
    safety_goats: e.safety_goats ?? null, safety_chickens: e.safety_chickens ?? null,
  };
  for (const f of RANGE_FIELDS) {
    out[`${f}_min`] = Array.isArray(e[f]) ? e[f][0] : null;
    out[`${f}_max`] = Array.isArray(e[f]) ? e[f][1] : null;
  }
  return out;
}

function setPreserves(db, id, preserves = []) {
  db.prepare('DELETE FROM plant_preserves WHERE plant_id = ?').run(id);
  const add = db.prepare('INSERT INTO plant_preserves (plant_id, position, form, unit, raw_kg) VALUES (?, ?, ?, ?, ?)');
  preserves.forEach((p, i) => add.run(id, i + 1, p.form, p.unit, p.raw_kg));
}

function setGuideChildren(db, id, steps = [], supplies = []) {
  db.prepare('DELETE FROM guide_steps WHERE guide_id = ?').run(id);
  db.prepare('DELETE FROM guide_supplies WHERE guide_id = ?').run(id);
  const step = db.prepare('INSERT INTO guide_steps (guide_id, position, text) VALUES (?, ?, ?)');
  steps.forEach((s, i) => step.run(id, i + 1, s));
  const supply = db.prepare('INSERT INTO guide_supplies (guide_id, position, name, amount) VALUES (?, ?, ?, ?)');
  supplies.forEach((s, i) => supply.run(id, i + 1, s.name, s.amount ?? null));
}

const isRemoved = (db, key) => Boolean(db.prepare('SELECT 1 FROM starter_removed WHERE starter_key = ?').get(key));
const rowOf = (db, table, key) => db.prepare(`SELECT id, deleted_at, is_starter, content_version FROM ${table} WHERE starter_key = ?`).get(key);

function insertRow(db, table, cols) {
  const keys = Object.keys(cols);
  const r = db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map(k => cols[k]));
  return Number(r.lastInsertRowid);
}

function updateRow(db, table, id, cols, contentVersion) {
  const keys = Object.keys(cols);
  db.prepare(`UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(', ')}, content_version = ?, version = version + 1, updated_at = ${NOW} WHERE id = ?`)
    .run(...keys.map(k => cols[k]), contentVersion, id);
}

const starterOf = e => ({ starter_key: e.starter_key, is_starter: 1, content_version: e.content_version ?? 1 });
// Newer file content goes onto rows that are still untouched starters and not in the Trash.
const stale = (row, e) => row.is_starter === 1 && !row.deleted_at && row.content_version < (e.content_version ?? 1);

function seedPlants(db, entries) {
  let added = 0;
  for (const e of entries) {
    const row = rowOf(db, 'plants', e.starter_key);
    if (!row) {
      if (isRemoved(db, e.starter_key)) continue;
      const id = insertRow(db, 'plants', { ...plantColumns(e), ...starterOf(e) });
      setPreserves(db, id, e.preserves);
      added++;
    } else if (stale(row, e)) {
      updateRow(db, 'plants', row.id, plantColumns(e), e.content_version ?? 1);
      setPreserves(db, row.id, e.preserves);
    }
  }
  return added;
}

function guideColumns(db, e) {
  const plant = e.plant ? rowOf(db, 'plants', e.plant) : null;
  const basics = e.basics ? rowOf(db, 'guides', e.basics) : null;
  return { cols: { title: e.title, summary: e.summary ?? null, stage: e.stage, plant_id: plant?.id ?? null, basics_id: basics?.id ?? null }, plant };
}

// Basics guides first, so plant guides can link to them. A plant guide whose plant is missing is
// skipped; one whose plant is in the Trash goes in with the plant's deleted time.
function seedGuides(db, entries) {
  let added = 0;
  const ordered = [...entries.filter(e => !e.plant), ...entries.filter(e => e.plant)];
  for (const e of ordered) {
    const row = rowOf(db, 'guides', e.starter_key);
    const { cols, plant } = guideColumns(db, e);
    if (e.plant && !plant) continue;
    if (!row) {
      if (isRemoved(db, e.starter_key)) continue;
      const id = insertRow(db, 'guides', { ...cols, ...starterOf(e), deleted_at: plant?.deleted_at ?? null });
      setGuideChildren(db, id, e.steps, e.supplies);
      added++;
    } else if (stale(row, e)) {
      updateRow(db, 'guides', row.id, cols, e.content_version ?? 1);
      setGuideChildren(db, row.id, e.steps, e.supplies);
    }
  }
  return added;
}

// Tops up starter content. Never re-adds anything that exists (edited or in the Trash) or was
// deleted forever. Updates only untouched starter rows whose content_version went up.
// Returns the number of plants and guides added.
export function seedStarter(db, { content = CONTENT_DIR } = {}) {
  return transaction(db, () => seedPlants(db, readFolder(content, 'plants')) + seedGuides(db, readFolder(content, 'guides')));
}
