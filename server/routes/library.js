import { Router } from 'express';
import { versionOf } from './crud.js';
import { idParam } from '../http.js';
import { listPlants, getPlant, createPlant, updatePlant, deletePlant, restorePlant,
  createVariety, updateVariety, deleteVariety, restoreVariety } from '../services/plants.js';
import { listBasics, getGuide, createGuide, updateGuide, deleteGuide, restoreGuide } from '../services/guides.js';

const opt = v => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function plantsRouter(ctx) {
  const r = Router();
  r.get('/', (req, res) => res.json(listPlants(ctx.db, { kind: opt(req.query.kind), q: opt(req.query.q) })));
  r.get('/:id', (req, res) => res.json(getPlant(ctx.db, idParam(req))));
  r.post('/', (req, res) => res.status(201).json(createPlant(ctx.db, req.body)));
  r.patch('/:id', (req, res) => res.json(updatePlant(ctx.db, idParam(req), req.body, versionOf(req.body))));
  r.delete('/:id', (req, res) => { deletePlant(ctx, idParam(req)); res.json({ ok: true }); });
  r.post('/:id/restore', (req, res) => res.json(restorePlant(ctx, idParam(req))));
  r.post('/:id/varieties', (req, res) => res.status(201).json(createVariety(ctx.db, idParam(req), req.body)));
  return r;
}

export function varietiesRouter(ctx) {
  const r = Router();
  r.patch('/:id', (req, res) => res.json(updateVariety(ctx.db, idParam(req), req.body, versionOf(req.body))));
  r.delete('/:id', (req, res) => { deleteVariety(ctx.db, idParam(req)); res.json({ ok: true }); });
  r.post('/:id/restore', (req, res) => res.json(restoreVariety(ctx, idParam(req))));
  return r;
}

export function guidesRouter(ctx) {
  const r = Router();
  r.get('/', (req, res) => res.json(listBasics(ctx.db)));
  r.get('/:id', (req, res) => res.json(getGuide(ctx.db, idParam(req))));
  r.post('/', (req, res) => res.status(201).json(createGuide(ctx.db, req.body)));
  r.patch('/:id', (req, res) => res.json(updateGuide(ctx.db, idParam(req), req.body, versionOf(req.body))));
  r.delete('/:id', (req, res) => { deleteGuide(ctx.db, idParam(req)); res.json({ ok: true }); });
  r.post('/:id/restore', (req, res) => res.json(restoreGuide(ctx, idParam(req))));
  return r;
}
