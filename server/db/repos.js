import { createRepo } from './repo.js';

const cache = new WeakMap();

export const PLACE_COLUMNS = ['name', 'location', 'latitude', 'longitude', 'time_zone', 'hemisphere', 'zone', 'last_frost',
  'first_frost', 'frost_free', 'wet_months', 'status', 'notes', 'sort_order'];

export const SPACE_COLUMNS = ['place_id', 'name', 'kind', 'length_m', 'width_m', 'pot_liters', 'tray_count', 'heated', 'sun', 'notes', 'notes_spring', 'notes_summer', 'notes_fall', 'notes_winter', 'sort_order'];

export const PHOTO_COLUMNS = ['owner_type', 'owner_id', 'filename', 'caption', 'is_cover', 'sort_order'];

export const PLANT_COLUMNS = ['name', 'latin_name', 'kind', 'family', 'summary', 'sun', 'water', 'spacing_cm', 'container_liters',
  'container_ok', 'greenhouse_notes', 'zone_min', 'zone_max', 'perennial', 'start_indoors_min', 'start_indoors_max', 'transplant_min',
  'transplant_max', 'sow_min', 'sow_max', 'fall_sow_min', 'fall_sow_max', 'frost_free_months', 'days_min', 'days_max', 'years_min',
  'years_max', 'yield_kg', 'yield_per', 'companions', 'avoid', 'problems', 'notes', 'soak_hours', 'seed_g_per_tray', 'safety_goats',
  'safety_chickens', 'starter_key', 'is_starter', 'content_version'];
export const VARIETY_COLUMNS = ['plant_id', 'name', 'days', 'notes', 'sort_order'];
export const GUIDE_COLUMNS = ['title', 'summary', 'plant_id', 'basics_id', 'stage', 'sort_order', 'starter_key', 'is_starter', 'content_version'];

export const PLANTING_COLUMNS = ['space_id', 'plant_id', 'variety_id', 'count', 'row_m', 'how_started', 'start_on', 'status', 'notes',
  'in_container', 'bought_from', 'bought_on', 'price', 'size_when_bought', 'bears_on'];
export const TASK_COLUMNS = ['planting_id', 'kind', 'title', 'due_on', 'end_on', 'done_on', 'guide_id', 'notes', 'auto', 'edited', 'season_key'];
export const ANIMAL_COLUMNS = ['name', 'kind', 'notes', 'sort_order'];
export const TRAY_COLUMNS = ['plant_id', 'space_id', 'animal_id', 'tray_count', 'seed_g', 'sown_on', 'harvest_on', 'status', 'harvested_on', 'series_id', 'repeat_days', 'notes'];
export const LOG_COLUMNS = ['planting_id', 'on_date', 'kind', 'note', 'task_id'];

const parseList = text => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };
const placeIn = row => ({ ...row, wet_months: parseList(row.wet_months) });
const placeOut = d => (Array.isArray(d.wet_months) ? { ...d, wet_months: JSON.stringify(d.wet_months) } : d);
const PLANT_LISTS = ['frost_free_months', 'companions', 'avoid'];
const plantIn = row => ({ ...row, ...Object.fromEntries(PLANT_LISTS.map(k => [k, parseList(row[k])])) });
const plantOut = d => ({ ...d, ...Object.fromEntries(PLANT_LISTS.filter(k => Array.isArray(d[k])).map(k => [k, JSON.stringify(d[k])])) });

// One repo per table, cached per database handle (a restore opens a new handle).
export function repos(db) {
  let r = cache.get(db);
  if (!r) {
    r = {
      places: createRepo(db, 'places', PLACE_COLUMNS, { orderBy: 'sort_order, name COLLATE NOCASE, id', fromRow: placeIn, toRow: placeOut }),
      spaces: createRepo(db, 'spaces', SPACE_COLUMNS, { orderBy: 'sort_order, name COLLATE NOCASE, id' }),
      photos: createRepo(db, 'photos', PHOTO_COLUMNS, { orderBy: 'sort_order, id' }),
      plants: createRepo(db, 'plants', PLANT_COLUMNS, { orderBy: 'name COLLATE NOCASE, id', fromRow: plantIn, toRow: plantOut }),
      varieties: createRepo(db, 'plant_varieties', VARIETY_COLUMNS, { orderBy: 'sort_order, name COLLATE NOCASE, id' }),
      guides: createRepo(db, 'guides', GUIDE_COLUMNS, { orderBy: 'sort_order, title COLLATE NOCASE, id' }),
      plantings: createRepo(db, 'plantings', PLANTING_COLUMNS, { orderBy: 'start_on, id' }),
      tasks: createRepo(db, 'tasks', TASK_COLUMNS, { orderBy: 'due_on, id' }),
      log: createRepo(db, 'planting_log', LOG_COLUMNS, { orderBy: 'on_date DESC, id DESC' }),
      animals: createRepo(db, 'animals', ANIMAL_COLUMNS, { orderBy: 'sort_order, name COLLATE NOCASE, id' }),
      trays: createRepo(db, 'trays', TRAY_COLUMNS, { orderBy: 'sown_on DESC, id DESC' }),
    };
    cache.set(db, r);
  }
  return r;
}
