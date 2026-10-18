import { transaction } from '../db/connection.js';
import { NOW } from '../db/migrations.js';
import { repos } from '../db/repos.js';
import { VersionConflict } from '../db/repo.js';
import { HttpError, notFound, notInTrash } from '../http.js';
import { validate } from '../validate.js';
import { addErrors, collector, invalid } from './fields.js';
import { cascadeDeletePhotos, cascadeRestorePhotos, purgeOwnerPhotos } from './photos.js';
import { safetyFor } from './animals.js';
import { addDays } from './dates.js';

export const TRAY_STATUSES = ['planned', 'growing', 'harvested', 'discarded'];
export const TRAY_SCHEMA = {
  plant_id: { type: 'int!', min: 1 },
  space_id: { type: 'int!', min: 1 },
  animal_id: { type: 'int', min: 1 },
  tray_count: { type: 'int', min: 1, max: 1000 },
  seed_g: { type: 'number', min: 0, max: 100000 },
  sown_on: { type: 'date', required: true },
  harvest_on: { type: 'date' },
  status: TRAY_STATUSES,
  harvested_on: { type: 'date' },
  repeat_days: { type: 'int', min: 1, max: 60 },
  notes: { type: 'string', maxLength: 2000 },
};

const one = (db, sql, ...args) => db.prepare(sql).get(...args);
const plantRow = (db, id) => one(db, 'SELECT * FROM plants WHERE id = ? AND deleted_at IS NULL', id);
const liveSpace = (db, id) => Boolean(one(db, 'SELECT 1 FROM spaces WHERE id = ? AND deleted_at IS NULL', id));
const daysTo = plant => plant?.days_min ?? 7;

function parse(db, body, existing) {
  const c = collector();
  const src = body ?? {};
  const r = validate(TRAY_SCHEMA, src, { partial: Boolean(existing) });
  addErrors(c, r);
  const data = { ...(r.data ?? {}) };
  for (const k of ['plant_id', 'space_id', 'animal_id']) if (data[k] === undefined && src[k] !== undefined && !c.errors[k]) data[k] = src[k];
  const merged = { ...existing, ...data };
  const plant = merged.plant_id != null && !c.errors.plant_id ? plantRow(db, merged.plant_id) : null;
  if (data.plant_id != null && !c.errors.plant_id && plant?.kind !== 'microgreen') c.fail('plant_id', 'Pick a microgreen', 'not_microgreen');
  if (data.space_id != null && !c.errors.space_id && !liveSpace(db, data.space_id)) c.fail('space_id', 'That space is gone', 'space_gone');
  if (data.animal_id != null && !c.errors.animal_id && data.animal_id !== existing?.animal_id
    && !one(db, 'SELECT 1 FROM animals WHERE id = ? AND deleted_at IS NULL', data.animal_id)) {
    c.fail('animal_id', 'That animal is gone', 'animal_gone');
  }
  if (c.any()) throw invalid(c.errors, c.codes);
  const out = { ...r.data };
  // No ready date (left empty, or cleared on an edit) means the crop's own.
  if (!existing || out.harvest_on === null) {
    if (out.harvest_on == null) out.harvest_on = addDays(out.sown_on ?? existing.sown_on, daysTo(plant));
  }
  if (!existing) {
    if (out.seed_g == null && plant?.seed_g_per_tray != null) out.seed_g = (out.tray_count ?? 1) * plant.seed_g_per_tray;
  }
  const after = { ...existing, ...out };
  if (after.harvest_on < after.sown_on) c.fail('harvest_on', 'This must not be before the first date', 'range_order');
  if (after.status === 'harvested' && !after.harvested_on) c.fail('harvested_on', 'Required', 'required');
  if (c.any()) throw invalid(c.errors, c.codes);
  return out;
}

// The newest live tray of a series: the one that carries the repeat.
const newestOf = (db, seriesId) => one(db, 'SELECT * FROM trays WHERE series_id = ? AND deleted_at IS NULL ORDER BY sown_on DESC, id DESC LIMIT 1', seriesId);

// Keeps a series' repeat on its newest live tray, whatever changed. When several trays carry one,
// the newest carrier's interval wins; when none does, nothing repeats.
function settleRepeat(db, seriesId, chosen) {
  if (seriesId == null) return;
  // An interval the owner just set wins over the one already running.
  if (chosen != null) {
    const newest = newestOf(db, seriesId);
    if (newest) db.prepare('UPDATE trays SET repeat_days = ?, version = version + 1 WHERE id = ? AND repeat_days IS NOT ?').run(chosen, newest.id, chosen);
  }
  const carrier = one(db, `SELECT id, repeat_days FROM trays WHERE series_id = ? AND deleted_at IS NULL AND repeat_days IS NOT NULL
    ORDER BY sown_on DESC, id DESC LIMIT 1`, seriesId);
  const newest = newestOf(db, seriesId);
  if (!carrier || !newest) return;
  db.prepare(`UPDATE trays SET repeat_days = NULL, version = version + 1 WHERE series_id = ? AND deleted_at IS NULL AND repeat_days IS NOT NULL
    AND id != ?`).run(seriesId, newest.id);
  if (newest.repeat_days !== carrier.repeat_days) db.prepare('UPDATE trays SET repeat_days = ?, version = version + 1 WHERE id = ?').run(carrier.repeat_days, newest.id);
}

const SELECT = `SELECT tr.*, p.name AS plant_name, p.starter_key AS plant_key, p.is_starter AS plant_starter, p.seed_g_per_tray, p.days_min, p.days_max,
  p.soak_hours, s.name AS space_name, s.tray_count AS space_trays, s.place_id, a.name AS animal_name, a.kind AS animal_kind,
  a.deleted_at AS animal_deleted
  FROM trays tr JOIN plants p ON p.id = tr.plant_id JOIN spaces s ON s.id = tr.space_id LEFT JOIN animals a ON a.id = tr.animal_id`;

function shape(db, r) {
  const { plant_name, plant_key, plant_starter, seed_g_per_tray, days_min, days_max, soak_hours, space_name, space_trays, place_id,
    animal_name, animal_kind, animal_deleted, ...tray } = r;
  const plant = db.prepare('SELECT * FROM plants WHERE id = ?').get(tray.plant_id);
  const animal = tray.animal_id ? { id: tray.animal_id, name: animal_name, kind: animal_kind, deleted: Boolean(animal_deleted) } : null;
  const newest = newestOf(db, tray.series_id);
  return {
    ...tray,
    plant: { id: tray.plant_id, name: plant_name, starter_key: plant_key, is_starter: plant_starter, seed_g_per_tray, days_min, days_max, soak_hours },
    space: { id: tray.space_id, name: space_name, tray_count: space_trays, place_id },
    animal,
    safety: animal ? safetyFor(db, plant, animal) : null,
    next_sow_on: newest?.id === tray.id && tray.repeat_days ? addDays(tray.sown_on, tray.repeat_days) : null,
  };
}

export function listTrays(db, { place_id, space_id, status } = {}) {
  const where = ['tr.deleted_at IS NULL'];
  const args = [];
  if (place_id != null) { where.push('s.place_id = ?'); args.push(place_id); }
  if (space_id != null) { where.push('tr.space_id = ?'); args.push(space_id); }
  if (status != null) {
    if (!TRAY_STATUSES.includes(status)) throw new HttpError(400, 'Unknown status', undefined, { code: 'not_one_of' });
    where.push('tr.status = ?'); args.push(status);
  }
  return db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY tr.sown_on DESC, tr.id DESC`).all(...args).map(r => shape(db, r));
}

export function getTray(db, id) {
  const row = one(db, `${SELECT} WHERE tr.id = ? AND tr.deleted_at IS NULL`, id);
  if (!row) throw notFound();
  return shape(db, row);
}

export function createTray(db, body) {
  return transaction(db, () => {
    const data = parse(db, body, null);
    const row = repos(db).trays.create(data);
    db.prepare('UPDATE trays SET series_id = ? WHERE id = ?').run(row.id, row.id);
    return repos(db).trays.get(row.id);
  });
}

export function updateTray(db, id, body, version) {
  return transaction(db, () => {
    const existing = repos(db).trays.get(id);
    if (!existing) throw notFound();
    const data = parse(db, body, existing);
    try {
      const row = repos(db).trays.update(id, data, version);
      if (!row) throw notFound();
      settleRepeat(db, row.series_id, data.repeat_days);
      return getTray(db, id);
    } catch (err) {
      if (err instanceof VersionConflict) throw new VersionConflict(getTray(db, id));
      throw err;
    }
  });
}

// The next tray of the same crop, at the end of the series. Only the newest tray carries the repeat.
export function sowAgain(db, id, body) {
  return transaction(db, () => {
    const from = repos(db).trays.get(id);
    if (!from) throw notFound();
    const r = validate({ sown_on: { type: 'date', required: true }, status: ['planned', 'growing'] }, body ?? {});
    if (r.errors) throw invalid(r.errors, r.codes);
    const plant = plantRow(db, from.plant_id);
    if (!plant || !liveSpace(db, from.space_id)) throw new HttpError(409, 'Its crop or rack is in the Trash.', undefined, { code: 'parent_in_trash' });
    const animalLive = from.animal_id && one(db, 'SELECT 1 FROM animals WHERE id = ? AND deleted_at IS NULL', from.animal_id);
    const row = repos(db).trays.create({
      plant_id: from.plant_id, space_id: from.space_id, animal_id: animalLive ? from.animal_id : null, tray_count: from.tray_count, seed_g: from.seed_g,
      sown_on: r.data.sown_on, harvest_on: addDays(r.data.sown_on, daysTo(plant)), status: r.data.status ?? 'growing',
      series_id: from.series_id, notes: from.notes,
    });
    settleRepeat(db, from.series_id);
    return repos(db).trays.get(row.id);
  });
}

// The newest tray's repeat passes to the tray before it, so the series keeps going. Its own copy
// stays on the trashed row, so a restore can take it back.
function handBack(db, tray) {
  if (!tray.repeat_days) return;
  const next = newestOf(db, tray.series_id);
  if (next && !next.repeat_days) db.prepare('UPDATE trays SET repeat_days = ?, version = version + 1 WHERE id = ?').run(tray.repeat_days, next.id);
}

export function deleteTray(ctx, id) {
  transaction(ctx.db, () => {
    const tray = repos(ctx.db).trays.get(id);
    const stamp = new Date().toISOString();
    if (!tray || !repos(ctx.db).trays.remove(id, stamp)) throw notFound();
    cascadeDeletePhotos(ctx, 'tray', id, stamp);
    handBack(ctx.db, tray);
  });
}

// A tray back from the Trash takes the repeat again when it is the newest of its series.
function takeRepeat(db, tray) {
  if (!tray.repeat_days) return;
  const newest = newestOf(db, tray.series_id);
  if (newest?.id === tray.id) {
    db.prepare('UPDATE trays SET repeat_days = NULL, version = version + 1 WHERE series_id = ? AND id != ? AND deleted_at IS NULL AND repeat_days IS NOT NULL')
      .run(tray.series_id, tray.id);
  } else {
    db.prepare('UPDATE trays SET repeat_days = NULL WHERE id = ?').run(tray.id);
  }
}

export function restoreTray(ctx, id) {
  const { db } = ctx;
  return transaction(db, () => {
    const row = repos(db).trays.get(id, { includeDeleted: true });
    if (!row || !row.deleted_at) throw notInTrash();
    if (!liveSpace(db, row.space_id) || !plantRow(db, row.plant_id)) throw new HttpError(409, 'Restore its rack and crop first.', undefined, { code: 'parent_in_trash' });
    repos(db).trays.restore(id);
    cascadeRestorePhotos(ctx, 'tray', id, row.deleted_at);
    takeRepeat(db, row);
    settleRepeat(db, row.series_id);
    return getTray(db, id);
  });
}

export function purgeTray(ctx, row) {
  purgeOwnerPhotos(ctx, 'tray', row.id);
  repos(ctx.db).trays.purge(row.id);
}

// For a space or place going to the Trash: its live trays go too, with the same stamp.
export function trashTraysIn(ctx, spaceIds, stamp) {
  for (const spaceId of spaceIds) {
    for (const t of ctx.db.prepare('SELECT * FROM trays WHERE space_id = ? AND deleted_at IS NULL').all(spaceId)) {
      ctx.db.prepare('UPDATE trays SET deleted_at = ?, version = version + 1 WHERE id = ?').run(stamp, t.id);
      cascadeDeletePhotos(ctx, 'tray', t.id, stamp);
      handBack(ctx.db, t);
    }
  }
}

// Trays come back with their space, except those whose crop went to the Trash meanwhile.
export function untrashTraysIn(ctx, spaceIds, stamp) {
  for (const spaceId of spaceIds) {
    for (const t of ctx.db.prepare(`SELECT tr.* FROM trays tr JOIN plants p ON p.id = tr.plant_id AND p.deleted_at IS NULL
      WHERE tr.space_id = ? AND tr.deleted_at = ?`).all(spaceId, stamp)) {
      ctx.db.prepare(`UPDATE trays SET deleted_at = NULL, version = version + 1, updated_at = ${NOW} WHERE id = ?`).run(t.id);
      cascadeRestorePhotos(ctx, 'tray', t.id, stamp);
      takeRepeat(ctx.db, t);
      settleRepeat(ctx.db, t.series_id);
    }
  }
}

export function purgeTraysWhere(ctx, column, id) {
  for (const row of ctx.db.prepare(`SELECT * FROM trays WHERE ${column} = ? AND deleted_at IS NOT NULL`).all(id)) purgeTray(ctx, row);
}

export const liveTrayCount = (db, plantId) => one(db, 'SELECT COUNT(*) AS n FROM trays WHERE plant_id = ? AND deleted_at IS NULL', plantId).n;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
// What needs doing at a place: growing trays ready by the end of the range, and sowings due by then
// (a series' next tray, or a tray planned for that day).
export function dueTrays(db, { place_id, from, to }) {
  if (!ISO.test(from ?? '') || !ISO.test(to ?? '') || from > to) throw new HttpError(400, 'Give a from and to date', undefined, { code: 'bad_range' });
  const trays = listTrays(db, { place_id });
  const ready = trays.filter(t => t.status === 'growing' && t.harvest_on <= to).sort((a, b) => a.harvest_on.localeCompare(b.harvest_on));
  const sow = [
    ...trays.filter(t => t.next_sow_on && t.next_sow_on <= to && t.status !== 'planned').map(t => ({ tray: t, on: t.next_sow_on, planned: false })),
    ...trays.filter(t => t.status === 'planned' && t.sown_on <= to).map(t => ({ tray: t, on: t.sown_on, planned: true })),
  ].sort((a, b) => a.on.localeCompare(b.on));
  return { ready, sow };
}
