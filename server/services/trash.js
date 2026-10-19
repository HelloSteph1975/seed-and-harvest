import { repos } from '../db/repos.js';
import { transaction } from '../db/connection.js';
import { HttpError, notInTrash } from '../http.js';
import { backupNow, rotateQuietly } from './backup.js';
import { restorePlace, purgePlace } from './places.js';
import { restoreSpace, purgeSpace } from './spaces.js';
import { restorePhoto, purgePhoto } from './photos.js';
import { restorePlant, purgePlant, restoreVariety, purgeVariety } from './plants.js';
import { restoreGuide, purgeGuide } from './guides.js';
import { restorePlanting, purgePlanting } from './plantings.js';
import { restoreLogEntry, purgeLogEntry } from './plantingLog.js';
import { restoreTask, purgeTask } from './tasks.js';
import { restoreAnimal, purgeAnimal } from './animals.js';
import { restoreTray, purgeTray } from './trays.js';
import { restoreHarvest, purgeHarvest } from './harvests.js';
import { restoreGoal, purgeGoal } from './goals.js';

function recordRemoved(db, row) {
  if (row.starter_key) db.prepare('INSERT OR IGNORE INTO starter_removed (starter_key) VALUES (?)').run(row.starter_key);
}

function purgeRow(db, repo, row) {
  recordRemoved(db, row);
  repo.purge(row.id);
}

// Every kind of record that can be in the Trash. Later tasks add theirs here.
// Emptying the Trash goes in this order, so records go before the records they point at.
// `parentOf` names the record a row belongs to ("place:3"): one deleted with its parent (same
// deleted time) is counted on the parent's row instead of listed on its own.
// `restore(ctx, id)` and `purge(ctx, row)` replace the plain repo restore and purge.
export const TRASH_TYPES = {
  photo: { repo: db => repos(db).photos, title: row => row.caption || row.filename, restore: restorePhoto, purge: purgePhoto,
    parentOf: row => `${row.owner_type}:${row.owner_id}` },
  harvest: { repo: db => repos(db).harvests, title: (row, db) => plantOf(db, harvestPlant(db, row)).name,
    meta: (row, db) => { const p = plantOf(db, harvestPlant(db, row)); return { starter_key: p.is_starter ? p.starter_key : null, harvested_on: row.harvested_on }; },
    restore: restoreHarvest, purge: purgeHarvest, parentOf: row => (row.planting_id ? `planting:${row.planting_id}` : `tray:${row.tray_id}`) },
  goal: { repo: db => repos(db).goals, title: (row, db) => plantOf(db, row.plant_id).name,
    meta: (row, db) => { const p = plantOf(db, row.plant_id); return { starter_key: p.is_starter ? p.starter_key : null, year: row.year }; },
    restore: restoreGoal, purge: purgeGoal, parentOf: row => `plant:${row.plant_id}` },
  log: { repo: db => repos(db).log, title: row => row.note || null, meta: row => ({ log_kind: row.kind }), restore: restoreLogEntry, purge: purgeLogEntry,
    parentOf: row => `planting:${row.planting_id}` },
  task: { repo: db => repos(db).tasks, title: row => row.title || null, meta: row => ({ task_kind: row.kind }), restore: restoreTask, purge: purgeTask,
    parentOf: row => `planting:${row.planting_id}` },
  tray: { repo: db => repos(db).trays, title: (row, db) => plantOf(db, row.plant_id).name,
    meta: (row, db) => { const p = plantOf(db, row.plant_id); return { starter_key: p.is_starter ? p.starter_key : null }; },
    restore: restoreTray, purge: purgeTray, parentOf: row => `space:${row.space_id}` },
  planting: { repo: db => repos(db).plantings, title: (row, db) => plantOf(db, row.plant_id).name,
    meta: (row, db) => { const p = plantOf(db, row.plant_id); return { starter_key: p.is_starter ? p.starter_key : null }; },
    restore: restorePlanting, purge: purgePlanting, parentOf: row => `space:${row.space_id}` },
  variety: { repo: db => repos(db).varieties, title: row => row.name, restore: restoreVariety, purge: purgeVariety, parentOf: row => `plant:${row.plant_id}` },
  guide: { repo: db => repos(db).guides, title: row => row.title, restore: restoreGuide, purge: purgeGuide,
    parentOf: row => (row.plant_id == null ? null : `plant:${row.plant_id}`) },
  plant: { repo: db => repos(db).plants, title: row => row.name, restore: restorePlant, purge: purgePlant },
  space: { repo: db => repos(db).spaces, title: row => row.name, restore: restoreSpace, purge: purgeSpace, parentOf: row => `place:${row.place_id}` },
  place: { repo: db => repos(db).places, title: row => row.name, restore: restorePlace, purge: purgePlace },
  animal: { repo: db => repos(db).animals, title: row => row.name, restore: restoreAnimal, purge: purgeAnimal },
};

const harvestPlant = (db, row) => db.prepare(row.planting_id ? 'SELECT plant_id FROM plantings WHERE id = ?' : 'SELECT plant_id FROM trays WHERE id = ?').get(row.planting_id ?? row.tray_id).plant_id;
const plantOf = (db, id) => db.prepare('SELECT name, starter_key, is_starter FROM plants WHERE id = ?').get(id);

function typeOf(type) {
  if (!Object.hasOwn(TRASH_TYPES, type)) throw new HttpError(404, 'Unknown kind of record', undefined, { code: 'unknown_kind' });
  return TRASH_TYPES[type];
}

// A parent row counts its children deleted with it in `extra` and the ones of it deleted earlier on
// their own in `earlier`; those earlier ones are listed with `parentInTrash: true`.
export function listTrash(db) {
  const rows = Object.entries(TRASH_TYPES).flatMap(([type, t]) => t.repo(db).listDeleted().map(row => ({ type, t, row })));
  const stamps = new Map(rows.map(r => [`${r.type}:${r.row.id}`, r.row.deleted_at]));
  const extra = new Map();
  const earlier = new Map();
  const add = (map, k) => map.set(k, (map.get(k) ?? 0) + 1);
  const out = [];
  for (const { type, t, row } of rows) {
    const item = { type, id: row.id, title: t.title(row, db), deleted_at: row.deleted_at, starter_key: row.is_starter ? row.starter_key ?? null : null,
      ...t.meta?.(row, db) };
    if (t.parentOf) {
      const parentKey = t.parentOf(row);
      if (stamps.has(parentKey)) {
        if (stamps.get(parentKey) === row.deleted_at) { add(extra, parentKey); continue; }
        add(earlier, parentKey);
        item.parentInTrash = true;
      }
    }
    out.push(item);
  }
  for (const item of out) {
    const k = `${item.type}:${item.id}`;
    if (extra.has(k) || earlier.has(k)) Object.assign(item, { extra: extra.get(k) ?? 0, earlier: earlier.get(k) ?? 0 });
  }
  return out.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at) || b.id - a.id);
}

export function restoreFromTrash(ctx, type, id) {
  const t = typeOf(type);
  if (t.restore) return t.restore(ctx, id);
  const ok = transaction(ctx.db, () => t.repo(ctx.db).restore(id));
  if (!ok) throw notInTrash();
  return t.repo(ctx.db).get(id);
}

function purge(ctx, t, row) {
  if (t.purge) t.purge(ctx, row);
  else purgeRow(ctx.db, t.repo(ctx.db), row);
}

export function deleteForever(ctx, type, id) {
  const t = typeOf(type);
  transaction(ctx.db, () => {
    const row = t.repo(ctx.db).get(id, { includeDeleted: true });
    if (!row || !row.deleted_at) throw notInTrash();
    purge(ctx, t, row);
  });
  return true;
}

export function emptyTrash(ctx, { discard } = {}) {
  const { name } = backupNow(ctx.db, ctx.config.dataDir, { kind: 'pre-empty' });
  const removed = transaction(ctx.db, () => {
    // Counts the rows the owner saw in the Trash list.
    const n = listTrash(ctx.db).length;
    for (const t of Object.values(TRASH_TYPES)) {
      for (const row of t.repo(ctx.db).listDeleted()) purge(ctx, t, row);
    }
    return n;
  });
  rotateQuietly(ctx.config.dataDir, discard);
  return { removed, backup: name };
}
