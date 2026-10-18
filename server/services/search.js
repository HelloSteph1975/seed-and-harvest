import { collector, invalid } from './fields.js';
import { getSettings } from './settings.js';
import { readPack } from './locales.js';
import { fold } from './plants.js';

export const MIN_QUERY = 2;
export const MAX_QUERY = 200;
const CAP = 20;

const group = (all, pick) => ({ total: all.length, items: all.slice(0, CAP).map(pick) });

// The active language pack's starter text, or {} for English or a pack that can't be read.
function packContent(db, dataDir) {
  const { language } = getSettings(db);
  if (language === 'en') return {};
  try { return readPack(dataDir, language, 'content'); } catch { return {}; }
}

// Whether any of a row's texts holds the words. Starter rows still tagged Starter also match their
// translated text, so a Spanish screen finds a plant by its Spanish name.
const matcher = (needle, pack) => (row, fields, extra = []) => {
  const texts = [...fields.map(f => row[f]), ...extra];
  if (row.is_starter && row.starter_key) texts.push(...fields.map(f => pack[`${row.starter_key}.${f}`]));
  return texts.some(v => v && fold(v).includes(needle));
};

// One search over plants, guides, places, spaces, plantings, log entries, trays and animals, ignoring case and accents.
export function searchAll(db, dataDir, q) {
  const text = typeof q === 'string' ? q.trim() : '';
  if (text.length < MIN_QUERY || text.length > MAX_QUERY) {
    const c = collector();
    if (text.length < MIN_QUERY) c.fail('q', `Type at least ${MIN_QUERY} characters`, 'too_short', { min: MIN_QUERY });
    else c.fail('q', `Keep it to ${MAX_QUERY} characters or fewer`, 'too_long', { max: MAX_QUERY });
    throw invalid(c.errors, c.codes);
  }
  const needle = fold(text);
  const pack = packContent(db, dataDir);
  const hit = matcher(needle, pack);
  const live = sql => db.prepare(sql).all();

  const plants = live(`SELECT id, name, latin_name, kind, summary, notes, starter_key, is_starter FROM plants
    WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, id`).filter(p => hit(p, ['name', 'latin_name', 'summary', 'notes']));

  const steps = new Map();
  for (const s of live('SELECT guide_id, position, text FROM guide_steps ORDER BY guide_id, position')) {
    if (!steps.has(s.guide_id)) steps.set(s.guide_id, []);
    steps.get(s.guide_id).push(s.text);
  }
  const guides = live(`SELECT g.id, g.title, g.summary, g.stage, g.plant_id, g.starter_key, g.is_starter, p.name AS plant_name,
    p.starter_key AS plant_starter_key, p.is_starter AS plant_is_starter
    FROM guides g LEFT JOIN plants p ON p.id = g.plant_id WHERE g.deleted_at IS NULL ORDER BY g.title COLLATE NOCASE, g.id`)
    .filter(g => {
      const own = steps.get(g.id) ?? [];
      const translated = g.is_starter ? own.map((_, i) => pack[`${g.starter_key}.step.${i + 1}`]) : [];
      return hit(g, ['title', 'summary'], [...own, ...translated]);
    });

  const places = live('SELECT id, name, location, notes, status FROM places WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, id')
    .filter(p => hit(p, ['name', 'location', 'notes']));
  const spaces = live(`SELECT s.id, s.name, s.kind, s.notes, s.place_id, p.name AS place_name FROM spaces s JOIN places p ON p.id = s.place_id
    WHERE s.deleted_at IS NULL ORDER BY s.name COLLATE NOCASE, s.id`).filter(s => hit(s, ['name', 'notes']));

  const plantings = live(`SELECT pl.id, pl.notes, pl.status, pl.bought_from, pl.size_when_bought, p.name, p.starter_key, p.is_starter, v.name AS variety_name, s.name AS space_name
    FROM plantings pl JOIN plants p ON p.id = pl.plant_id JOIN spaces s ON s.id = pl.space_id
    LEFT JOIN plant_varieties v ON v.id = pl.variety_id AND v.deleted_at IS NULL
    WHERE pl.deleted_at IS NULL ORDER BY p.name COLLATE NOCASE, pl.start_on, pl.id`).filter(r => hit(r, ['name'], [r.variety_name, r.notes, r.bought_from, r.size_when_bought]));
  const log = live(`SELECT l.id, l.note, l.kind, l.on_date, l.planting_id, p.name, p.starter_key, p.is_starter
    FROM planting_log l JOIN plantings pl ON pl.id = l.planting_id AND pl.deleted_at IS NULL JOIN plants p ON p.id = pl.plant_id
    WHERE l.deleted_at IS NULL AND l.note IS NOT NULL ORDER BY l.on_date DESC, l.id DESC`).filter(r => fold(r.note).includes(needle));

  const trays = live(`SELECT tr.id, tr.notes, tr.status, tr.sown_on, p.name, p.starter_key, p.is_starter, s.name AS space_name
    FROM trays tr JOIN plants p ON p.id = tr.plant_id JOIN spaces s ON s.id = tr.space_id
    WHERE tr.deleted_at IS NULL ORDER BY tr.sown_on DESC, tr.id DESC`).filter(r => hit(r, ['name'], [r.notes]));
  const animals = live('SELECT id, name, kind, notes FROM animals WHERE deleted_at IS NULL ORDER BY sort_order, name COLLATE NOCASE, id')
    .filter(a => hit(a, ['name', 'notes']));

  return {
    q: text,
    groups: {
      plants: group(plants, ({ id, name, kind, summary, starter_key, is_starter }) => ({ id, name, kind, summary, starter_key, is_starter })),
      guides: group(guides, ({ id, title, stage, plant_id, plant_name, plant_starter_key, plant_is_starter, starter_key, is_starter }) => (
        { id, title, stage, plant_id, plant_name, plant_starter_key, plant_is_starter, starter_key, is_starter })),
      places: group(places, ({ id, name, location, status }) => ({ id, name, location, status })),
      spaces: group(spaces, ({ id, name, kind, place_id, place_name }) => ({ id, name, kind, place_id, place_name })),
      plantings: group(plantings, ({ id, name, starter_key, is_starter, variety_name, space_name, status }) => (
        { id, plant_name: name, plant_starter_key: starter_key, plant_is_starter: is_starter, variety_name, space_name, status })),
      trays: group(trays, ({ id, status, sown_on, name, starter_key, is_starter, space_name }) => (
        { id, status, sown_on, plant_name: name, plant_starter_key: starter_key, plant_is_starter: is_starter, space_name })),
      animals: group(animals, ({ id, name, kind }) => ({ id, name, kind })),
      log: group(log, ({ id, note, kind, on_date, planting_id, name, starter_key, is_starter }) => (
        { id, note, kind, on_date, planting_id, plant_name: name, plant_starter_key: starter_key, plant_is_starter: is_starter })),
    },
  };
}
