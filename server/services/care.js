import { repos } from '../db/repos.js';
import { careEvents } from './careRules.js';
import { guideFor } from './taskRules.js';
import { addDays, todayIn } from './dates.js';
import { getSettings } from './settings.js';

const one = (db, sql, ...args) => db.prepare(sql).get(...args);

// The guide each care task opens: the plant's care guide for pruning, feeding and mulching; for
// winter shelter and pot checks, the basics guide for fruit in pots (or the greenhouse one).
function careGuide(db, plant, kind, inContainer) {
  if (kind === 'protect' || kind === 'check_pot') {
    const key = inContainer ? 'guide.basics.container-fruit' : 'guide.basics.greenhouse';
    return one(db, 'SELECT id FROM guides WHERE starter_key = ? AND deleted_at IS NULL', key)?.id ?? null;
  }
  return guideFor(db, plant, 'feed');
}

function context(db, plantingId) {
  const p = one(db, `SELECT pl.*, s.place_id FROM plantings pl JOIN spaces s ON s.id = pl.space_id
    WHERE pl.id = ? AND pl.deleted_at IS NULL`, plantingId);
  if (!p || p.status === 'done') return null;
  const plant = one(db, 'SELECT * FROM plants WHERE id = ?', p.plant_id);
  if (!plant?.perennial) return null;
  const place = one(db, 'SELECT * FROM places WHERE id = ?', p.place_id);
  if (!place) return null;
  let wet = [];
  try { wet = JSON.parse(place.wet_months || '[]'); } catch { wet = []; }
  return { p, plant, place: { ...place, wet_months: Array.isArray(wet) ? wet : [] } };
}

// Saves the coming year of care for one perennial planting. A season that already has its task (done,
// edited, or deleted by the owner) is never made again.
export function topUpCare(db, plantingId, todayISO, fromISO = null) {
  const c = context(db, plantingId);
  if (!c) return 0;
  const from = [fromISO ?? todayISO, c.p.start_on].sort().at(-1);
  const to = addDays(todayISO, 365);
  if (from > to) return 0;
  const have = new Set([
    ...db.prepare('SELECT season_key FROM tasks WHERE planting_id = ? AND season_key IS NOT NULL').all(plantingId).map(r => r.season_key),
    ...db.prepare('SELECT season_key FROM care_skipped WHERE planting_id = ?').all(plantingId).map(r => r.season_key),
  ]);
  let n = 0;
  for (const e of careEvents(c.plant, c.place, Boolean(c.p.in_container), from, to)) {
    if (have.has(e.season_key)) continue;
    repos(db).tasks.create({ planting_id: plantingId, kind: e.kind, due_on: e.due_on, guide_id: careGuide(db, c.plant, e.kind, Boolean(c.p.in_container)),
      auto: 1, edited: 0, season_key: e.season_key });
    n++;
  }
  return n;
}

// The place's own today, falling back to the owner's time zone.
export function placeToday(db, plantingId) {
  const row = one(db, 'SELECT pa.time_zone FROM plantings pl JOIN spaces s ON s.id = pl.space_id JOIN places pa ON pa.id = s.place_id WHERE pl.id = ?', plantingId);
  return todayIn(row?.time_zone || getSettings(db).time_zone);
}

// Untouched care still to come is dropped and worked out again (after a move to another place).
export function redoCare(db, plantingId, fromISO, todayISO) {
  db.prepare(`DELETE FROM tasks WHERE planting_id = ? AND season_key IS NOT NULL AND auto = 1 AND edited = 0 AND done_on IS NULL
    AND deleted_at IS NULL AND due_on >= ? AND id NOT IN (SELECT task_id FROM planting_log WHERE task_id IS NOT NULL)`).run(plantingId, fromISO);
  return topUpCare(db, plantingId, todayISO, fromISO);
}

// Run once each time the app opens (every morning): every live perennial planting gets its next
// year of care. `todayFor(plantingId)` gives the place's today.
export function topUpAllCare(ctx, todayFor = id => placeToday(ctx.db, id)) {
  const ids = ctx.db.prepare(`SELECT pl.id FROM plantings pl JOIN plants p ON p.id = pl.plant_id
    WHERE pl.deleted_at IS NULL AND pl.status != 'done' AND p.perennial = 1`).all().map(r => r.id);
  // One planting that fails is skipped (and noted); the rest still get their care.
  let n = 0;
  for (const id of ids) {
    try { n += topUpCare(ctx.db, id, todayFor(id)); } catch (err) { console.error(`Could not top up care for planting ${id}:`, err.message); }
  }
  return n;
}
