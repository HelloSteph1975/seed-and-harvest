import { transaction } from '../db/connection.js';
import { NOW } from '../db/migrations.js';
import { repos } from '../db/repos.js';
import { notFound, notInTrash } from '../http.js';
import { validate } from '../validate.js';
import { addErrors, collector, invalid } from './fields.js';
import { validZone } from './settings.js';
import { cascadeDeletePhotos, cascadeRestorePhotos, purgeOwnerPhotos } from './photos.js';

export const PLACE_SCHEMA = {
  name: { type: 'string!', maxLength: 80 },
  location: { type: 'string', maxLength: 120 },
  latitude: { type: 'number', min: -90, max: 90 },
  longitude: { type: 'number', min: -180, max: 180 },
  hemisphere: ['north', 'south'],
  zone: { type: 'string', pattern: /^(1[0-3]|[1-9])[ab]?$/, patternHint: 'Use a zone like 7b', hintKey: 'zone' },
  last_frost: { type: 'monthDay', hintKey: 'monthDay' },
  first_frost: { type: 'monthDay', hintKey: 'monthDay' },
  frost_free: 'bool',
  status: ['current', 'future', 'past'],
  notes: { type: 'string', maxLength: 2000 },
  sort_order: { type: 'int', min: 0, max: 10000 },
};

const currentPlace = (db, exceptId) => db.prepare("SELECT id FROM places WHERE status = 'current' AND deleted_at IS NULL AND id IS NOT ?").get(exceptId ?? null);

// Only one live place is current, so the one that was current becomes past.
function demoteCurrent(db, exceptId) {
  db.prepare(`UPDATE places SET status = 'past', version = version + 1, updated_at = ${NOW}
    WHERE status = 'current' AND deleted_at IS NULL AND id IS NOT ?`).run(exceptId ?? null);
}

// Month numbers 1 to 12, without repeats, in calendar order.
function wetMonths(v, c) {
  if (v === undefined) return undefined;
  if (v === null) return [];
  if (!Array.isArray(v) || !v.every(m => Number.isInteger(m) && m >= 1 && m <= 12)) {
    c.fail('wet_months', 'Pick months from 1 to 12', 'bad_format');
    return undefined;
  }
  return [...new Set(v)].sort((a, b) => a - b);
}

// In the north the last spring frost comes before the first fall frost in the calendar year;
// in the south it comes after (frost in May, last frost in September).
function frostOrderOk({ hemisphere = 'north', last_frost: last, first_frost: first, frost_free: free }) {
  if (free || !last || !first) return true;
  return hemisphere === 'south' ? last > first : last < first;
}

function parse(db, body, existing) {
  const c = collector();
  const src = body ?? {};
  const r = validate(PLACE_SCHEMA, src, { partial: Boolean(existing) });
  addErrors(c, r);
  const data = { ...(r.data ?? {}) };
  const months = wetMonths(src.wet_months, c);
  if (months !== undefined) data.wet_months = months;
  if (Object.hasOwn(src, 'time_zone')) {
    const tz = typeof src.time_zone === 'string' ? src.time_zone.trim() : src.time_zone;
    if (tz === '' || tz == null) data.time_zone = null;
    else if (validZone(tz)) data.time_zone = tz;
    else c.fail('time_zone', 'Not a time zone this computer knows', 'bad_format');
  }
  if (c.any()) throw invalid(c.errors, c.codes);
  const merged = { ...existing, ...data };
  if (merged.frost_free) Object.assign(data, { last_frost: null, first_frost: null });
  else if (!frostOrderOk(merged)) {
    c.fail('first_frost', merged.hemisphere === 'south'
      ? 'In the south, the first fall frost comes before the last spring frost in the year'
      : 'The first fall frost must come after the last spring frost', 'frost_order');
    throw invalid(c.errors, c.codes);
  }
  return data;
}

export function createPlace(db, body) {
  return transaction(db, () => {
    const data = parse(db, body, null);
    if (!data.status) data.status = currentPlace(db) ? 'future' : 'current';
    if (data.status === 'current') demoteCurrent(db, null);
    return repos(db).places.create(data);
  });
}

export function updatePlace(db, id, body, version) {
  return transaction(db, () => {
    const existing = repos(db).places.get(id);
    if (!existing) throw notFound();
    const data = parse(db, body, existing);
    if (data.status === 'current' && existing.status !== 'current') demoteCurrent(db, id);
    const row = repos(db).places.update(id, data, version);
    if (!row) throw notFound();
    return row;
  });
}

// The place's live spaces (and their photos) go to the Trash with it, with the same deleted time,
// so they come back together.
export function deletePlace(ctx, id) {
  const { db } = ctx;
  transaction(db, () => {
    const stamp = new Date().toISOString();
    const spaces = db.prepare('SELECT id FROM spaces WHERE place_id = ? AND deleted_at IS NULL').all(id);
    if (!repos(db).places.remove(id, stamp)) throw notFound();
    db.prepare('UPDATE spaces SET deleted_at = ?, version = version + 1 WHERE place_id = ? AND deleted_at IS NULL').run(stamp, id);
    for (const s of spaces) cascadeDeletePhotos(ctx, 'space', s.id, stamp);
  });
}

// Spaces still in the Trash (and their photos) go first, so nothing is left pointing at a missing place.
export function purgePlace(ctx, row) {
  for (const s of ctx.db.prepare('SELECT id FROM spaces WHERE place_id = ? AND deleted_at IS NOT NULL').all(row.id)) {
    purgeOwnerPhotos(ctx, 'space', s.id);
    repos(ctx.db).spaces.purge(s.id);
  }
  repos(ctx.db).places.purge(row.id);
}

// A place that was current comes back as past when another place became current meanwhile.
export function restorePlace(ctx, id) {
  const { db } = ctx;
  return transaction(db, () => {
    const places = repos(db).places;
    const row = places.get(id, { includeDeleted: true });
    if (!row || !row.deleted_at) throw notInTrash();
    if (row.status === 'current' && currentPlace(db, id)) {
      db.prepare(`UPDATE places SET status = 'past' WHERE id = ?`).run(id);
    }
    places.restore(id);
    const spaces = db.prepare('SELECT id FROM spaces WHERE place_id = ? AND deleted_at = ?').all(id, row.deleted_at);
    db.prepare(`UPDATE spaces SET deleted_at = NULL, version = version + 1, updated_at = ${NOW} WHERE place_id = ? AND deleted_at = ?`)
      .run(id, row.deleted_at);
    for (const s of spaces) cascadeRestorePhotos(ctx, 'space', s.id, row.deleted_at);
    return places.get(id);
  });
}
