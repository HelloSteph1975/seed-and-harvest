import { Router } from 'express';
import { versionOf } from './crud.js';
import { repos } from '../db/repos.js';
import { HttpError, idParam, notFound, queryId } from '../http.js';
import { reorder, reorderItems } from '../services/reorder.js';
import { createSpace, updateSpace, deleteSpace, restoreSpace, listSpaces } from '../services/spaces.js';

function placeOf(v) {
  const id = queryId(typeof v === 'number' ? String(v) : v);
  if (!id) throw new HttpError(400, 'Please choose a place.', { place_id: 'Required' }, { code: 'invalid', detailCodes: { place_id: { code: 'required' } } });
  return id;
}

export function spacesRouter(ctx) {
  const r = Router();
  r.get('/', (req, res) => res.json(listSpaces(ctx.db, placeOf(req.query.place_id))));
  r.post('/reorder', (req, res) => {
    const placeId = placeOf(req.body?.place_id);
    reorder(ctx.db, 'spaces', reorderItems(req.body), { where: 'place_id = ?', params: [placeId] });
    res.json(listSpaces(ctx.db, placeId));
  });
  r.get('/:id', (req, res) => {
    const row = repos(ctx.db).spaces.get(idParam(req));
    if (!row) throw notFound();
    res.json(row);
  });
  r.post('/', (req, res) => res.status(201).json(createSpace(ctx.db, req.body)));
  r.patch('/:id', (req, res) => res.json(updateSpace(ctx.db, idParam(req), req.body, versionOf(req.body))));
  r.delete('/:id', (req, res) => { deleteSpace(ctx, idParam(req)); res.json({ ok: true }); });
  r.post('/:id/restore', (req, res) => res.json(restoreSpace(ctx, idParam(req))));
  return r;
}
