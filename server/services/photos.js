import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { transaction } from '../db/connection.js';
import { NOW } from '../db/migrations.js';
import { repos } from '../db/repos.js';
import { HttpError, notFound, notInTrash } from '../http.js';
import { listBackups } from './backup.js';

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
export const ALLOWED_TYPES = Object.keys(EXT);
// The shape savePhotoFile gives every photo: <timestamp>-<8 hex>.<ext>.
export const PHOTO_NAME = /^\d+-[0-9a-f]{8}\.(jpg|png|webp|gif)$/i;

// Kinds of record a photo can belong to, and their tables. Later stages add more.
export const PHOTO_OWNERS = { space: 'spaces', plant: 'plants', planting: 'plantings', log: 'planting_log' };

// Live photos sit in photos\. Photos in the Trash sit in photos\_trash\. Photos removed for good
// wait in photos\_removed\ until no kept backup could still bring their rows back.
const live = (dataDir, f) => path.join(dataDir, 'photos', f);
const trashed = (dataDir, f) => path.join(dataDir, 'photos', '_trash', f);
const removed = (dataDir, f) => path.join(dataDir, 'photos', '_removed', f);

export function savePhotoFile(dataDir, buffer, mimetype) {
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${EXT[mimetype]}`;
  fs.mkdirSync(path.join(dataDir, 'photos'), { recursive: true });
  fs.writeFileSync(live(dataDir, filename), buffer);
  return filename;
}

// Best effort: a file another program holds open stays where it is, and the save still goes
// through. untrashLivePhotos puts back any live photo whose file ended up in the trash folder.
function move(from, to, { stamp = false } = {}) {
  try {
    if (!fs.existsSync(from)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    // A removed file's age counts from its removal, so the clean-up knows when backups stop needing it.
    if (stamp) { const now = new Date(); fs.utimesSync(to, now, now); }
  } catch (err) {
    console.error(`Could not move photo file ${path.basename(from)}:`, err.message);
  }
}
const trashFile = (dataDir, f) => move(live(dataDir, f), trashed(dataDir, f));
const untrashFile = (dataDir, f) => move(trashed(dataDir, f), live(dataDir, f));

// Each photo row's file belongs in photos\ (live row) or photos\_trash (row in the Trash). After a
// backup restore, or a file move that failed, a file can be in another folder; put it where its row
// expects it. Best effort.
export function untrashLivePhotos(db, dataDir) {
  for (const { filename, deleted_at: deleted } of db.prepare('SELECT filename, deleted_at FROM photos').all()) {
    if (!PHOTO_NAME.test(filename)) continue;
    const want = deleted ? trashed(dataDir, filename) : live(dataDir, filename);
    if (fs.existsSync(want)) continue;
    const from = [live(dataDir, filename), trashed(dataDir, filename), removed(dataDir, filename)].find(f => f !== want && fs.existsSync(f));
    if (from) move(from, want);
  }
}

// At start: a removed photo file older than every kept backup can't come back with any of them,
// so it goes to the Recycle Bin. With no backups, nothing is thrown away.
export function cleanRemovedPhotos(ctx) {
  const dataDir = ctx.config.dataDir;
  const backups = listBackups(dataDir);
  const dir = path.join(dataDir, 'photos', '_removed');
  if (!backups.length || !fs.existsSync(dir)) return;
  const oldest = Math.min(...backups.map(b => Date.parse(b.modified)));
  const named = ctx.db.prepare('SELECT 1 FROM photos WHERE filename = ?');
  for (const name of fs.readdirSync(dir)) {
    // A file a photo row still names is never thrown away, however old.
    if (!PHOTO_NAME.test(name) || named.get(name)) continue;
    const file = path.join(dir, name);
    if (fs.statSync(file).mtimeMs < oldest) ctx.recycle(file, { dataDir });
  }
}

export const ownerIsLive = (db, ownerType, ownerId) => Object.hasOwn(PHOTO_OWNERS, ownerType)
  && Boolean(db.prepare(`SELECT 1 FROM ${PHOTO_OWNERS[ownerType]} WHERE id = ? AND deleted_at IS NULL`).get(ownerId));

export function listPhotos(db, ownerType, ownerId) {
  return db.prepare('SELECT * FROM photos WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(ownerType, ownerId);
}

function setCover(db, photo) {
  db.prepare(`UPDATE photos SET is_cover = CASE WHEN id = ? THEN 1 ELSE 0 END, version = version + 1, updated_at = ${NOW}
    WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL AND is_cover != CASE WHEN id = ? THEN 1 ELSE 0 END`)
    .run(photo.id, photo.owner_type, photo.owner_id, photo.id);
}
function coverNextIfNone(db, ownerType, ownerId) {
  if (db.prepare('SELECT 1 FROM photos WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL AND is_cover = 1').get(ownerType, ownerId)) return;
  const next = listPhotos(db, ownerType, ownerId)[0];
  if (next) setCover(db, next);
}

export function addPhoto(ctx, { ownerType, ownerId, caption, file }) {
  if (!file || !ALLOWED_TYPES.includes(file.mimetype)) {
    throw new HttpError(400, 'Please choose a JPEG, PNG, WebP or GIF image.', undefined, { code: 'not_image' });
  }
  if (!ownerIsLive(ctx.db, ownerType, ownerId)) throw new HttpError(400, 'That photo has nothing to belong to.', undefined, { code: 'photo_owner_gone' });
  const filename = savePhotoFile(ctx.config.dataDir, file.buffer, file.mimetype);
  try {
    return transaction(ctx.db, () => {
      const count = listPhotos(ctx.db, ownerType, ownerId).length;
      return repos(ctx.db).photos.create({
        owner_type: ownerType, owner_id: ownerId, filename,
        caption: typeof caption === 'string' ? caption.trim().slice(0, 300) || null : null,
        sort_order: count, is_cover: count === 0 ? 1 : 0,
      });
    });
  } catch (err) {
    fs.rmSync(live(ctx.config.dataDir, filename), { force: true });
    throw err;
  }
}

// Captions save with a version check. Making a photo the cover clears the others for that owner.
export function updatePhoto(db, id, { caption, makeCover }, version) {
  return transaction(db, () => {
    const photo = repos(db).photos.get(id);
    if (!photo) throw notFound();
    const data = caption === undefined ? {} : { caption };
    const row = repos(db).photos.update(id, data, version);
    if (!row) throw notFound();
    if (makeCover) setCover(db, row);
    return repos(db).photos.get(id);
  });
}

export function deletePhoto(ctx, id) {
  transaction(ctx.db, () => {
    const photo = repos(ctx.db).photos.get(id);
    if (!photo || !repos(ctx.db).photos.remove(id)) throw notFound();
    if (photo.is_cover) {
      ctx.db.prepare('UPDATE photos SET is_cover = 0 WHERE id = ?').run(id);
      coverNextIfNone(ctx.db, photo.owner_type, photo.owner_id);
    }
  });
  trashFile(ctx.config.dataDir, repos(ctx.db).photos.get(id, { includeDeleted: true }).filename);
}

export function restorePhoto(ctx, id) {
  return transaction(ctx.db, () => {
    const photo = repos(ctx.db).photos.get(id, { includeDeleted: true });
    if (!photo || !photo.deleted_at) throw notInTrash();
    if (!ownerIsLive(ctx.db, photo.owner_type, photo.owner_id)) {
      throw new HttpError(409, 'Restore what it belongs to first.', undefined, { code: 'parent_in_trash' });
    }
    repos(ctx.db).photos.restore(id);
    untrashFile(ctx.config.dataDir, photo.filename);
    coverNextIfNone(ctx.db, photo.owner_type, photo.owner_id);
    return repos(ctx.db).photos.get(id);
  });
}

// The owner's live photos go to the Trash with it, stamped with the owner's deleted time.
export function cascadeDeletePhotos(ctx, ownerType, ownerId, stamp) {
  const rows = listPhotos(ctx.db, ownerType, ownerId);
  ctx.db.prepare('UPDATE photos SET deleted_at = ?, version = version + 1 WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL')
    .run(stamp, ownerType, ownerId);
  for (const p of rows) trashFile(ctx.config.dataDir, p.filename);
}

// Brings back only the photos removed together with the owner (same stamp), not ones deleted earlier on their own.
export function cascadeRestorePhotos(ctx, ownerType, ownerId, stamp) {
  const rows = ctx.db.prepare('SELECT filename FROM photos WHERE owner_type = ? AND owner_id = ? AND deleted_at = ?').all(ownerType, ownerId, stamp);
  ctx.db.prepare(`UPDATE photos SET deleted_at = NULL, version = version + 1, updated_at = ${NOW} WHERE owner_type = ? AND owner_id = ? AND deleted_at = ?`)
    .run(ownerType, ownerId, stamp);
  for (const p of rows) untrashFile(ctx.config.dataDir, p.filename);
}

// Deletes a photo in the Trash for good. Its file moves to photos\_removed (from the trash folder,
// or from photos\ if an earlier move failed), where a backup restore can still find it.
export function purgePhoto(ctx, row) {
  repos(ctx.db).photos.purge(row.id);
  const dataDir = ctx.config.dataDir;
  for (const from of [trashed(dataDir, row.filename), live(dataDir, row.filename)]) {
    move(from, removed(dataDir, row.filename), { stamp: true });
  }
}

export function purgeOwnerPhotos(ctx, ownerType, ownerId) {
  for (const row of ctx.db.prepare('SELECT * FROM photos WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NOT NULL').all(ownerType, ownerId)) {
    purgePhoto(ctx, row);
  }
}
