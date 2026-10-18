import { transaction } from '../db/connection.js';
import { repos } from '../db/repos.js';
import { HttpError, notFound, notInTrash } from '../http.js';
import { validate } from '../validate.js';
import { addErrors, collector, invalid } from './fields.js';
import { cascadeDeletePhotos, cascadeRestorePhotos, purgeOwnerPhotos } from './photos.js';
import { purgePlantingsWhere, trashPlantingsIn, untrashPlantingsIn } from './plantings.js';
import { purgeTraysWhere, trashTraysIn, untrashTraysIn } from './trays.js';

export const SPACE_KINDS = ['bed', 'greenhouse', 'container', 'food_forest', 'microgreen_rack', 'seed_starting'];
export const SUN = ['full', 'part', 'shade'];

export const SPACE_SCHEMA = {
  place_id: { type: 'int!', min: 1 },
  name: { type: 'string!', maxLength: 80 },
  kind: { type: SPACE_KINDS, required: true },
  length_m: { type: 'number', min: 0, max: 10000 },
  width_m: { type: 'number', min: 0, max: 10000 },
  pot_liters: { type: 'number', min: 0, max: 100000 },
  tray_count: { type: 'int', min: 0, max: 1000 },
  heated: 'bool',
  sun: SUN,
  notes: { type: 'string', maxLength: 2000 },
  notes_spring: { type: 'string', maxLength: 2000 },
  notes_summer: { type: 'string', maxLength: 2000 },
  notes_fall: { type: 'string', maxLength: 2000 },
  notes_winter: { type: 'string', maxLength: 2000 },
  sort_order: { type: 'int', min: 0, max: 10000 },
};

// The fields each kind keeps. The rest are cleared on save, so a kind change leaves nothing stale behind.
const SIZED = ['length_m', 'width_m'];
export const KIND_FIELDS = {
  bed: SIZED,
  greenhouse: [...SIZED, 'heated', 'notes_spring', 'notes_summer', 'notes_fall', 'notes_winter'],
  food_forest: SIZED,
  seed_starting: SIZED,
  container: ['pot_liters'],
  microgreen_rack: ['tray_count'],
};
const EMPTY = { length_m: null, width_m: null, pot_liters: null, tray_count: null, heated: 0, notes_spring: null, notes_summer: null, notes_fall: null, notes_winter: null };

export const livePlace = (db, id) => Boolean(db.prepare('SELECT 1 FROM places WHERE id = ? AND deleted_at IS NULL').get(id));

function parse(db, body, existing) {
  const c = collector();
  const r = validate(SPACE_SCHEMA, body ?? {}, { partial: Boolean(existing) });
  addErrors(c, r);
  const data = { ...(r.data ?? {}) };
  if (data.place_id != null && !c.errors.place_id && !livePlace(db, data.place_id)) {
    c.fail('place_id', 'That place is gone', 'place_gone');
  }
  if (c.any()) throw invalid(c.errors, c.codes);
  const keep = KIND_FIELDS[data.kind ?? existing.kind];
  for (const [k, empty] of Object.entries(EMPTY)) if (!keep.includes(k)) data[k] = empty;
  return data;
}

export function listSpaces(db, placeId) {
  return db.prepare('SELECT * FROM spaces WHERE place_id = ? AND deleted_at IS NULL ORDER BY sort_order, name COLLATE NOCASE, id').all(placeId);
}

export function createSpace(db, body) {
  return transaction(db, () => repos(db).spaces.create(parse(db, body, null)));
}

export function updateSpace(db, id, body, version) {
  return transaction(db, () => {
    const existing = repos(db).spaces.get(id);
    if (!existing) throw notFound();
    const row = repos(db).spaces.update(id, parse(db, body, existing), version);
    if (!row) throw notFound();
    return row;
  });
}

export function deleteSpace(ctx, id, stamp = new Date().toISOString()) {
  transaction(ctx.db, () => {
    if (!repos(ctx.db).spaces.remove(id, stamp)) throw notFound();
    cascadeDeletePhotos(ctx, 'space', id, stamp);
    trashPlantingsIn(ctx, [id], stamp);
    trashTraysIn(ctx, [id], stamp);
  });
}

export function restoreSpace(ctx, id) {
  return transaction(ctx.db, () => {
    const row = repos(ctx.db).spaces.get(id, { includeDeleted: true });
    if (!row || !row.deleted_at) throw notInTrash();
    if (!livePlace(ctx.db, row.place_id)) {
      throw new HttpError(409, 'Restore its place first.', undefined, { code: 'parent_in_trash' });
    }
    repos(ctx.db).spaces.restore(id);
    cascadeRestorePhotos(ctx, 'space', id, row.deleted_at);
    untrashPlantingsIn(ctx, [id], row.deleted_at);
    untrashTraysIn(ctx, [id], row.deleted_at);
    return repos(ctx.db).spaces.get(id);
  });
}

// Its plantings and photos still in the Trash go first.
export function purgeSpace(ctx, row) {
  purgePlantingsWhere(ctx, 'space_id', row.id);
  purgeTraysWhere(ctx, 'space_id', row.id);
  purgeOwnerPhotos(ctx, 'space', row.id);
  repos(ctx.db).spaces.purge(row.id);
}
