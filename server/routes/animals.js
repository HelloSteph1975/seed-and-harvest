import { Router } from 'express';
import { versionOf } from './crud.js';
import { idParam, notFound } from '../http.js';
import { repos } from '../db/repos.js';
import { listAnimals, createAnimal, updateAnimal, deleteAnimal, restoreAnimal } from '../services/animals.js';

export function animalsRouter(ctx) {
  const r = Router();
  r.get('/', (req, res) => res.json(listAnimals(ctx.db)));
  r.get('/:id', (req, res) => {
    const row = repos(ctx.db).animals.get(idParam(req));
    if (!row) throw notFound();
    res.json(row);
  });
  r.post('/', (req, res) => res.status(201).json(createAnimal(ctx.db, req.body)));
  r.patch('/:id', (req, res) => res.json(updateAnimal(ctx.db, idParam(req), req.body, versionOf(req.body))));
  r.delete('/:id', (req, res) => { deleteAnimal(ctx.db, idParam(req)); res.json({ ok: true }); });
  r.post('/:id/restore', (req, res) => res.json(restoreAnimal(ctx, idParam(req))));
  return r;
}
