// Editable tables use INTEGER PRIMARY KEY AUTOINCREMENT so ids are never reused.
// Every time stamp is ISO-8601 UTC with a Z (like new Date().toISOString()), so stamps compare as strings.
export const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

// Every editable table gets these. version goes up by one on every change.
export const TS = `version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}), deleted_at TEXT`;

// Each entry runs once, in order. Never edit an entry after it ships; add a new one.
export const migrations = [
  // 1: settings (key/value, last save wins).
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  // 2: starter entries the owner deleted forever (so they are never seeded again).
  `CREATE TABLE starter_removed (starter_key TEXT PRIMARY KEY, removed_at TEXT NOT NULL DEFAULT (${NOW}));`,
  // 3: places. At most one live place is current.
  `
  CREATE TABLE places (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, location TEXT,
    latitude REAL, longitude REAL, time_zone TEXT,
    hemisphere TEXT NOT NULL DEFAULT 'north' CHECK (hemisphere IN ('north', 'south')),
    zone TEXT, last_frost TEXT, first_frost TEXT, frost_free INTEGER NOT NULL DEFAULT 0,
    wet_months TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'future' CHECK (status IN ('current', 'future', 'past')),
    notes TEXT, sort_order INTEGER NOT NULL DEFAULT 0, ${TS});
  CREATE UNIQUE INDEX idx_places_one_current ON places(status) WHERE status = 'current' AND deleted_at IS NULL;
  `,
  // 4: growing spaces. Size fields are metric; only the ones that fit the kind are kept.
  `
  CREATE TABLE spaces (id INTEGER PRIMARY KEY AUTOINCREMENT, place_id INTEGER NOT NULL REFERENCES places(id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('bed', 'greenhouse', 'container', 'food_forest', 'microgreen_rack', 'seed_starting')),
    length_m REAL, width_m REAL, pot_liters REAL, tray_count INTEGER, heated INTEGER NOT NULL DEFAULT 0,
    sun TEXT CHECK (sun IS NULL OR sun IN ('full', 'part', 'shade')), notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0, ${TS});
  CREATE INDEX idx_spaces_place ON spaces(place_id);
  `,
  // 5: photos. owner_type names the kind of record (see PHOTO_OWNERS); files live in photos\.
  `
  CREATE TABLE photos (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_type TEXT NOT NULL, owner_id INTEGER NOT NULL,
    filename TEXT NOT NULL, caption TEXT, is_cover INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, ${TS});
  CREATE INDEX idx_photos_owner ON photos(owner_type, owner_id);
  `,
  // 6: the plant library. Timing is in weeks around the frost dates; sizes are metric.
  `
  CREATE TABLE plants (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, latin_name TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('vegetable', 'herb', 'microgreen', 'fruit_tree', 'shrub', 'vine')),
    family TEXT, summary TEXT,
    sun TEXT CHECK (sun IS NULL OR sun IN ('full', 'part', 'shade')),
    water TEXT CHECK (water IS NULL OR water IN ('low', 'medium', 'high')),
    spacing_cm REAL, container_liters REAL, container_ok INTEGER NOT NULL DEFAULT 0, greenhouse_notes TEXT,
    zone_min INTEGER, zone_max INTEGER, perennial INTEGER NOT NULL DEFAULT 0,
    start_indoors_min INTEGER, start_indoors_max INTEGER, transplant_min INTEGER, transplant_max INTEGER,
    sow_min INTEGER, sow_max INTEGER, fall_sow_min INTEGER, fall_sow_max INTEGER,
    frost_free_months TEXT NOT NULL DEFAULT '[]',
    days_min INTEGER, days_max INTEGER, years_min INTEGER, years_max INTEGER,
    yield_kg REAL, yield_per TEXT CHECK (yield_per IS NULL OR yield_per IN ('plant', 'meter')),
    companions TEXT NOT NULL DEFAULT '[]', avoid TEXT NOT NULL DEFAULT '[]',
    problems TEXT, notes TEXT, soak_hours REAL, seed_g_per_tray REAL,
    safety_goats TEXT CHECK (safety_goats IS NULL OR safety_goats IN ('safe', 'small', 'avoid')),
    safety_chickens TEXT CHECK (safety_chickens IS NULL OR safety_chickens IN ('safe', 'small', 'avoid')),
    starter_key TEXT UNIQUE, is_starter INTEGER NOT NULL DEFAULT 0, content_version INTEGER NOT NULL DEFAULT 1, ${TS});
  CREATE TABLE plant_varieties (id INTEGER PRIMARY KEY AUTOINCREMENT, plant_id INTEGER NOT NULL REFERENCES plants(id),
    name TEXT NOT NULL, days INTEGER, notes TEXT, sort_order INTEGER NOT NULL DEFAULT 0, ${TS});
  CREATE INDEX idx_varieties_plant ON plant_varieties(plant_id);
  CREATE TABLE plant_preserves (plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE, position INTEGER NOT NULL,
    form TEXT NOT NULL, unit TEXT NOT NULL, raw_kg REAL NOT NULL, PRIMARY KEY (plant_id, position));
  `,
  // 7: guides. A basics guide has no plant; a plant guide may link to the basics guide it builds on.
  `
  CREATE TABLE guides (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, summary TEXT,
    plant_id INTEGER REFERENCES plants(id), basics_id INTEGER REFERENCES guides(id) ON DELETE SET NULL,
    stage TEXT NOT NULL CHECK (stage IN ('start_indoors', 'transplant', 'sow_outdoors', 'container', 'greenhouse', 'care', 'harvest', 'preserve', 'microgreens', 'general')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    starter_key TEXT UNIQUE, is_starter INTEGER NOT NULL DEFAULT 0, content_version INTEGER NOT NULL DEFAULT 1, ${TS});
  CREATE INDEX idx_guides_plant ON guides(plant_id);
  CREATE TABLE guide_steps (guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE, position INTEGER NOT NULL,
    text TEXT NOT NULL, PRIMARY KEY (guide_id, position));
  CREATE TABLE guide_supplies (guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE, position INTEGER NOT NULL,
    name TEXT NOT NULL, amount TEXT, PRIMARY KEY (guide_id, position));
  `,
  // 8: plantings (a plant in a space), their tasks (worked out by the rules or added by the owner) and a dated log.
  `
  CREATE TABLE plantings (id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id INTEGER NOT NULL REFERENCES spaces(id), plant_id INTEGER NOT NULL REFERENCES plants(id),
    variety_id INTEGER REFERENCES plant_varieties(id), count INTEGER, row_m REAL,
    how_started TEXT NOT NULL CHECK (how_started IN ('seed_indoors', 'seed_outdoors', 'start', 'mature')),
    start_on TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'started', 'growing', 'harvesting', 'done')),
    notes TEXT, ${TS});
  CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, planting_id INTEGER NOT NULL REFERENCES plantings(id),
    kind TEXT NOT NULL CHECK (kind IN ('start_seeds', 'pot_up', 'harden_off', 'transplant', 'plant', 'sow', 'thin', 'feed', 'pests', 'harvest', 'other')),
    title TEXT, due_on TEXT NOT NULL, end_on TEXT, done_on TEXT, guide_id INTEGER REFERENCES guides(id), notes TEXT,
    auto INTEGER NOT NULL DEFAULT 0, edited INTEGER NOT NULL DEFAULT 0, ${TS});
  CREATE TABLE planting_log (id INTEGER PRIMARY KEY AUTOINCREMENT, planting_id INTEGER NOT NULL REFERENCES plantings(id),
    on_date TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('sowed', 'transplanted', 'planted', 'thinned', 'fed', 'pruned', 'watered', 'problem', 'harvested', 'note')),
    note TEXT, task_id INTEGER REFERENCES tasks(id), ${TS});
  CREATE INDEX idx_plantings_space ON plantings(space_id);
  CREATE INDEX idx_tasks_planting ON tasks(planting_id);
  CREATE INDEX idx_tasks_due ON tasks(due_on);
  CREATE INDEX idx_log_planting ON planting_log(planting_id);
  `,
];

export function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current > migrations.length) {
    throw new Error(`This data folder was saved by a newer version of Seed & Harvest (database version ${current}, this app knows ${migrations.length}). Update the app; nothing was changed.`);
  }
  for (let i = current; i < migrations.length; i++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migrations[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
