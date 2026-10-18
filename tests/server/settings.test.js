import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTestContext } from './helpers.js';
import { defaultSettings } from '../../server/services/settings.js';

let t;
beforeEach(() => { t = makeTestContext(); });
afterEach(() => t.cleanup());

describe('/api/settings', () => {
  it('returns defaults', async () => {
    const res = await t.http().get('/api/settings');
    expect(res.body).toMatchObject({ language: 'en' });
    expect(typeof res.body.time_zone).toBe('string');
  });
  it('saves valid values', async () => {
    const res = await t.http().put('/api/settings').send({ time_zone: 'Europe/Lisbon' });
    expect(res.body).toMatchObject({ time_zone: 'Europe/Lisbon' });
    expect((await t.http().get('/api/settings')).body.time_zone).toBe('Europe/Lisbon');
  });
  it('accepts a time zone alias', async () => {
    const res = await t.http().put('/api/settings').send({ time_zone: 'Asia/Calcutta' });
    expect(res.status).toBe(200);
    expect(res.body.time_zone).toBe('Asia/Calcutta');
  });
  it('rejects unknown keys and bad values and saves nothing', async () => {
    const before = (await t.http().get('/api/settings')).body.time_zone;
    const res = await t.http().put('/api/settings').send({ time_zone: 'Mars/Base', colour: 'x' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.details).sort()).toEqual(['colour', 'time_zone']);
    expect((await t.http().get('/api/settings')).body.time_zone).toBe(before);
  });
  it('accepts a language only when its pack exists', async () => {
    expect((await t.http().put('/api/settings').send({ language: 'es' })).status).toBe(400);
    const dir = path.join(t.dataDir, 'locales', 'es');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ui.json'), JSON.stringify({ _name: 'Español' }));
    expect((await t.http().put('/api/settings').send({ language: 'es' })).body.language).toBe('es');
  });
  it('units defaults from the machine region and saves', async () => {
    expect(defaultSettings({ region: 'US' }).units).toBe('us');
    expect(defaultSettings({ region: 'MX' }).units).toBe('metric');
    const res = await t.http().put('/api/settings').send({ units: 'metric' });
    expect(res.body.units).toBe('metric');
    expect((await t.http().get('/api/settings')).body.units).toBe('metric');
  });
  it('a bad units value is refused', async () => {
    const res = await t.http().put('/api/settings').send({ units: 'cubits' });
    expect(res.status).toBe(400);
    expect(res.body.details.units).toBeTruthy();
  });
  it('theme and hemisphere are no longer settings', async () => {
    expect((await t.http().put('/api/settings').send({ theme: 'old-book' })).status).toBe(400);
    expect((await t.http().put('/api/settings').send({ hemisphere: 'south' })).status).toBe(400);
  });
});
