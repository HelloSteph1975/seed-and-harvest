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
