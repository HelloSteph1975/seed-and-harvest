import { Router } from 'express';
import { versionOf } from './crud.js';
import { HttpError, idParam, queryId } from '../http.js';
import { reorder, reorderItems } from '../services/reorder.js';
import { listGoals, getGoal, createGoal, updateGoal, deleteGoal, restoreGoal, toBuy } from '../services/goals.js';

const yearParam = v => (/^\d{4}$/.test(v ?? '') ? Number(v) : NaN);

export function goalsRouter(ctx) {
  const r = Router();
  r.get('/', (req, res) => res.json(listGoals(ctx.db, yearParam(req.query.year))));
  r.post('/reorder', (req, res) => {
    const year = yearParam(req.query.year ?? String(req.body?.year ?? ''));
    listGoals(ctx.db, year);
    reorder(ctx.db, 'pantry_goals', reorderItems(req.body), { where: 'year = ?', params: [year] });
    res.json(listGoals(ctx.db, year));
  });
  r.get('/:id', (req, res) => res.json(getGoal(ctx.db, idParam(req))));
  r.post('/', (req, res) => res.status(201).json(createGoal(ctx.db, req.body)));
  r.patch('/:id', (req, res) => res.json(updateGoal(ctx.db, idParam(req), req.body, versionOf(req.body))));
  r.delete('/:id', (req, res) => { deleteGoal(ctx.db, idParam(req)); res.json({ ok: true }); });
  r.post('/:id/restore', (req, res) => res.json(restoreGoal(ctx, idParam(req))));
  return r;
}

export function planRouter(ctx) {
  const r = Router();
  r.get('/to-buy', (req, res) => {
    const place_id = queryId(req.query.place_id);
    if (!place_id) throw new HttpError(400, 'Pick a place', undefined, { code: 'bad_id' });
    res.json(toBuy(ctx.db, { year: yearParam(req.query.year), place_id }));
  });
  return r;
}
