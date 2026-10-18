import { Router } from 'express';
import { HttpError } from '../http.js';
import { trashRouter } from './trash.js';
import { placesRouter } from './places.js';
import { spacesRouter } from './spaces.js';
import { climateRouter } from './climate.js';
import { photosRouter } from './photos.js';
import { plantsRouter, varietiesRouter, guidesRouter } from './library.js';
import { searchRouter } from './search.js';
import { plantingsRouter, logRouter, tasksRouter, suppliesRouter } from './plantings.js';
import { systemRouter } from './system.js';
import { settingsRouter } from './settings.js';
import { localesRouter } from './locales.js';

export function apiRouter(ctx, { onShutdown }) {
  const r = Router();
  r.get('/health', (req, res) => res.json({ ok: true, version: '0.1.0', demo: ctx.config.demo }));
  r.use('/places', placesRouter(ctx));
  r.use('/spaces', spacesRouter(ctx));
  r.use('/climate', climateRouter(ctx));
  r.use('/photos', photosRouter(ctx));
  r.use('/plants', plantsRouter(ctx));
  r.use('/varieties', varietiesRouter(ctx));
  r.use('/guides', guidesRouter(ctx));
  r.use('/plantings', plantingsRouter(ctx));
  r.use('/log', logRouter(ctx));
  r.use('/tasks', tasksRouter(ctx));
  r.use('/supplies', suppliesRouter(ctx));
  r.use('/search', searchRouter(ctx));
  r.use('/trash', trashRouter(ctx));
  r.use('/settings', settingsRouter(ctx));
  r.use('/locales', localesRouter(ctx));
  r.use(systemRouter(ctx, { onShutdown }));
  r.use((req, res, next) => next(new HttpError(404, 'No such API route', undefined, { code: 'not_found' })));
  return r;
}
