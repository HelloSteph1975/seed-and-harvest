import { transaction } from '../db/connection.js';
import { seedStarter } from '../services/starter.js';
import { createPlace } from '../services/places.js';
import { createSpace } from '../services/spaces.js';
import { createPlant, createVariety } from '../services/plants.js';
import { createPlanting } from '../services/plantings.js';
import { updateTask } from '../services/tasks.js';
import { addDays } from '../services/dates.js';

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
    if (reset) {
      db.exec(`DELETE FROM photos; DELETE FROM planting_log; DELETE FROM tasks; DELETE FROM plantings; DELETE FROM spaces; DELETE FROM places; DELETE FROM guide_steps; DELETE FROM guide_supplies;
        DELETE FROM plant_varieties; DELETE FROM plant_preserves; UPDATE guides SET basics_id = NULL; DELETE FROM guides; DELETE FROM plants;
        DELETE FROM starter_removed; DELETE FROM settings;`);
    }
    const have = new Set(db.prepare('SELECT name FROM places').all().map(r => r.name));
    for (const { spaces, ...place } of PLACES) {
      if (have.has(place.name)) continue;
      const row = createPlace(db, place);
      for (const s of spaces) createSpace(db, { ...s, place_id: row.id });
    }
  });
  seedStarter(db, ctx.config?.contentDir ? { content: ctx.config.contentDir } : undefined);
  transaction(db, () => seedLibrarySamples(db));
  transaction(db, () => seedPlantings(ctx));
}

// A few plantings at the demo's current place, dated around the day the demo was made, so Today
// shows something overdue, a harvest window open now, and work already done.
function seedPlantings(ctx) {
  const { db } = ctx;
  if (db.prepare('SELECT 1 FROM plantings').get()) return;
  const today = new Date().toISOString().slice(0, 10);
  const home = db.prepare("SELECT id FROM places WHERE name = 'Riverside Homestead' AND deleted_at IS NULL").get();
  if (!home) return;
  const space = name => db.prepare('SELECT id FROM spaces WHERE place_id = ? AND name = ? AND deleted_at IS NULL').get(home.id, name)?.id;
  const plant = key => db.prepare('SELECT * FROM plants WHERE starter_key = ? AND deleted_at IS NULL').get(key);
  const finish = (planting, kinds) => {
    for (const t of planting.tasks.filter(x => kinds.includes(x.kind))) updateTask(ctx, t.id, { done_on: t.due_on }, t.version);
  };
  const tomato = plant('plant.tomato');
  const roma = tomato && db.prepare("SELECT id FROM plant_varieties WHERE plant_id = ? AND name = 'Roma'").get(tomato.id);
  if (tomato && space('Kitchen bed 1')) {
    const p = createPlanting(db, { space_id: space('Kitchen bed 1'), plant_id: tomato.id, variety_id: roma?.id ?? null, how_started: 'seed_indoors',
      start_on: addDays(today, -30), count: 6, notes: 'Sauce tomatoes for the pantry.' });
    finish(p, ['start_seeds']);
  }
  const beans = plant('plant.green-bean');
  if (beans && beans.days_min && space('Kitchen bed 2')) {
    const p = createPlanting(db, { space_id: space('Kitchen bed 2'), plant_id: beans.id, how_started: 'seed_outdoors', start_on: addDays(today, -(beans.days_min + 2)), count: 40 });
    finish(p, ['sow', 'thin', 'feed']);
  }
  const fig = plant('plant.fig');
  if (fig && space('Dwarf fig')) {
    const p = createPlanting(db, { space_id: space('Dwarf fig'), plant_id: fig.id, how_started: 'mature', start_on: addDays(today, -100), count: 1 });
    finish(p, ['plant']);
  }
}

// One plant of the gardener's own and a variety on a starter plant, so the demo shows both kinds.
function seedLibrarySamples(db) {
  if (!db.prepare("SELECT 1 FROM plants WHERE name = 'Heirloom chile'").get()) {
    createPlant(db, {
      name: 'Heirloom chile', kind: 'vegetable', family: 'Nightshade', summary: 'A family chile saved from seed for years.',
      sun: 'full', start_indoors_min: 8, start_indoors_max: 10, transplant_min: 2, transplant_max: 3, days_min: 75, days_max: 90,
      notes: 'Save seed from the best fruit each fall.',
    });
  }
  const tomato = db.prepare("SELECT id FROM plants WHERE starter_key = 'plant.tomato' AND deleted_at IS NULL").get();
  if (tomato && !db.prepare('SELECT 1 FROM plant_varieties WHERE plant_id = ?').get(tomato.id)) {
    createVariety(db, tomato.id, { name: 'Roma', days: 75, notes: 'A paste tomato for sauce.' });
  }
}
