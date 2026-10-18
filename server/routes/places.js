import { Router } from 'express';
import { versionOf } from './crud.js';
import { repos } from '../db/repos.js';
import { idParam, notFound } from '../http.js';
import { reorder, reorderItems } from '../services/reorder.js';
import { createPlace, updatePlace, deletePlace, restorePlace } from '../services/places.js';

export function placesRouter(ctx) {
  const r = Router();
  const places = () => repos(ctx.db).places;
  r.get('/', (req, res) => res.json(places().list()));
  r.post('/reorder', (req, res) => { reorder(ctx.db, 'places', reorderItems(req.body)); res.json(places().list()); });
  r.get('/:id', (req, res) => {
    const row = places().get(idParam(req));
    if (!row) throw notFound();
    res.json(row);
  });
  r.post('/', (req, res) => res.status(201).json(createPlace(ctx.db, req.body)));
  r.patch('/:id', (req, res) => res.json(updatePlace(ctx.db, idParam(req), req.body, versionOf(req.body))));
  r.delete('/:id', (req, res) => { deletePlace(ctx, idParam(req)); res.json({ ok: true }); });
  r.post('/:id/restore', (req, res) => res.json(restorePlace(ctx, idParam(req))));
  return r;
}
