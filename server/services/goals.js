import { transaction } from '../db/connection.js';
import { repos } from '../db/repos.js';
import { VersionConflict } from '../db/repo.js';
import { notFound, notInTrash, HttpError } from '../http.js';
import { validate } from '../validate.js';
import { addErrors, collector, invalid } from './fields.js';
import { preservesFor } from './plants.js';
import { suggestFor } from './planner.js';
import { listSupplies } from './tasks.js';

// Pantry goals: how much of a crop to grow in a year, as a raw amount or as jars of one of its preserving forms.
export const GOAL_SCHEMA = {
  year: { type: 'int', required: true, min: 2000, max: 2100 },
  plant_id: { type: 'int', required: true, min: 1 },
  goal_kind: { type: ['raw', 'preserve'], required: true },
  amount: { type: 'number', required: true, min: 0, max: 100000 },
  unit: { type: ['kg', 'count'] },
  preserve_position: { type: 'int', min: 1, max: 100 },
  notes: { type: 'string', maxLength: 2000 },
};

const one = (db, sql, ...args) => db.prepare(sql).get(...args);

function parse(db, body, existing) {
  const c = collector();
  const r = validate(GOAL_SCHEMA, body ?? {}, { partial: Boolean(existing) });
  addErrors(c, r);
  const data = { ...(r.data ?? {}) };
  const m = { ...existing, ...data };
  if (!c.errors.amount && m.amount != null && !(m.amount > 0)) c.fail('amount', 'Must be more than 0', 'too_small', { min: 0 });
  if (data.plant_id !== undefined && !c.errors.plant_id && !one(db, 'SELECT 1 FROM plants WHERE id = ? AND deleted_at IS NULL', data.plant_id)) {
    c.fail('plant_id', 'That plant is gone', 'plant_gone');
  }
  if (m.goal_kind === 'raw' && m.unit == null && !c.errors.unit) c.fail('unit', 'Required', 'required');
  if (m.goal_kind === 'preserve' && m.preserve_position == null && !c.errors.preserve_position) c.fail('preserve_position', 'Required', 'required');
  if (c.any()) throw invalid(c.errors, c.codes);
  // A raw goal has no preserving form, and a preserve goal is counted in jars.
  if (m.goal_kind === 'raw') data.preserve_position = null;
  if (m.goal_kind === 'preserve') data.unit = null;
  return data;
}

// Last year's real yield of a plant: its harvests in `unit` divided by the plant count (or row length)
// of the plantings they came from. Plantings without that number set don't count.
export function historyFor(db, plantId, year, per, unit) {
  const measure = per === 'meter' ? 'row_m' : 'count';
  const rows = db.prepare(`SELECT pl.${measure} AS m, SUM(h.quantity) AS q FROM harvests h JOIN plantings pl ON pl.id = h.planting_id
    WHERE pl.plant_id = ? AND h.deleted_at IS NULL AND h.unit = ? AND substr(h.harvested_on, 1, 4) = ? AND pl.${measure} > 0
    GROUP BY pl.id`).all(plantId, unit, String(year));
  const m = rows.reduce((n, r) => n + r.m, 0);
  if (!(m > 0)) return null;
  return { per, amount: Math.round((rows.reduce((n, r) => n + r.q, 0) / m) * 1000) / 1000 };
}

function shape(db, g) {
  const plant = one(db, 'SELECT id, name, starter_key, is_starter, yield_kg, yield_per FROM plants WHERE id = ?', g.plant_id);
  const preserves = preservesFor(db, g.plant_id);
  const unit = g.goal_kind === 'raw' && g.unit === 'count' ? 'count' : 'kg';
  const history = historyFor(db, g.plant_id, g.year - 1, plant.yield_per ?? 'plant', unit);
  const preserve = g.goal_kind === 'preserve' ? preserves[g.preserve_position - 1] ?? null : null;
  return {
    ...g,
    plant: { id: plant.id, name: plant.name, starter_key: plant.starter_key, is_starter: plant.is_starter },
    preserve,
    suggestion: suggestFor(g, { ...plant, preserves }, history),
  };
}

const yearOk = year => {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, 'Pick a year', undefined, { code: 'bad_year' });
  return year;
};

export function listGoals(db, year) {
  yearOk(year);
  return db.prepare('SELECT * FROM pantry_goals WHERE year = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(year).map(g => shape(db, g));
}

export function getGoal(db, id) {
  const g = repos(db).goals.get(id);
  if (!g) throw notFound();
  return shape(db, g);
}

export function createGoal(db, body) {
  return transaction(db, () => {
    const data = parse(db, body, null);
    const last = one(db, 'SELECT MAX(sort_order) AS n FROM pantry_goals WHERE year = ? AND deleted_at IS NULL', data.year).n ?? 0;
    return shape(db, repos(db).goals.create({ ...data, sort_order: last + 10 }));
  });
}

export function updateGoal(db, id, body, version) {
  return transaction(db, () => {
    const existing = repos(db).goals.get(id);
    if (!existing) throw notFound();
    let row;
    try {
      row = repos(db).goals.update(id, parse(db, body, existing), version);
    } catch (err) {
      if (err instanceof VersionConflict) throw new VersionConflict(getGoal(db, id));
      throw err;
    }
    if (!row) throw notFound();
    return shape(db, row);
  });
}

export function deleteGoal(db, id) {
  transaction(db, () => { if (!repos(db).goals.remove(id)) throw notFound(); });
}

export function restoreGoal(ctx, id) {
  return transaction(ctx.db, () => {
    const row = repos(ctx.db).goals.get(id, { includeDeleted: true });
    if (!row || !row.deleted_at) throw notInTrash();
    if (!one(ctx.db, 'SELECT 1 FROM plants WHERE id = ? AND deleted_at IS NULL', row.plant_id)) {
      throw new HttpError(409, 'Restore its plant first.', undefined, { code: 'parent_in_trash' });
    }
    repos(ctx.db).goals.restore(id);
    return getGoal(ctx.db, id);
  });
}

export function purgeGoal(ctx, row) {
  repos(ctx.db).goals.purge(row.id);
}

// What to buy for a year at one place: seeds and plants for the plantings planned in it (grouped by plant and
// variety, with the counts and rows added up), and the supplies their guides list for that year.
export function toBuy(db, { year, place_id }) {
  yearOk(year);
  const rows = db.prepare(`SELECT pl.how_started, pl.count, pl.row_m, p.id AS plant_id, p.name, p.starter_key, p.is_starter,
      v.id AS variety_id, v.name AS variety_name, s.name AS space_name
    FROM plantings pl JOIN plants p ON p.id = pl.plant_id JOIN spaces s ON s.id = pl.space_id AND s.deleted_at IS NULL
    LEFT JOIN plant_varieties v ON v.id = pl.variety_id AND v.deleted_at IS NULL
    WHERE pl.deleted_at IS NULL AND pl.status = 'planned' AND s.place_id = ? AND substr(pl.start_on, 1, 4) = ?`).all(place_id, String(year));
  const group = list => {
    const out = new Map();
    for (const r of list) {
      const key = `${r.plant_id}:${r.variety_id ?? ''}`;
      if (!out.has(key)) {
        out.set(key, { plant: { id: r.plant_id, name: r.name, starter_key: r.starter_key, is_starter: r.is_starter },
          variety: r.variety_id ? { id: r.variety_id, name: r.variety_name } : null, count: null, row_m: null, spaces: new Set() });
      }
      const g = out.get(key);
      if (r.count != null) g.count = (g.count ?? 0) + r.count;
      if (r.row_m != null) g.row_m = Math.round(((g.row_m ?? 0) + r.row_m) * 1000) / 1000;
      g.spaces.add(r.space_name);
    }
    return [...out.values()]
      .map(g => ({ ...g, spaces: [...g.spaces].sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => a.plant.name.localeCompare(b.plant.name) || (a.variety?.name ?? '').localeCompare(b.variety?.name ?? ''));
  };
  return {
    year,
    seeds: group(rows.filter(r => r.how_started.startsWith('seed_'))),
    plants: group(rows.filter(r => !r.how_started.startsWith('seed_'))),
    supplies: listSupplies(db, { place_id, from: `${year}-01-01`, to: `${year}-12-31` }),
  };
}
