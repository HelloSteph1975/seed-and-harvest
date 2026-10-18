import { Router } from 'express';
import multer from 'multer';
import { versionOf } from './crud.js';
import { repos } from '../db/repos.js';
import { check } from '../validate.js';
import { HttpError, idParam, notFound, queryId } from '../http.js';
import { addPhoto, updatePhoto, deletePhoto, restorePhoto, listPhotos, PHOTO_OWNERS } from '../services/photos.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

function uploadFile(req, res, next) {
  upload.single('file')(req, res, err => {
    if (!err) return next();
    if (err.name !== 'MulterError') return next(err);
    next(err.code === 'LIMIT_FILE_SIZE'
      ? new HttpError(413, 'That photo is too big (15 MB max).', undefined, { code: 'too_big_photo' })
      : new HttpError(400, 'That upload could not be read.', undefined, { code: 'bad_upload' }));
  });
}

const PATCH = { caption: { type: 'string', maxLength: 300 }, is_cover: 'bool' };

export function photosRouter(ctx) {
  const r = Router();
  r.get('/', (req, res) => {
    const type = req.query.owner_type;
    if (!Object.hasOwn(PHOTO_OWNERS, type)) throw new HttpError(400, 'Unknown kind of record', undefined, { code: 'unknown_kind' });
    res.json(listPhotos(ctx.db, type, queryId(req.query.owner_id)));
  });
  r.get('/:id', (req, res) => {
    const row = repos(ctx.db).photos.get(idParam(req));
    if (!row) throw notFound();
    res.json(row);
  });
  r.post('/', uploadFile, (req, res) => {
    const body = req.body ?? {};
    res.status(201).json(addPhoto(ctx, { ownerType: body.owner_type, ownerId: Number(body.owner_id), caption: body.caption, file: req.file }));
  });
  r.patch('/:id', (req, res) => {
    const version = versionOf(req.body);
    const data = check(PATCH, req.body, { partial: true });
    res.json(updatePhoto(ctx.db, idParam(req), { caption: data.caption, makeCover: data.is_cover === 1 }, version));
  });
  r.delete('/:id', (req, res) => { deletePhoto(ctx, idParam(req)); res.json({ ok: true }); });
  r.post('/:id/restore', (req, res) => res.json(restorePhoto(ctx, idParam(req))));
  return r;
}
