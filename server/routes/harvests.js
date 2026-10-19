import { Router } from 'express';
import { versionOf } from './crud.js';
import { HttpError, idParam, queryId } from '../http.js';
import { yearSummary } from '../services/summary.js';
import { listHarvests, getHarvest, createHarvest, updateHarvest, deleteHarvest, restoreHarvest, sendAgain } from '../services/harvests.js';

const yearOf = v => {
  if (v === undefined || v === '') return undefined;
  if (!/^\d{4}$/.test(v)) throw new HttpError(400, 'Bad year', undefined, { code: 'bad_year' });
  return Number(v);
};

export function harvestsRouter(ctx) {
  const r = Router();
  r.get('/', (req, res) => res.json(listHarvests(ctx.db, { place_id: queryId(req.query.place_id), year: yearOf(req.query.year),
    planting_id: queryId(req.query.planting_id), tray_id: queryId(req.query.tray_id) })));
  r.get('/:id', (req, res) => res.json(getHarvest(ctx.db, idParam(req))));
  r.post('/', (req, res) => res.status(201).json(createHarvest(ctx, req.body)));
  r.patch('/:id', (req, res) => res.json(updateHarvest(ctx, idParam(req), req.body, versionOf(req.body))));
  r.delete('/:id', (req, res) => { deleteHarvest(ctx, idParam(req)); res.json({ ok: true }); });
  r.post('/:id/restore', (req, res) => res.json(restoreHarvest(ctx, idParam(req))));
  r.post('/:id/send', (req, res) => res.json(sendAgain(ctx, idParam(req))));
  return r;
}

export function summaryRouter(ctx) {
  const r = Router();
  r.get('/', (req, res) => {
    const year = yearOf(req.query.year);
    if (year == null) throw new HttpError(400, 'Pick a year', undefined, { code: 'bad_year' });
    const names = new Map(ctx.db.prepare('SELECT id, name FROM places').all().map(p => [p.id, p.name]));
    res.json(yearSummary(ctx.db, { year, place_id: queryId(req.query.place_id) }, names));
  });
  return r;
}
