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
  // 9: the owner's animals, ratings for animals other than goats and chickens, microgreen trays, and
  // greenhouse notes for each season.
  `
  CREATE TABLE animals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('goat', 'chicken', 'other')), notes TEXT, sort_order INTEGER NOT NULL DEFAULT 0, ${TS});
  CREATE TABLE plant_animal_safety (plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    animal_id INTEGER NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
    safety TEXT NOT NULL CHECK (safety IN ('safe', 'small', 'avoid')), PRIMARY KEY (plant_id, animal_id));
  CREATE TABLE trays (id INTEGER PRIMARY KEY AUTOINCREMENT, plant_id INTEGER NOT NULL REFERENCES plants(id),
    space_id INTEGER NOT NULL REFERENCES spaces(id), animal_id INTEGER REFERENCES animals(id),
    tray_count INTEGER NOT NULL DEFAULT 1, seed_g REAL, sown_on TEXT NOT NULL, harvest_on TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'growing' CHECK (status IN ('planned', 'growing', 'harvested', 'discarded')),
    harvested_on TEXT, series_id INTEGER, repeat_days INTEGER, notes TEXT, ${TS});
  CREATE INDEX idx_trays_space ON trays(space_id);
  CREATE INDEX idx_trays_series ON trays(series_id);
  ALTER TABLE spaces ADD COLUMN notes_spring TEXT;
  ALTER TABLE spaces ADD COLUMN notes_summer TEXT;
  ALTER TABLE spaces ADD COLUMN notes_fall TEXT;
  ALTER TABLE spaces ADD COLUMN notes_winter TEXT;
  `,
  // 10: purchase details and containers on plantings; care and move kinds for tasks and the log.
  // SQLite can't change a CHECK in place, so tasks and planting_log are rebuilt with every row and
  // id kept (migrate() checks every foreign key before committing).
  `
  ALTER TABLE plantings ADD COLUMN in_container INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE plantings ADD COLUMN bought_from TEXT;
  ALTER TABLE plantings ADD COLUMN bought_on TEXT;
  ALTER TABLE plantings ADD COLUMN price REAL;
  ALTER TABLE plantings ADD COLUMN size_when_bought TEXT;
  ALTER TABLE plantings ADD COLUMN bears_on TEXT;
  UPDATE plantings SET in_container = 1 WHERE space_id IN (SELECT id FROM spaces WHERE kind = 'container');
  CREATE TABLE tasks_new (id INTEGER PRIMARY KEY AUTOINCREMENT, planting_id INTEGER NOT NULL REFERENCES plantings(id),
    kind TEXT NOT NULL CHECK (kind IN ('start_seeds', 'pot_up', 'harden_off', 'transplant', 'plant', 'sow', 'thin', 'feed', 'pests', 'harvest', 'other',
      'prune', 'mulch', 'protect', 'check_pot')),
    title TEXT, due_on TEXT NOT NULL, end_on TEXT, done_on TEXT, guide_id INTEGER REFERENCES guides(id), notes TEXT,
    auto INTEGER NOT NULL DEFAULT 0, edited INTEGER NOT NULL DEFAULT 0, season_key TEXT, ${TS});
  INSERT INTO tasks_new (id, planting_id, kind, title, due_on, end_on, done_on, guide_id, notes, auto, edited, version, created_at, updated_at, deleted_at)
    SELECT id, planting_id, kind, title, due_on, end_on, done_on, guide_id, notes, auto, edited, version, created_at, updated_at, deleted_at FROM tasks;
  -- Carry the id counter over, so ids used before (even of rows since removed) are never handed out again.
  DELETE FROM sqlite_sequence WHERE name = 'tasks_new';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'tasks_new', seq FROM sqlite_sequence WHERE name = 'tasks';
  DROP TABLE tasks;
  ALTER TABLE tasks_new RENAME TO tasks;
  CREATE INDEX idx_tasks_planting ON tasks(planting_id);
  CREATE INDEX idx_tasks_due ON tasks(due_on);
  CREATE TABLE planting_log_new (id INTEGER PRIMARY KEY AUTOINCREMENT, planting_id INTEGER NOT NULL REFERENCES plantings(id),
    on_date TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('sowed', 'transplanted', 'planted', 'thinned', 'fed', 'pruned', 'watered', 'problem', 'harvested', 'note',
      'mulched', 'protected', 'moved', 'repotted')),
    note TEXT, task_id INTEGER REFERENCES tasks(id), ${TS});
  INSERT INTO planting_log_new (id, planting_id, on_date, kind, note, task_id, version, created_at, updated_at, deleted_at)
    SELECT id, planting_id, on_date, kind, note, task_id, version, created_at, updated_at, deleted_at FROM planting_log;
  DELETE FROM sqlite_sequence WHERE name = 'planting_log_new';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'planting_log_new', seq FROM sqlite_sequence WHERE name = 'planting_log';
  DROP TABLE planting_log;
  ALTER TABLE planting_log_new RENAME TO planting_log;
  CREATE INDEX idx_log_planting ON planting_log(planting_id);
  -- Care seasons the owner deleted forever, so the morning top-up never makes them again.
  CREATE TABLE care_skipped (planting_id INTEGER NOT NULL, season_key TEXT NOT NULL, PRIMARY KEY (planting_id, season_key));
  `,
  // 11: harvests (from a planting or a microgreen tray, with where the food went and its Hearth &
  // Larder state) and pantry goals for winter planning. `larder_touched` is set before any send, since
  // Hearth & Larder may keep a copy even when its reply is lost; a goal names its preserving form by name.
  `
  CREATE TABLE harvests (id INTEGER PRIMARY KEY AUTOINCREMENT,
    planting_id INTEGER REFERENCES plantings(id), tray_id INTEGER REFERENCES trays(id),
    harvested_on TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL CHECK (unit IN ('kg', 'count', 'bunch')),
    larder_qty REAL NOT NULL DEFAULT 0, animals_qty REAL NOT NULL DEFAULT 0, animal_id INTEGER REFERENCES animals(id),
    given_qty REAL NOT NULL DEFAULT 0, given_to TEXT, sold_qty REAL NOT NULL DEFAULT 0, sold_price REAL, sold_to TEXT, notes TEXT,
    larder_state TEXT NOT NULL DEFAULT 'off' CHECK (larder_state IN ('off', 'pending', 'sent', 'failed', 'removed')),
    larder_error TEXT, larder_sent_at TEXT, larder_touched INTEGER NOT NULL DEFAULT 0, ${TS},
    CHECK ((planting_id IS NULL) != (tray_id IS NULL)));
  CREATE INDEX idx_harvests_planting ON harvests(planting_id);
  CREATE INDEX idx_harvests_tray ON harvests(tray_id);
  CREATE INDEX idx_harvests_on ON harvests(harvested_on);
  -- A harvest emptied from the Trash before Hearth & Larder heard it was deleted: its removal is still owed.
  CREATE TABLE larder_outbox (harvest_id INTEGER PRIMARY KEY);
  CREATE TABLE pantry_goals (id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, plant_id INTEGER NOT NULL REFERENCES plants(id),
    goal_kind TEXT NOT NULL CHECK (goal_kind IN ('raw', 'preserve')), amount REAL NOT NULL, unit TEXT,
    preserve_position INTEGER, preserve_form TEXT, notes TEXT, sort_order INTEGER NOT NULL DEFAULT 0, ${TS});
  `,
];

export function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current > migrations.length) {
    throw new Error(`This data folder was saved by a newer version of Seed & Harvest (database version ${current}, this app knows ${migrations.length}). Update the app; nothing was changed.`);
  }
  // SQLite's own way to rebuild a table: foreign keys off while migrating (the switch only works
  // outside a transaction), and every key checked before each step commits.
  const keysWereOn = db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (let i = current; i < migrations.length; i++) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(migrations[i]);
        const broken = db.prepare('PRAGMA foreign_key_check').all();
        if (broken.length) throw new Error(`Database upgrade ${i + 1} would break ${broken.length} links between records; nothing was changed.`);
        db.exec(`PRAGMA user_version = ${i + 1}`);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  } finally {
    if (keysWereOn) db.exec('PRAGMA foreign_keys = ON');
  }
}
