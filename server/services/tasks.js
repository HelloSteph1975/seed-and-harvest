import { transaction } from '../db/connection.js';
import { repos } from '../db/repos.js';
import { VersionConflict } from '../db/repo.js';
import { HttpError, notFound, notInTrash } from '../http.js';
import { validate } from '../validate.js';
import { addErrors, collector, invalid } from './fields.js';
import { livePlanting } from './plantings.js';
import { cascadeDeletePhotos } from './photos.js';
import { fold } from './plants.js';

export const TASK_KINDS = ['start_seeds', 'pot_up', 'harden_off', 'transplant', 'plant', 'sow', 'thin', 'feed', 'pests', 'harvest', 'other', 'prune', 'mulch', 'protect', 'check_pot'];

export const TASK_SCHEMA = {
  kind: TASK_KINDS,
  title: { type: 'string', maxLength: 120 },
  due_on: { type: 'date', required: true },
  end_on: { type: 'date' },
  done_on: { type: 'date' },
  guide_id: { type: 'int', min: 1 },
  notes: { type: 'string', maxLength: 2000 },
};
// Changing any of these makes the task the owner's: the rules leave it alone from then on.
const OWNER_FIELDS = ['due_on', 'end_on', 'title', 'notes', 'guide_id', 'kind'];

// What a finished task writes in the planting's log, and how far it moves the planting along.
const LOG_KIND = { start_seeds: 'sowed', sow: 'sowed', transplant: 'transplanted', plant: 'planted', thin: 'thinned', feed: 'fed', harvest: 'harvested',
  prune: 'pruned', mulch: 'mulched', protect: 'protected' };
const STATUS_AFTER = { sowed: 'started', transplanted: 'growing', planted: 'growing', harvested: 'harvesting' };
const ORDER = ['planned', 'started', 'growing', 'harvesting', 'done'];

function parse(db, body, existing) {
  const c = collector();
  const r = validate(TASK_SCHEMA, body ?? {}, { partial: Boolean(existing) });
  addErrors(c, r);
  const data = { ...(r.data ?? {}) };
  const merged = { ...existing, ...data };
  if (data.guide_id != null && !c.errors.guide_id && !db.prepare('SELECT 1 FROM guides WHERE id = ? AND deleted_at IS NULL').get(data.guide_id)) {
    c.fail('guide_id', 'That guide is gone', 'guide_gone');
  }
  if (!c.errors.title && (merged.kind ?? 'other') === 'other' && !merged.title) c.fail('title', 'Required', 'required');
  if (!c.any() && merged.end_on && merged.end_on < merged.due_on) c.fail('end_on', 'This must not be before the first date', 'range_order');
  if (c.any()) throw invalid(c.errors, c.codes);
  return data;
}

export function createTask(db, plantingId, body) {
  return transaction(db, () => {
    if (!livePlanting(db, plantingId)) throw notFound();
    const data = parse(db, body, null);
    return repos(db).tasks.create({ kind: 'other', ...data, planting_id: plantingId, auto: 0, edited: 0 });
  });
}

function logFinished(db, task, doneOn) {
  const kind = LOG_KIND[task.kind] ?? 'note';
  repos(db).log.create({ planting_id: task.planting_id, on_date: doneOn, kind, note: kind === 'note' ? task.title ?? null : null, task_id: task.id });
  const next = STATUS_AFTER[kind];
  const planting = db.prepare('SELECT status FROM plantings WHERE id = ?').get(task.planting_id);
  if (next && ORDER.indexOf(next) > ORDER.indexOf(planting.status)) {
    db.prepare('UPDATE plantings SET status = ?, version = version + 1 WHERE id = ?').run(next, task.planting_id);
  }
}

export function updateTask(ctx, id, body, version) {
  const { db } = ctx;
  return transaction(db, () => {
    const existing = repos(db).tasks.get(id);
    if (!existing) throw notFound();
    const data = parse(db, body, existing);
    if (OWNER_FIELDS.some(k => data[k] !== undefined && data[k] !== existing[k])) data.edited = 1;
    let row;
    try { row = repos(db).tasks.update(id, data, version); } catch (err) {
      if (err instanceof VersionConflict) throw new VersionConflict(repos(db).tasks.get(id));
      throw err;
    }
    if (!row) throw notFound();
    if (data.done_on !== undefined && data.done_on !== existing.done_on) {
      // A changed done date replaces the log entry it made before. An entry the owner has edited is
      // theirs: it stays in the log, no longer tied to the task.
      for (const e of db.prepare('SELECT id, version FROM planting_log WHERE task_id = ? AND deleted_at IS NULL').all(id)) {
        if (e.version > 1) { db.prepare('UPDATE planting_log SET task_id = NULL WHERE id = ?').run(e.id); continue; }
        db.prepare('UPDATE planting_log SET deleted_at = ?, version = version + 1 WHERE id = ?').run(row.updated_at, e.id);
        cascadeDeletePhotos(ctx, 'log', e.id, row.updated_at);
      }
      if (data.done_on) logFinished(db, row, data.done_on);
    }
    return row;
  });
}

export function deleteTask(db, id) {
  transaction(db, () => { if (!repos(db).tasks.remove(id)) throw notFound(); });
}

export function restoreTask(ctx, id) {
  return transaction(ctx.db, () => {
    const row = repos(ctx.db).tasks.get(id, { includeDeleted: true });
    if (!row || !row.deleted_at) throw notInTrash();
    if (!livePlanting(ctx.db, row.planting_id)) throw new HttpError(409, 'Restore its planting first.', undefined, { code: 'parent_in_trash' });
    repos(ctx.db).tasks.restore(id);
    return repos(ctx.db).tasks.get(id);
  });
}

// A log entry that came from this task keeps its date and note, without the link.
export function purgeTask(ctx, row) {
  ctx.db.prepare('UPDATE planting_log SET task_id = NULL WHERE task_id = ?').run(row.id);
  // A care task deleted forever stays deleted: its season is remembered so it isn't made again.
  if (row.season_key) ctx.db.prepare('INSERT OR IGNORE INTO care_skipped (planting_id, season_key) VALUES (?, ?)').run(row.planting_id, row.season_key);
  repos(ctx.db).tasks.purge(row.id);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function range(from, to) {
  if (!ISO.test(from ?? '') || !ISO.test(to ?? '') || from > to) throw new HttpError(400, 'Give a from and to date', undefined, { code: 'bad_range' });
}

const TASK_SELECT = `SELECT t.*, pl.status AS planting_status, p.id AS plant_id, p.name AS plant_name, p.starter_key AS plant_key, p.is_starter AS plant_starter,
  v.name AS variety_name, s.id AS space_id, s.name AS space_name, s.sort_order AS space_order, g.title AS guide_title, g.starter_key AS guide_key, g.is_starter AS guide_starter
  FROM tasks t JOIN plantings pl ON pl.id = t.planting_id AND pl.deleted_at IS NULL
  JOIN plants p ON p.id = pl.plant_id JOIN spaces s ON s.id = pl.space_id AND s.deleted_at IS NULL
  LEFT JOIN plant_varieties v ON v.id = pl.variety_id AND v.deleted_at IS NULL
  LEFT JOIN guides g ON g.id = t.guide_id AND g.deleted_at IS NULL`;

function shapeTask(r) {
  const { planting_status, plant_id, plant_name, plant_key, plant_starter, variety_name, space_id, space_name, space_order, guide_title, guide_key, guide_starter, ...t } = r;
  return {
    ...t,
    planting: { id: t.planting_id, status: planting_status },
    plant: { id: plant_id, name: plant_name, starter_key: plant_key, is_starter: plant_starter },
    variety_name,
    space: { id: space_id, name: space_name, sort_order: space_order },
    guide: guide_title != null ? { id: t.guide_id, title: guide_title, starter_key: guide_key, is_starter: guide_starter } : null,
  };
}

// Tasks at a place whose day (or window) touches the range. With `open`, every unfinished task
// before the range comes too, so overdue work never drops out of sight, and so does anything
// finished during the range.
export function listTasks(db, { place_id, from, to, open = false }) {
  range(from, to);
  const where = ['t.deleted_at IS NULL', 's.place_id = ?', "pl.status != 'done'"];
  const args = [place_id];
  const inRange = 't.due_on <= ? AND COALESCE(t.end_on, t.due_on) >= ?';
  if (open) {
    where.push(`((${inRange}) OR (t.done_on IS NULL AND t.due_on < ?) OR (t.done_on >= ? AND t.done_on <= ?))`);
    args.push(to, from, from, from, to);
  } else { where.push(inRange); args.push(to, from); }
  return db.prepare(`${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.due_on, s.sort_order, s.name COLLATE NOCASE, t.id`).all(...args).map(shapeTask);
}

// What the unfinished tasks in the range need, one row per supply name (matched without case or
// accents), each listing the tasks that need it.
export function listSupplies(db, { place_id, from, to }) {
  range(from, to);
  const rows = db.prepare(`SELECT t.id AS task_id, t.kind AS task_kind, t.title AS task_title, t.due_on, p.name AS plant_name, p.starter_key AS plant_key,
      p.is_starter AS plant_starter, gs.name, gs.amount, gs.position, g.starter_key AS guide_key, g.is_starter AS guide_starter
    FROM tasks t JOIN plantings pl ON pl.id = t.planting_id AND pl.deleted_at IS NULL JOIN plants p ON p.id = pl.plant_id
    JOIN spaces s ON s.id = pl.space_id AND s.deleted_at IS NULL
    JOIN guides g ON g.id = t.guide_id AND g.deleted_at IS NULL JOIN guide_supplies gs ON gs.guide_id = g.id
    WHERE t.deleted_at IS NULL AND t.done_on IS NULL AND pl.status != 'done' AND s.place_id = ? AND t.due_on <= ? AND COALESCE(t.end_on, t.due_on) >= ?
    ORDER BY t.due_on, t.id, gs.position`).all(place_id, to, from);
  const groups = new Map();
  for (const r of rows) {
    const key = fold(r.name).trim();
    if (!groups.has(key)) groups.set(key, { name: r.name, starter_key: r.guide_starter ? r.guide_key : null, index: r.position, items: [] });
    groups.get(key).items.push({
      task_id: r.task_id, task_kind: r.task_kind, task_title: r.task_title, due_on: r.due_on, amount: r.amount,
      plant: { name: r.plant_name, starter_key: r.plant_key, is_starter: r.plant_starter },
    });
  }
  return [...groups.values()].sort((a, b) => fold(a.name).localeCompare(fold(b.name)));
}
