import { describe, it, expect, afterEach } from 'vitest';
import { makeTestContext } from './helpers.js';
import { zoneFromF, estimateFromDaily } from '../../server/services/climate.js';

let t;
afterEach(() => t?.cleanup());

// Thirty years of daily lows: `frosty(date)` says which days dip to -2 °C; every other day is 10 °C.
function daily(frosty, { from = 1995, to = 2024 } = {}) {
  const time = [];
  const temperature_2m_min = [];
  for (let d = new Date(Date.UTC(from, 0, 1)); d.getUTCFullYear() <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    time.push(iso);
    temperature_2m_min.push(frosty(iso) ? -2 : 10);
  }
  return { time, temperature_2m_min };
}
const md = iso => iso.slice(5);

const SERVICE_DOWN = "Couldn't reach the weather service. You can type the zone and frost dates yourself.";
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('zoneFromF', () => {
  it('turns the average coldest night into a zone', () => {
    expect(zoneFromF(0)).toBe('7a');
    expect(zoneFromF(-5)).toBe('6b');
    expect(zoneFromF(-0.1)).toBe('6b');
    expect(zoneFromF(34.9)).toBe('10a');
    expect(zoneFromF(-80)).toBe('1a');
    expect(zoneFromF(75)).toBe('13b');
  });
});

describe('estimateFromDaily', () => {
  it('finds northern frost dates', () => {
    const e = estimateFromDaily(daily(iso => md(iso) <= '03-20' || md(iso) >= '11-10'), 'north');
    expect(e).toMatchObject({ last_frost: '03-20', first_frost: '11-10', frost_free: false, years: 30 });
    expect(e.coldest_f).toBe(28.4);
    expect(e.zone).toBe('9b');
  });

  it('finds southern frost dates', () => {
    const e = estimateFromDaily(daily(iso => md(iso) >= '05-05' && md(iso) <= '09-15'), 'south');
    expect(e).toMatchObject({ last_frost: '09-15', first_frost: '05-05', frost_free: false });
  });

  it('calls a place frost-free when fewer than half the years have frost', () => {
    const e = estimateFromDaily(daily(iso => md(iso) === '01-15' && iso < '2005'), 'north');
    expect(e).toMatchObject({ frost_free: true, last_frost: null, first_frost: null });
  });
});

describe('climate routes', () => {
  it('search lists every match with region and country', async () => {
    t = makeTestContext({
      fetch: async () => json({ results: [
        { name: 'Springfield', admin1: 'Ohio', country: 'United States', country_code: 'US', latitude: 39.92, longitude: -83.81, timezone: 'America/New_York', elevation: 299 },
        { name: 'Springfield', admin1: 'Illinois', country: 'United States', country_code: 'US', latitude: 39.80, longitude: -89.64, timezone: 'America/Chicago' },
      ] }),
    });
    const res = await t.http().get('/api/climate/search?q=Springfield');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { label: 'Springfield, Ohio, United States', latitude: 39.92, longitude: -83.81, time_zone: 'America/New_York', country_code: 'US', elevation_m: 299 },
      { label: 'Springfield, Illinois, United States', latitude: 39.80, longitude: -89.64, time_zone: 'America/Chicago', country_code: 'US', elevation_m: null },
    ]);
  });

  it('search with no results says so', async () => {
    t = makeTestContext({ fetch: async () => json({ generationtime_ms: 0.1 }) });
    const res = await t.http().get('/api/climate/search?q=Nowhereville');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('search needs a name', async () => {
    t = makeTestContext({ fetch: async () => json({}) });
    expect((await t.http().get('/api/climate/search?q=%20')).status).toBe(400);
  });

  it('estimate sends hemisphere, zone and frost dates', async () => {
    let asked;
    t = makeTestContext({
      fetch: async url => { asked = String(url); return json({ daily: daily(iso => md(iso) <= '03-20' || md(iso) >= '11-10') }); },
    });
    const res = await t.http().get('/api/climate/estimate?latitude=39.92&longitude=-83.81');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hemisphere: 'north', zone: '9b', last_frost: '03-20', first_frost: '11-10', frost_free: false, source: 'Open-Meteo' });
    expect(asked).toContain('archive-api.open-meteo.com');
    expect(asked).toContain('latitude=39.92');
  });

  it('estimate uses the elevation given for the land and says which one it used', async () => {
    let asked;
    t = makeTestContext({
      fetch: async url => { asked = String(url); return json({ elevation: 2450, daily: daily(iso => md(iso) <= '05-20' || md(iso) >= '09-25') }); },
    });
    const res = await t.http().get('/api/climate/estimate?latitude=34.15&longitude=-107.85&elevation_m=2450');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ last_frost: '05-20', first_frost: '09-25', elevation_m: 2450 });
    expect(asked).toContain('elevation=2450');
    const plain = await t.http().get('/api/climate/estimate?latitude=34.15&longitude=-107.85');
    expect(asked).not.toContain('elevation=');
    expect(plain.body.elevation_m).toBe(2450);
    expect((await t.http().get('/api/climate/estimate?latitude=34.15&longitude=-107.85&elevation_m=99999')).status).toBe(400);
  });

  it('a southern latitude gives the southern hemisphere', async () => {
    t = makeTestContext({ fetch: async () => json({ daily: daily(iso => md(iso) >= '05-05' && md(iso) <= '09-15') }) });
    const res = await t.http().get('/api/climate/estimate?latitude=-33.9&longitude=18.4');
    expect(res.body).toMatchObject({ hemisphere: 'south', last_frost: '09-15', first_frost: '05-05' });
  });

  it('estimate when the service fails', async () => {
    t = makeTestContext({ fetch: async () => { throw new TypeError('fetch failed'); } });
    const res = await t.http().get('/api/climate/estimate?latitude=39.92&longitude=-83.81');
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: 'lookup_failed', error: SERVICE_DOWN });
  });

  it('estimate when the service answers with an error', async () => {
    t = makeTestContext({ fetch: async () => new Response('busy', { status: 503 }) });
    const res = await t.http().get('/api/climate/estimate?latitude=39.92&longitude=-83.81');
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('lookup_failed');
  });

  it('estimate times out', async () => {
    t = makeTestContext({
      lookupTimeoutMs: 50,
      fetch: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    });
    const res = await t.http().get('/api/climate/estimate?latitude=39.92&longitude=-83.81');
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('lookup_failed');
  });

  it('search fails the same way', async () => {
    t = makeTestContext({ fetch: async () => { throw new TypeError('fetch failed'); } });
    const res = await t.http().get('/api/climate/search?q=Springfield');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe(SERVICE_DOWN);
  });

  it('bad latitude is refused', async () => {
    t = makeTestContext({ fetch: async () => json({}) });
    expect((await t.http().get('/api/climate/estimate?latitude=95&longitude=0')).status).toBe(400);
    expect((await t.http().get('/api/climate/estimate?latitude=abc&longitude=0')).status).toBe(400);
  });

  it('nothing is written to the database by a lookup', async () => {
    t = makeTestContext({ fetch: async () => json({ daily: daily(() => false) }) });
    await t.http().get('/api/climate/estimate?latitude=19.43&longitude=-99.13');
    expect(t.ctx.db.prepare('SELECT count(*) n FROM places').get().n).toBe(0);
  });
});
