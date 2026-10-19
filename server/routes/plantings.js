import { Router } from 'express';
import { versionOf } from './crud.js';
import { HttpError, idParam, queryId } from '../http.js';
import { createTask, updateTask, deleteTask, restoreTask, listTasks, listSupplies } from '../services/tasks.js';
import { listPlantings, getPlanting, previewPlanting, movePlanting, createPlanting, updatePlanting, deletePlanting, restorePlanting } from '../services/plantings.js';
import { createLogEntry, updateLogEntry, deleteLogEntry, restoreLogEntry } from '../services/plantingLog.js';

const opt = v => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function plantingsRouter(ctx) {
  const r = Router();
  r.get('/', (req, res) => res.json(listPlantings(ctx.db, {
    place_id: queryId(req.query.place_id), space_id: queryId(req.query.space_id), plant_id: queryId(req.query.plant_id), status: opt(req.query.status), perennial: req.query.perennial === '1',
  })));
  r.post('/preview', (req, res) => res.json(previewPlanting(ctx.db, req.body)));
  r.get('/:id', (req, res) => res.json(getPlanting(ctx.db, idParam(req))));
  r.post('/', (req, res) => res.status(201).json(createPlanting(ctx.db, req.body)));
  r.patch('/:id', (req, res) => res.json(updatePlanting(ctx.db, idParam(req), req.body, versionOf(req.body))));
  r.delete('/:id', (req, res) => { deletePlanting(ctx, idParam(req)); res.json({ ok: true }); });
  r.post('/:id/restore', (req, res) => res.json(restorePlanting(ctx, idParam(req))));
  r.post('/:id/move', (req, res) => { versionOf(req.body); res.json(movePlanting(ctx.db, idParam(req), req.body)); });
  r.post('/:id/tasks', (req, res) => res.status(201).json(createTask(ctx.db, idParam(req), req.body)));
  r.post('/:id/log', (req, res) => res.status(201).json(createLogEntry(ctx.db, idParam(req), req.body)));
  return r;
}

export function logRouter(ctx) {
  const r = Router();
  r.patch('/:id', (req, res) => res.json(updateLogEntry(ctx.db, idParam(req), req.body, versionOf(req.body))));
  r.delete('/:id', (req, res) => { deleteLogEntry(ctx, idParam(req)); res.json({ ok: true }); });
  r.post('/:id/restore', (req, res) => res.json(restoreLogEntry(ctx, idParam(req))));
  return r;
}

const placeOf = req => {
  const id = queryId(req.query.place_id);
  if (!id) throw new HttpError(400, 'Pick a place', undefined, { code: 'bad_id' });
  return id;
};

export function tasksRouter(ctx) {
  const r = Router();
  r.get('/', (req, res) => res.json(listTasks(ctx.db, { place_id: placeOf(req), from: req.query.from, to: req.query.to, open: req.query.open === '1' })));
  r.patch('/:id', (req, res) => res.json(updateTask(ctx, idParam(req), req.body, versionOf(req.body))));
  r.delete('/:id', (req, res) => { deleteTask(ctx.db, idParam(req)); res.json({ ok: true }); });
  r.post('/:id/restore', (req, res) => res.json(restoreTask(ctx, idParam(req))));
  return r;
}

export function suppliesRouter(ctx) {
  const r = Router();
  r.get('/', (req, res) => res.json(listSupplies(ctx.db, { place_id: placeOf(req), from: req.query.from, to: req.query.to })));
  return r;
}
