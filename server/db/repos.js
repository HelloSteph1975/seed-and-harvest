import { createRepo } from './repo.js';

const cache = new WeakMap();

export const PLACE_COLUMNS = ['name', 'location', 'latitude', 'longitude', 'time_zone', 'hemisphere', 'zone', 'last_frost',
  'first_frost', 'frost_free', 'wet_months', 'status', 'notes', 'sort_order'];

export const SPACE_COLUMNS = ['place_id', 'name', 'kind', 'length_m', 'width_m', 'pot_liters', 'tray_count', 'heated', 'sun', 'notes', 'sort_order'];

export const PHOTO_COLUMNS = ['owner_type', 'owner_id', 'filename', 'caption', 'is_cover', 'sort_order'];

const parseList = text => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };
const placeIn = row => ({ ...row, wet_months: parseList(row.wet_months) });
const placeOut = d => (Array.isArray(d.wet_months) ? { ...d, wet_months: JSON.stringify(d.wet_months) } : d);

// One repo per table, cached per database handle (a restore opens a new handle).
export function repos(db) {
  let r = cache.get(db);
  if (!r) {
    r = {
      places: createRepo(db, 'places', PLACE_COLUMNS, { orderBy: 'sort_order, name COLLATE NOCASE, id', fromRow: placeIn, toRow: placeOut }),
      spaces: createRepo(db, 'spaces', SPACE_COLUMNS, { orderBy: 'sort_order, name COLLATE NOCASE, id' }),
      photos: createRepo(db, 'photos', PHOTO_COLUMNS, { orderBy: 'sort_order, id' }),
    };
    cache.set(db, r);
  }
  return r;
}
