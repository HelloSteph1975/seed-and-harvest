import { transaction } from '../db/connection.js';
import { repos } from '../db/repos.js';
import { VersionConflict } from '../db/repo.js';
import { HttpError, notFound, notInTrash } from '../http.js';
import { validate } from '../validate.js';
import { addErrors, collector, invalid } from './fields.js';
import { cascadeDeletePhotos, cascadeRestorePhotos, purgeOwnerPhotos } from './photos.js';
import { harvestChanged, owesRemoval } from './larder.js';

export const HARVEST_UNITS = ['kg', 'count', 'bunch'];
const QTY = { type: 'number', min: 0, max: 100000 };
export const HARVEST_SCHEMA = {
  planting_id: { type: 'int', min: 1 },
  tray_id: { type: 'int', min: 1 },
  harvested_on: { type: 'date', required: true },
  quantity: { type: 'number', required: true, min: 0, max: 100000 },
  unit: { type: HARVEST_UNITS, required: true },
  larder_qty: QTY, animals_qty: QTY, given_qty: QTY, sold_qty: QTY,
  animal_id: { type: 'int', min: 1 },
  given_to: { type: 'string', maxLength: 120 },
  sold_price: { type: 'number', min: 0, max: 10000000 },
  sold_to: { type: 'string', maxLength: 120 },
  notes: { type: 'string', maxLength: 2000 },
};
const PARTS = ['larder_qty', 'animals_qty', 'given_qty', 'sold_qty'];
const ORDER = ['planned', 'started', 'growing', 'harvesting', 'done'];

const one = (db, sql, ...args) => db.prepare(sql).get(...args);
const livePlanting = (db, id) => Boolean(one(db, 'SELECT 1 FROM plantings WHERE id = ? AND deleted_at IS NULL', id));
const liveTray = (db, id) => Boolean(one(db, 'SELECT 1 FROM trays WHERE id = ? AND deleted_at IS NULL', id));

function parse(db, body, existing) {
  const c = collector();
  const src = body ?? {};
  const r = validate(HARVEST_SCHEMA, src, { partial: Boolean(existing) });
  addErrors(c, r);
  const data = { ...(r.data ?? {}) };
  for (const k of ['planting_id', 'tray_id', 'animal_id']) if (data[k] === undefined && src[k] !== undefined && !c.errors[k]) data[k] = src[k];
  const merged = { ...existing, ...data };
  if (!existing || data.planting_id !== undefined || data.tray_id !== undefined) {
    if ((merged.planting_id == null) === (merged.tray_id == null)) c.fail('planting_id', 'Pick a planting or a tray', 'pick_one');
    else if (merged.planting_id != null && data.planting_id !== undefined && !livePlanting(db, merged.planting_id)) c.fail('planting_id', 'That planting is gone', 'planting_gone');
    else if (merged.tray_id != null && data.tray_id !== undefined && !liveTray(db, merged.tray_id)) c.fail('tray_id', 'That tray is gone', 'planting_gone');
  }
  if (!c.errors.quantity && merged.quantity != null && !(merged.quantity > 0)) c.fail('quantity', 'Must be more than 0', 'too_small', { min: 0 });
  // An old harvest whose animal was emptied from the Trash keeps its animal part; only a new or changed part needs an animal.
  const animalsChanged = !existing || (data.animals_qty !== undefined && data.animals_qty !== existing.animals_qty);
  if (animalsChanged && (merged.animals_qty ?? 0) > 0 && merged.animal_id == null && !c.errors.animal_id) c.fail('animal_id', 'Required', 'required');
  if (data.animal_id != null && data.animal_id !== existing?.animal_id && !c.errors.animal_id
    && !one(db, 'SELECT 1 FROM animals WHERE id = ? AND deleted_at IS NULL', data.animal_id)) c.fail('animal_id', 'That animal is gone', 'animal_gone');
  const sent = PARTS.reduce((n, k) => n + (merged[k] ?? 0), 0);
  if (!c.any() && sent > (merged.quantity ?? 0) + 1e-9) c.fail('larder_qty', 'The parts add up to more than the harvest', 'split_too_big');
  if (c.any()) throw invalid(c.errors, c.codes);
  const out = { ...r.data };
  if ((merged.animals_qty ?? 0) === 0 && merged.animal_id != null && out.animals_qty !== undefined) out.animal_id = null;
  return out;
}

const SELECT = `SELECT h.*,
  COALESCE(pp.id, tp.id) AS crop_id, COALESCE(pp.name, tp.name) AS crop_name, COALESCE(pp.starter_key, tp.starter_key) AS crop_key,
  COALESCE(pp.is_starter, tp.is_starter) AS crop_starter, v.name AS variety_name,
  COALESCE(ps.id, ts.id) AS space_id, COALESCE(ps.name, ts.name) AS space_name, COALESCE(ps.place_id, ts.place_id) AS place_id,
  a.name AS animal_name
  FROM harvests h
  LEFT JOIN plantings pl ON pl.id = h.planting_id LEFT JOIN plants pp ON pp.id = pl.plant_id LEFT JOIN spaces ps ON ps.id = pl.space_id
  LEFT JOIN plant_varieties v ON v.id = pl.variety_id AND v.deleted_at IS NULL
  LEFT JOIN trays tr ON tr.id = h.tray_id LEFT JOIN plants tp ON tp.id = tr.plant_id LEFT JOIN spaces ts ON ts.id = tr.space_id
  LEFT JOIN animals a ON a.id = h.animal_id`;

export function shapeHarvest(r) {
  const { crop_id, crop_name, crop_key, crop_starter, variety_name, space_id, space_name, place_id, animal_name, ...h } = r;
  const kept = h.quantity - PARTS.reduce((n, k) => n + (h[k] ?? 0), 0);
  return {
    ...h,
    kept_qty: Math.round(kept * 1e6) / 1e6,
    crop: { plant_id: crop_id, name: crop_name, starter_key: crop_key, is_starter: crop_starter },
    variety_name,
    space: { id: space_id, name: space_name },
    place_id,
    animal_name,
    source: h.planting_id ? { kind: 'planting', id: h.planting_id } : { kind: 'tray', id: h.tray_id },
  };
}

export function listHarvests(db, { place_id, year, planting_id, tray_id } = {}) {
  const where = ['h.deleted_at IS NULL'];
  const args = [];
  if (place_id != null) { where.push('COALESCE(ps.place_id, ts.place_id) = ?'); args.push(place_id); }
  if (year != null) { where.push("substr(h.harvested_on, 1, 4) = ?"); args.push(String(year)); }
  if (planting_id != null) { where.push('h.planting_id = ?'); args.push(planting_id); }
  if (tray_id != null) { where.push('h.tray_id = ?'); args.push(tray_id); }
  return db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY h.harvested_on DESC, h.id DESC`).all(...args).map(shapeHarvest);
}

export function getHarvest(db, id) {
  const row = one(db, `${SELECT} WHERE h.id = ? AND h.deleted_at IS NULL`, id);
  if (!row) throw notFound();
  return shapeHarvest(row);
}

// A harvest moves its planting along (never back) and marks its tray as cut.
function afterHarvest(db, h) {
  if (h.planting_id) {
    const p = one(db, 'SELECT status FROM plantings WHERE id = ?', h.planting_id);
    if (p && ORDER.indexOf('harvesting') > ORDER.indexOf(p.status)) db.prepare("UPDATE plantings SET status = 'harvesting', version = version + 1 WHERE id = ?").run(h.planting_id);
  } else {
    db.prepare(`UPDATE trays SET status = 'harvested', harvested_on = COALESCE(harvested_on, ?), version = version + 1
      WHERE id = ? AND status != 'harvested'`).run(h.harvested_on, h.tray_id);
  }
}

export function createHarvest(ctx, body) {
  const { db } = ctx;
  const row = transaction(db, () => {
    const data = parse(db, body, null);
    const created = repos(db).harvests.create(data);
    afterHarvest(db, created);
    harvestChanged(ctx, created.id);
    return created;
  });
  return getHarvest(db, row.id);
}

export function updateHarvest(ctx, id, body, version) {
  const { db } = ctx;
  transaction(db, () => {
    const existing = repos(db).harvests.get(id);
    if (!existing) throw notFound();
    const data = parse(db, body, existing);
    try {
      if (!repos(db).harvests.update(id, data, version)) throw notFound();
    } catch (err) {
      if (err instanceof VersionConflict) throw new VersionConflict(getHarvest(db, id));
      throw err;
    }
    harvestChanged(ctx, id);
  });
  return getHarvest(db, id);
}

export function deleteHarvest(ctx, id) {
  transaction(ctx.db, () => {
    const stamp = new Date().toISOString();
    if (!repos(ctx.db).harvests.remove(id, stamp)) throw notFound();
    cascadeDeletePhotos(ctx, 'harvest', id, stamp);
    harvestChanged(ctx, id);
  });
}

export function restoreHarvest(ctx, id) {
  const { db } = ctx;
  const out = transaction(db, () => {
    const row = repos(db).harvests.get(id, { includeDeleted: true });
    if (!row || !row.deleted_at) throw notInTrash();
    if ((row.planting_id && !livePlanting(db, row.planting_id)) || (row.tray_id && !liveTray(db, row.tray_id))) {
      throw new HttpError(409, 'Restore its planting or tray first.', undefined, { code: 'parent_in_trash' });
    }
    repos(db).harvests.restore(id);
    cascadeRestorePhotos(ctx, 'harvest', id, row.deleted_at);
    harvestChanged(ctx, id);
    return getHarvest(db, id);
  });
  return out;
}

// Send again: one more try for this harvest.
export function sendAgain(ctx, id) {
  getHarvest(ctx.db, id);
  harvestChanged(ctx, id);
  return getHarvest(ctx.db, id);
}

export function purgeHarvest(ctx, row) {
  owesRemoval(ctx, row);
  purgeOwnerPhotos(ctx, 'harvest', row.id);
  repos(ctx.db).harvests.purge(row.id);
}

// For a planting or tray going to (or coming back from) the Trash: its harvests go with it.
export function trashHarvestsOf(ctx, column, id, stamp) {
  const rows = ctx.db.prepare(`SELECT id FROM harvests WHERE ${column} = ? AND deleted_at IS NULL`).all(id);
  for (const h of rows) {
    ctx.db.prepare('UPDATE harvests SET deleted_at = ?, version = version + 1 WHERE id = ?').run(stamp, h.id);
    cascadeDeletePhotos(ctx, 'harvest', h.id, stamp);
    harvestChanged(ctx, h.id);
  }
  return rows.map(h => h.id);
}

export function untrashHarvestsOf(ctx, column, id, stamp) {
  const rows = ctx.db.prepare(`SELECT id FROM harvests WHERE ${column} = ? AND deleted_at = ?`).all(id, stamp);
  for (const h of rows) {
    ctx.db.prepare('UPDATE harvests SET deleted_at = NULL, version = version + 1 WHERE id = ?').run(h.id);
    cascadeRestorePhotos(ctx, 'harvest', h.id, stamp);
    harvestChanged(ctx, h.id);
  }
  return rows.map(h => h.id);
}

export function purgeHarvestsOf(ctx, column, id) {
  for (const row of ctx.db.prepare(`SELECT * FROM harvests WHERE ${column} = ?`).all(id)) purgeHarvest(ctx, row);
}
