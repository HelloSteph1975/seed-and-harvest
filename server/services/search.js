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

// One search over plants, guides, places and spaces, ignoring case and accents.
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

  return {
    q: text,
    groups: {
      plants: group(plants, ({ id, name, kind, summary, starter_key, is_starter }) => ({ id, name, kind, summary, starter_key, is_starter })),
      guides: group(guides, ({ id, title, stage, plant_id, plant_name, plant_starter_key, plant_is_starter, starter_key, is_starter }) => (
        { id, title, stage, plant_id, plant_name, plant_starter_key, plant_is_starter, starter_key, is_starter })),
      places: group(places, ({ id, name, location, status }) => ({ id, name, location, status })),
      spaces: group(spaces, ({ id, name, kind, place_id, place_name }) => ({ id, name, kind, place_id, place_name })),
    },
  };
}
