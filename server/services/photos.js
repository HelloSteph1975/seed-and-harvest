import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { transaction } from '../db/connection.js';
import { NOW } from '../db/migrations.js';
import { repos } from '../db/repos.js';
import { HttpError, notFound, notInTrash } from '../http.js';

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
export const ALLOWED_TYPES = Object.keys(EXT);
// The shape savePhotoFile gives every photo: <timestamp>-<8 hex>.<ext>.
export const PHOTO_NAME = /^\d+-[0-9a-f]{8}\.(jpg|png|webp|gif)$/i;

// Kinds of record a photo can belong to, and their tables. Later stages add more.
export const PHOTO_OWNERS = { space: 'spaces' };

const live = (dataDir, f) => path.join(dataDir, 'photos', f);
const trashed = (dataDir, f) => path.join(dataDir, 'photos', '_trash', f);

export function savePhotoFile(dataDir, buffer, mimetype) {
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${EXT[mimetype]}`;
  fs.mkdirSync(path.join(dataDir, 'photos'), { recursive: true });
  fs.writeFileSync(live(dataDir, filename), buffer);
  return filename;
}

// Best effort: a file another program holds open stays where it is, and the save still goes
// through. untrashLivePhotos puts back any live photo whose file ended up in the trash folder.
function move(from, to) {
  try {
    if (!fs.existsSync(from)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  } catch (err) {
    console.error(`Could not move photo file ${path.basename(from)}:`, err.message);
  }
}
const trashFile = (dataDir, f) => move(live(dataDir, f), trashed(dataDir, f));
const untrashFile = (dataDir, f) => move(trashed(dataDir, f), live(dataDir, f));

// After a backup restore, live photo rows may point at files that were trashed since the backup.
// Bring those back; best effort.
export function untrashLivePhotos(db, dataDir) {
  for (const { filename } of db.prepare('SELECT filename FROM photos WHERE deleted_at IS NULL').all()) {
    if (!PHOTO_NAME.test(filename) || fs.existsSync(live(dataDir, filename))) continue;
    try { untrashFile(dataDir, filename); } catch { /* leave it in the trash */ }
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

// Deletes a photo in the Trash for good; its file goes to the Recycle Bin.
export function purgePhoto(ctx, row) {
  repos(ctx.db).photos.purge(row.id);
  const file = trashed(ctx.config.dataDir, row.filename);
  if (fs.existsSync(file)) {
    try { ctx.recycle(file, { dataDir: ctx.config.dataDir }); } catch (err) { console.error('Could not recycle a photo file:', err.message); }
  }
}

export function purgeOwnerPhotos(ctx, ownerType, ownerId) {
  for (const row of ctx.db.prepare('SELECT * FROM photos WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NOT NULL').all(ownerType, ownerId)) {
    purgePhoto(ctx, row);
  }
}
