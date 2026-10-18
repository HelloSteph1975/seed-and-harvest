import { repos } from '../db/repos.js';
import { transaction } from '../db/connection.js';
import { HttpError, notInTrash } from '../http.js';
import { backupNow, rotateQuietly } from './backup.js';
import { restorePlace, purgePlace } from './places.js';
import { restoreSpace, purgeSpace } from './spaces.js';
import { restorePhoto, purgePhoto } from './photos.js';

function recordRemoved(db, row) {
  if (row.starter_key) db.prepare('INSERT OR IGNORE INTO starter_removed (starter_key) VALUES (?)').run(row.starter_key);
}

function purgeRow(db, repo, row) {
  recordRemoved(db, row);
  repo.purge(row.id);
}

// Every kind of record that can be in the Trash. Later tasks add theirs here.
// Emptying the Trash goes in this order, so records go before the records they point at.
// `parentOf` names the record a row belongs to ("place:3"): one deleted with its parent (same
// deleted time) is counted on the parent's row instead of listed on its own.
// `restore(ctx, id)` and `purge(ctx, row)` replace the plain repo restore and purge.
export const TRASH_TYPES = {
  photo: { repo: db => repos(db).photos, title: row => row.caption || row.filename, restore: restorePhoto, purge: purgePhoto,
    parentOf: row => `${row.owner_type}:${row.owner_id}` },
  space: { repo: db => repos(db).spaces, title: row => row.name, restore: restoreSpace, purge: purgeSpace, parentOf: row => `place:${row.place_id}` },
  place: { repo: db => repos(db).places, title: row => row.name, restore: restorePlace, purge: purgePlace },
};

function typeOf(type) {
  if (!Object.hasOwn(TRASH_TYPES, type)) throw new HttpError(404, 'Unknown kind of record', undefined, { code: 'unknown_kind' });
  return TRASH_TYPES[type];
}

// A parent row counts its children deleted with it in `extra` and the ones of it deleted earlier on
// their own in `earlier`; those earlier ones are listed with `parentInTrash: true`.
export function listTrash(db) {
  const rows = Object.entries(TRASH_TYPES).flatMap(([type, t]) => t.repo(db).listDeleted().map(row => ({ type, t, row })));
  const stamps = new Map(rows.map(r => [`${r.type}:${r.row.id}`, r.row.deleted_at]));
  const extra = new Map();
  const earlier = new Map();
  const add = (map, k) => map.set(k, (map.get(k) ?? 0) + 1);
  const out = [];
  for (const { type, t, row } of rows) {
    const item = { type, id: row.id, title: t.title(row), deleted_at: row.deleted_at, starter_key: row.is_starter ? row.starter_key ?? null : null };
    if (t.parentOf) {
      const parentKey = t.parentOf(row);
      if (stamps.has(parentKey)) {
        if (stamps.get(parentKey) === row.deleted_at) { add(extra, parentKey); continue; }
        add(earlier, parentKey);
        item.parentInTrash = true;
      }
    }
    out.push(item);
  }
  for (const item of out) {
    const k = `${item.type}:${item.id}`;
    if (extra.has(k) || earlier.has(k)) Object.assign(item, { extra: extra.get(k) ?? 0, earlier: earlier.get(k) ?? 0 });
  }
  return out.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at) || b.id - a.id);
}

export function restoreFromTrash(ctx, type, id) {
  const t = typeOf(type);
  if (t.restore) return t.restore(ctx, id);
  const ok = transaction(ctx.db, () => t.repo(ctx.db).restore(id));
  if (!ok) throw notInTrash();
  return t.repo(ctx.db).get(id);
}

function purge(ctx, t, row) {
  if (t.purge) t.purge(ctx, row);
  else purgeRow(ctx.db, t.repo(ctx.db), row);
}

export function deleteForever(ctx, type, id) {
  const t = typeOf(type);
  transaction(ctx.db, () => {
    const row = t.repo(ctx.db).get(id, { includeDeleted: true });
    if (!row || !row.deleted_at) throw notInTrash();
    purge(ctx, t, row);
  });
  return true;
}

export function emptyTrash(ctx, { discard } = {}) {
  const { name } = backupNow(ctx.db, ctx.config.dataDir, { kind: 'pre-empty' });
  const removed = transaction(ctx.db, () => {
    // Counts the rows the owner saw in the Trash list.
    const n = listTrash(ctx.db).length;
    for (const t of Object.values(TRASH_TYPES)) {
      for (const row of t.repo(ctx.db).listDeleted()) purge(ctx, t, row);
    }
    return n;
  });
  rotateQuietly(ctx.config.dataDir, discard);
  return { removed, backup: name };
}
