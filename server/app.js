import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './routes/index.js';
import { epochGuard, errorHandler, hostGuard } from './http.js';
import { PHOTO_NAME } from './services/photos.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp(ctx, { onShutdown = () => {} } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
  app.use(['/api', '/photos'], hostGuard);
  // Only photo-shaped names are served from the photos folder, never the database or backups.
  app.use('/photos', (req, res, next) => (PHOTO_NAME.test(req.path.slice(1)) ? next() : res.sendStatus(404)));
  app.use('/photos', express.static(path.join(ctx.config.dataDir, 'photos'), { maxAge: '7d', fallthrough: false }));
  app.use('/api', epochGuard(ctx));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRouter(ctx, { onShutdown }));
  // Browser tests build into another folder and point here, so they never touch the real build.
  const dist = process.env.SEED_HARVEST_CLIENT_DIST ? path.resolve(process.env.SEED_HARVEST_CLIENT_DIST) : path.join(ROOT, 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/|photos\/).*/, (req, res) => res.sendFile('index.html', { root: dist }));
  }
  app.use(errorHandler);
  return app;
}
