import { Router } from 'express';
import { versionOf } from './crud.js';
import { HttpError, idParam, queryId } from '../http.js';
import { listTrays, getTray, createTray, updateTray, deleteTray, restoreTray, sowAgain, dueTrays } from '../services/trays.js';

const opt = v => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function traysRouter(ctx) {
  const r = Router();
  r.get('/', (req, res) => res.json(listTrays(ctx.db, { place_id: queryId(req.query.place_id), space_id: queryId(req.query.space_id), status: opt(req.query.status) })));
  r.get('/due', (req, res) => {
    const place = queryId(req.query.place_id);
    if (!place) throw new HttpError(400, 'Pick a place', undefined, { code: 'bad_id' });
    res.json(dueTrays(ctx.db, { place_id: place, from: req.query.from, to: req.query.to }));
  });
  r.get('/:id', (req, res) => res.json(getTray(ctx.db, idParam(req))));
  r.post('/', (req, res) => res.status(201).json(createTray(ctx.db, req.body)));
  r.patch('/:id', (req, res) => res.json(updateTray(ctx.db, idParam(req), req.body, versionOf(req.body))));
  r.delete('/:id', (req, res) => { deleteTray(ctx, idParam(req)); res.json({ ok: true }); });
  r.post('/:id/restore', (req, res) => res.json(restoreTray(ctx, idParam(req))));
  r.post('/:id/sow-again', (req, res) => res.status(201).json(sowAgain(ctx.db, idParam(req), req.body)));
  return r;
}
