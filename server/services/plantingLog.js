import { transaction } from '../db/connection.js';
import { repos } from '../db/repos.js';
import { HttpError, notFound, notInTrash } from '../http.js';
import { validate } from '../validate.js';
import { invalid } from './fields.js';
import { cascadeDeletePhotos, cascadeRestorePhotos, purgeOwnerPhotos } from './photos.js';
import { livePlanting } from './plantings.js';

export const LOG_KINDS = ['sowed', 'transplanted', 'planted', 'thinned', 'fed', 'pruned', 'watered', 'problem', 'harvested', 'note', 'mulched', 'protected', 'moved', 'repotted'];

export const LOG_SCHEMA = {
  on_date: { type: 'date', required: true },
  kind: { type: LOG_KINDS, required: true },
  note: { type: 'string', maxLength: 2000 },
};

export function createLogEntry(db, plantingId, body, { taskId = null } = {}) {
  return transaction(db, () => {
    if (!livePlanting(db, plantingId)) throw notFound();
    const r = validate(LOG_SCHEMA, body ?? {});
    if (r.errors) throw invalid(r.errors, r.codes);
    return repos(db).log.create({ ...r.data, planting_id: plantingId, task_id: taskId });
  });
}

export function updateLogEntry(db, id, body, version) {
  return transaction(db, () => {
    const r = validate(LOG_SCHEMA, body ?? {}, { partial: true });
    if (r.errors) throw invalid(r.errors, r.codes);
    const row = repos(db).log.update(id, r.data, version);
    if (!row) throw notFound();
    return row;
  });
}

export function deleteLogEntry(ctx, id, stamp = new Date().toISOString()) {
  transaction(ctx.db, () => {
    if (!repos(ctx.db).log.remove(id, stamp)) throw notFound();
    cascadeDeletePhotos(ctx, 'log', id, stamp);
  });
}

export function restoreLogEntry(ctx, id) {
  return transaction(ctx.db, () => {
    const row = repos(ctx.db).log.get(id, { includeDeleted: true });
    if (!row || !row.deleted_at) throw notInTrash();
    if (!livePlanting(ctx.db, row.planting_id)) throw new HttpError(409, 'Restore its planting first.', undefined, { code: 'parent_in_trash' });
    repos(ctx.db).log.restore(id);
    cascadeRestorePhotos(ctx, 'log', id, row.deleted_at);
    return repos(ctx.db).log.get(id);
  });
}

export function purgeLogEntry(ctx, row) {
  purgeOwnerPhotos(ctx, 'log', row.id);
  repos(ctx.db).log.purge(row.id);
}
