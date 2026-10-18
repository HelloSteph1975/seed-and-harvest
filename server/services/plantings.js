import { transaction } from '../db/connection.js';
import { NOW } from '../db/migrations.js';
import { repos } from '../db/repos.js';
import { VersionConflict } from '../db/repo.js';
import { HttpError, notFound, notInTrash } from '../http.js';
import { validate } from '../validate.js';
import { addErrors, collector, invalid } from './fields.js';
import { cascadeDeletePhotos, cascadeRestorePhotos, purgeOwnerPhotos } from './photos.js';
import { describeTasks, linkGuides, planTasks } from './taskRules.js';

export const HOW_STARTED = ['seed_indoors', 'seed_outdoors', 'start', 'mature'];
export const STATUSES = ['planned', 'started', 'growing', 'harvesting', 'done'];

export const PLANTING_SCHEMA = {
  space_id: { type: 'int!', min: 1 },
  plant_id: { type: 'int!', min: 1 },
  variety_id: { type: 'int', min: 1 },
  count: { type: 'int', min: 1, max: 100000 },
  row_m: { type: 'number', min: 0, max: 10000 },
  how_started: { type: HOW_STARTED, required: true },
  start_on: { type: 'date', required: true },
  status: STATUSES,
  notes: { type: 'string', maxLength: 2000 },
};

const one = (db, sql, ...args) => db.prepare(sql).get(...args);
export const liveSpace = (db, id) => Boolean(one(db, 'SELECT 1 FROM spaces WHERE id = ? AND deleted_at IS NULL', id));
const livePlantRow = (db, id) => one(db, 'SELECT * FROM plants WHERE id = ? AND deleted_at IS NULL', id);

// Which ways of starting make sense for a plant: a mature plant only for perennials, seed indoors
// only for plants with indoor timing (and microgreens, which always grow inside).
export function allowedStarts(plant) {
  const out = [];
  if (plant.start_indoors_min != null || plant.kind === 'microgreen') out.push('seed_indoors');
  out.push('seed_outdoors', 'start');
  if (plant.perennial) out.push('mature');
  return out;
}

function parse(db, body, existing) {
  const c = collector();
  const r = validate(PLANTING_SCHEMA, body ?? {}, { partial: Boolean(existing) });
  addErrors(c, r);
  const src = body ?? {};
  // validate() leaves out data when any field failed; ids that passed still get checked, so every problem shows at once.
  const data = { ...(r.data ?? {}) };
  for (const k of ['space_id', 'plant_id', 'variety_id', 'how_started']) {
    if (data[k] === undefined && src[k] !== undefined && !c.errors[k]) data[k] = src[k];
  }
  const merged = { ...existing, ...data };
  if (data.space_id != null && !c.errors.space_id && !liveSpace(db, data.space_id)) c.fail('space_id', 'That space is gone', 'space_gone');
  const plant = merged.plant_id != null && !c.errors.plant_id ? livePlantRow(db, merged.plant_id) : null;
  if (data.plant_id != null && !c.errors.plant_id && !plant) c.fail('plant_id', 'That plant is gone', 'plant_gone');
  if (plant && merged.variety_id != null && !c.errors.variety_id && (data.variety_id !== undefined || data.plant_id !== undefined)) {
    if (!one(db, 'SELECT 1 FROM plant_varieties WHERE id = ? AND plant_id = ?', merged.variety_id, plant.id)) {
      c.fail('variety_id', 'Pick a variety of this plant', 'wrong_variety');
    }
  }
  if (plant && merged.how_started && !c.errors.how_started && !allowedStarts(plant).includes(merged.how_started)) {
    c.fail('how_started', 'That way of starting doesn\'t fit this plant', 'wrong_start');
  }
  if (c.any()) throw invalid(c.errors, c.codes);
  return { data: { ...r.data }, plant };
}

const cover = `(SELECT filename FROM photos ph WHERE ph.owner_type = 'planting' AND ph.owner_id = pl.id AND ph.deleted_at IS NULL
  ORDER BY ph.is_cover DESC, ph.sort_order, ph.id LIMIT 1)`;
const nextTask = `(SELECT json_object('id', t.id, 'kind', t.kind, 'title', t.title, 'due_on', t.due_on) FROM tasks t
  WHERE t.planting_id = pl.id AND t.deleted_at IS NULL AND t.done_on IS NULL ORDER BY t.due_on, t.id LIMIT 1)`;
const SELECT = `SELECT pl.*, p.name AS plant_name, p.kind AS plant_kind, p.starter_key AS plant_key, p.is_starter AS plant_starter,
  v.name AS variety_name, s.name AS space_name, s.kind AS space_kind, s.place_id AS place_id, ${cover} AS cover, ${nextTask} AS next_task
  FROM plantings pl JOIN plants p ON p.id = pl.plant_id JOIN spaces s ON s.id = pl.space_id
  LEFT JOIN plant_varieties v ON v.id = pl.variety_id AND v.deleted_at IS NULL`;

function shape(row) {
  const { plant_name, plant_kind, plant_key, plant_starter, variety_name, space_name, space_kind, place_id, next_task, ...rest } = row;
  return {
    ...rest,
    plant: { id: row.plant_id, name: plant_name, kind: plant_kind, starter_key: plant_key, is_starter: plant_starter },
    variety: variety_name != null ? { id: row.variety_id, name: variety_name } : null,
    space: { id: row.space_id, name: space_name, kind: space_kind, place_id },
    next_task: next_task ? JSON.parse(next_task) : null,
  };
}

export function listPlantings(db, { place_id, space_id, status, plant_id } = {}) {
  const where = ['pl.deleted_at IS NULL'];
  const args = [];
  if (place_id != null) { where.push('s.place_id = ?'); args.push(place_id); }
  if (space_id != null) { where.push('pl.space_id = ?'); args.push(space_id); }
  if (plant_id != null) { where.push('pl.plant_id = ?'); args.push(plant_id); }
  if (status != null) {
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Unknown status', undefined, { code: 'not_one_of' });
    where.push('pl.status = ?'); args.push(status);
  }
  return db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY s.sort_order, s.name COLLATE NOCASE, pl.start_on, pl.id`).all(...args).map(shape);
}

export const tasksOf = (db, id) => db.prepare(`SELECT t.*, g.title AS guide_title, g.starter_key AS guide_key, g.is_starter AS guide_starter
  FROM tasks t LEFT JOIN guides g ON g.id = t.guide_id AND g.deleted_at IS NULL
  WHERE t.planting_id = ? AND t.deleted_at IS NULL ORDER BY t.due_on, t.id`).all(id)
  .map(({ guide_title, guide_key, guide_starter, ...t }) => ({ ...t, guide: guide_title != null ? { id: t.guide_id, title: guide_title, starter_key: guide_key, is_starter: guide_starter } : null }));
export const logOf = (db, id) => db.prepare(`SELECT l.*, t.kind AS task_kind FROM planting_log l LEFT JOIN tasks t ON t.id = l.task_id
  WHERE l.planting_id = ? AND l.deleted_at IS NULL ORDER BY l.on_date DESC, l.id DESC`).all(id);

export function getPlanting(db, id) {
  const row = one(db, `${SELECT} WHERE pl.id = ? AND pl.deleted_at IS NULL`, id);
  if (!row) throw notFound();
  return { ...shape(row), tasks: tasksOf(db, id), log: logOf(db, id) };
}

function saveTasks(db, planting, plant, skipKinds = new Set()) {
  for (const t of linkGuides(db, plant, planTasks(plant, planting.how_started, planting.start_on))) {
    if (skipKinds.has(t.kind)) continue;
    repos(db).tasks.create({ planting_id: planting.id, kind: t.kind, due_on: t.due_on, end_on: t.end_on, guide_id: t.guide_id, auto: 1 });
  }
}

// The tasks the rules made that the owner hasn't touched hold nothing of the owner's, so they are
// removed and a fresh set replaces them. Edited, finished and owner-added tasks stay as they are,
// and a kept task the rules made stands in for the new one of its kind.
function redoTasks(db, planting, plant) {
  const untouched = 'SELECT id FROM tasks WHERE planting_id = ? AND auto = 1 AND edited = 0 AND done_on IS NULL AND deleted_at IS NULL';
  // A log entry in the Trash keeps its date and note but lets go of a task about to be replaced.
  db.prepare(`UPDATE planting_log SET task_id = NULL WHERE deleted_at IS NOT NULL AND task_id IN (${untouched})`).run(planting.id);
  db.prepare(`DELETE FROM tasks WHERE id IN (${untouched})
    AND id NOT IN (SELECT task_id FROM planting_log WHERE task_id IS NOT NULL)`).run(planting.id);
  const kept = db.prepare('SELECT DISTINCT kind FROM tasks WHERE planting_id = ? AND auto = 1 AND deleted_at IS NULL').all(planting.id).map(r => r.kind);
  saveTasks(db, planting, plant, new Set(kept));
}

// What a planting would make, without saving anything.
export function previewPlanting(db, body) {
  const { data, plant } = parse(db, body, null);
  return { tasks: describeTasks(db, linkGuides(db, plant, planTasks(plant, data.how_started, data.start_on))) };
}

export function createPlanting(db, body) {
  return transaction(db, () => {
    const { data, plant } = parse(db, body, null);
    const row = repos(db).plantings.create(data);
    saveTasks(db, row, plant);
    return getPlanting(db, row.id);
  });
}

export function updatePlanting(db, id, body, version) {
  return transaction(db, () => {
    const existing = repos(db).plantings.get(id);
    if (!existing) throw notFound();
    const { data, plant } = parse(db, body, existing);
    let row;
    try { row = repos(db).plantings.update(id, data, version); } catch (err) {
      if (err instanceof VersionConflict) throw new VersionConflict(getPlanting(db, id));
      throw err;
    }
    if (!row) throw notFound();
    if (['start_on', 'how_started', 'plant_id'].some(k => data[k] !== undefined && data[k] !== existing[k])) redoTasks(db, row, plant ?? livePlantRow(db, row.plant_id));
    return getPlanting(db, id);
  });
}

// The planting's tasks, log entries and every photo go to the Trash with it, with the same stamp.
function trashPlanting(ctx, id, stamp) {
  const { db } = ctx;
  db.prepare('UPDATE tasks SET deleted_at = ?, version = version + 1 WHERE planting_id = ? AND deleted_at IS NULL').run(stamp, id);
  for (const l of db.prepare('SELECT id FROM planting_log WHERE planting_id = ? AND deleted_at IS NULL').all(id)) cascadeDeletePhotos(ctx, 'log', l.id, stamp);
  db.prepare('UPDATE planting_log SET deleted_at = ?, version = version + 1 WHERE planting_id = ? AND deleted_at IS NULL').run(stamp, id);
  cascadeDeletePhotos(ctx, 'planting', id, stamp);
}

function untrashPlanting(ctx, id, stamp) {
  const { db } = ctx;
  db.prepare(`UPDATE tasks SET deleted_at = NULL, version = version + 1, updated_at = ${NOW} WHERE planting_id = ? AND deleted_at = ?`).run(id, stamp);
  const logs = db.prepare('SELECT id FROM planting_log WHERE planting_id = ? AND deleted_at = ?').all(id, stamp);
  db.prepare(`UPDATE planting_log SET deleted_at = NULL, version = version + 1, updated_at = ${NOW} WHERE planting_id = ? AND deleted_at = ?`).run(id, stamp);
  for (const l of logs) cascadeRestorePhotos(ctx, 'log', l.id, stamp);
  cascadeRestorePhotos(ctx, 'planting', id, stamp);
}

export function deletePlanting(ctx, id) {
  transaction(ctx.db, () => {
    const stamp = new Date().toISOString();
    if (!repos(ctx.db).plantings.remove(id, stamp)) throw notFound();
    trashPlanting(ctx, id, stamp);
  });
}

export function restorePlanting(ctx, id) {
  const { db } = ctx;
  return transaction(db, () => {
    const row = repos(db).plantings.get(id, { includeDeleted: true });
    if (!row || !row.deleted_at) throw notInTrash();
    if (!liveSpace(db, row.space_id) || !livePlantRow(db, row.plant_id)) {
      throw new HttpError(409, 'Restore its space and plant first.', undefined, { code: 'parent_in_trash' });
    }
    repos(db).plantings.restore(id);
    untrashPlanting(ctx, id, row.deleted_at);
    return getPlanting(db, id);
  });
}

// For a space or place going to the Trash: its live plantings go too, with the same stamp.
export function trashPlantingsIn(ctx, spaceIds, stamp) {
  const { db } = ctx;
  for (const spaceId of spaceIds) {
    for (const p of db.prepare('SELECT id FROM plantings WHERE space_id = ? AND deleted_at IS NULL').all(spaceId)) {
      db.prepare('UPDATE plantings SET deleted_at = ?, version = version + 1 WHERE id = ?').run(stamp, p.id);
      trashPlanting(ctx, p.id, stamp);
    }
  }
}

export function untrashPlantingsIn(ctx, spaceIds, stamp) {
  const { db } = ctx;
  for (const spaceId of spaceIds) {
    // A planting whose plant went to the Trash meanwhile stays there until its plant is back.
    for (const p of db.prepare(`SELECT pl.id FROM plantings pl JOIN plants p ON p.id = pl.plant_id AND p.deleted_at IS NULL
      WHERE pl.space_id = ? AND pl.deleted_at = ?`).all(spaceId, stamp)) {
      db.prepare(`UPDATE plantings SET deleted_at = NULL, version = version + 1, updated_at = ${NOW} WHERE id = ?`).run(p.id);
      untrashPlanting(ctx, p.id, stamp);
    }
  }
}

// Removes a planting in the Trash for good: its log entries (and their photos) first, then its
// tasks, then its own photos.
export function purgePlanting(ctx, row) {
  const { db } = ctx;
  for (const l of db.prepare('SELECT id FROM planting_log WHERE planting_id = ?').all(row.id)) {
    purgeOwnerPhotos(ctx, 'log', l.id);
  }
  db.prepare('DELETE FROM planting_log WHERE planting_id = ?').run(row.id);
  db.prepare('DELETE FROM tasks WHERE planting_id = ?').run(row.id);
  purgeOwnerPhotos(ctx, 'planting', row.id);
  repos(db).plantings.purge(row.id);
}

export function purgePlantingsWhere(ctx, column, id) {
  for (const row of ctx.db.prepare(`SELECT * FROM plantings WHERE ${column} = ? AND deleted_at IS NOT NULL`).all(id)) purgePlanting(ctx, row);
}

export const livePlantingCount = (db, plantId) => one(db, 'SELECT COUNT(*) AS n FROM plantings WHERE plant_id = ? AND deleted_at IS NULL', plantId).n;
export const livePlanting = (db, id) => Boolean(one(db, 'SELECT 1 FROM plantings WHERE id = ? AND deleted_at IS NULL', id));
