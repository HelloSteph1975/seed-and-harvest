import { transaction } from '../db/connection.js';
import { seedStarter } from '../services/starter.js';
import { createPlace } from '../services/places.js';
import { createSpace } from '../services/spaces.js';

// Generic sample places for the demo folder only (never the owner's real places).
const PLACES = [
  { name: 'Riverside Homestead', status: 'current', location: 'A river valley', hemisphere: 'north', zone: '8a', last_frost: '03-15', first_frost: '11-15',
    notes: 'Clay soil, hot summers. The garden gets morning sun and afternoon shade by the barn.',
    spaces: [
      { name: 'Kitchen bed 1', kind: 'bed', length_m: 3.048, width_m: 1.2192, sun: 'full' },
      { name: 'Kitchen bed 2', kind: 'bed', length_m: 3.048, width_m: 1.2192, sun: 'full' },
      { name: 'Big greenhouse', kind: 'greenhouse', length_m: 6.096, width_m: 3.6576, heated: true, sun: 'full' },
      { name: 'Dwarf fig', kind: 'container', pot_liters: 56.78, sun: 'full', notes: 'Comes into the greenhouse for winter.' },
      { name: 'Orchard corner', kind: 'food_forest', length_m: 9.144, width_m: 6.096, sun: 'part' },
      { name: 'Pantry rack', kind: 'microgreen_rack', tray_count: 8, sun: 'shade' },
      { name: 'Seed shelf', kind: 'seed_starting', length_m: 1.2192, width_m: 0.4572, notes: 'Two shop lights on a timer.' },
    ] },
  { name: 'High Desert Plot', status: 'future', location: 'A high desert town', hemisphere: 'north', zone: '6b', last_frost: '04-25', first_frost: '10-15',
    notes: 'Dry and windy. Plan for shade cloth and drip lines.',
    spaces: [{ name: 'Sunken bed', kind: 'bed', length_m: 2.4384, width_m: 1.2192, sun: 'full' }] },
  { name: 'Highland Valley', status: 'future', location: 'A mountain valley', hemisphere: 'north', frost_free: true, wet_months: [6, 7, 8, 9, 10],
    notes: 'Mild all year with a summer rainy season.', spaces: [] },
];

export function seedDemo(ctx, { reset = false } = {}) {
  const db = ctx.db;
  transaction(db, () => {
    if (reset) db.exec('DELETE FROM photos; DELETE FROM spaces; DELETE FROM places; DELETE FROM starter_removed; DELETE FROM settings;');
    const have = new Set(db.prepare('SELECT name FROM places').all().map(r => r.name));
    for (const { spaces, ...place } of PLACES) {
      if (have.has(place.name)) continue;
      const row = createPlace(db, place);
      for (const s of spaces) createSpace(db, { ...s, place_id: row.id });
    }
  });
  seedStarter(db, ctx.config?.contentDir ? { content: ctx.config.contentDir } : undefined);
}
