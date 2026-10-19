import { Router } from 'express';
import { getSettings, saveSettings } from '../services/settings.js';
import { listLocales } from '../services/locales.js';
import { sendAll, testLink } from '../services/larder.js';

export function settingsRouter(ctx) {
  const r = Router();
  r.get('/', (req, res) => res.json(getSettings(ctx.db)));
  r.put('/', (req, res) => {
    const languages = listLocales(ctx.config.dataDir).map(l => l.code);
    const was = getSettings(ctx.db).larder_link;
    const out = saveSettings(ctx.db, req.body, { languages });
    if (!was && out.larder_link) sendAll(ctx);
    res.json(out);
  });
  r.post('/larder-test', async (req, res) => res.json(await testLink(ctx)));
  return r;
}
