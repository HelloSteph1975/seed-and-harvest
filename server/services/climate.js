import { HttpError } from '../http.js';

// Climate estimates for a new place, from Open-Meteo's free geocoding and historical-weather APIs
// (no key needed; data CC BY 4.0). This is the app's only network call, made only when the user
// presses Look up. The math is kept apart from the fetching so it can be tested on its own.

const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const FROM = '1995-01-01';
const TO = '2024-12-31';
const DEFAULT_TIMEOUT_MS = 20000;
export const LOOKUP_FAILED = "Couldn't reach the weather service. You can type the zone and frost dates yourself.";

const failed = () => new HttpError(502, LOOKUP_FAILED, undefined, { code: 'lookup_failed' });

// Hardiness zones in 10 °F bands from -60 °F (zone 1) up, each split into a lower "a" and upper "b" half.
export function zoneFromF(coldestF) {
  if (coldestF < -60) return '1a';
  if (coldestF >= 70) return '13b';
  const above = coldestF + 60;
  const n = Math.floor(above / 10) + 1;
  return `${n}${above - 10 * (n - 1) < 5 ? 'a' : 'b'}`;
}

// Day of a non-leap year (0-364) for "MM-DD", and back. Feb 29 counts as Feb 28.
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const START = DAYS.reduce((acc, d, i) => [...acc, acc[i] + d], [0]);
function dayOf(md) {
  const [m, d] = md.split('-').map(Number);
  return START[m - 1] + Math.min(d, DAYS[m - 1]) - 1;
}
function mdOf(day) {
  let m = 0;
  while (day >= START[m + 1]) m++;
  return `${String(m + 1).padStart(2, '0')}-${String(day - START[m] + 1).padStart(2, '0')}`;
}
const average = list => list.reduce((a, b) => a + b, 0) / list.length;
const averageDate = days => (days.length ? mdOf(Math.round(average(days))) : null);

// A frost day has a daily low at or below 0 °C. Per year, the last spring frost is the latest
// frost day in the spring half (north: Jan-Jul; south: Jul-Dec) and the first fall frost is the
// earliest in the fall half (north: Aug-Dec; south: Jan-Jun). A place is frost-free when fewer
// than half of the full years have any frost day.
export function estimateFromDaily({ time = [], temperature_2m_min: lows = [] }, hemisphere) {
  const south = hemisphere === 'south';
  const perYear = new Map();
  const coldest = new Map();
  time.forEach((iso, i) => {
    const c = lows[i];
    if (typeof c !== 'number') return;
    const year = Number(iso.slice(0, 4));
    const month = Number(iso.slice(5, 7));
    const md = iso.slice(5);
    const y = perYear.get(year) ?? { days: 0, frost: false, last: null, first: null };
    y.days++;
    if (c <= 0) {
      y.frost = true;
      const springHalf = south ? md >= '07-01' : md <= '07-31';
      if (springHalf) y.last = md;
      else if (y.first === null) y.first = md;
    }
    perYear.set(year, y);
    // Winters span the new year in the north, so they run July to June.
    const season = south ? year : (month >= 7 ? year : year - 1);
    const s = coldest.get(season) ?? { days: 0, min: Infinity };
    s.days++;
    s.min = Math.min(s.min, c);
    coldest.set(season, s);
  });
  const full = [...perYear.values()].filter(y => y.days >= 360);
  const frostYears = full.filter(y => y.frost).length;
  const frostFree = full.length > 0 && frostYears < full.length / 2;
  const winters = [...coldest.values()].filter(s => s.days >= 300).map(s => s.min);
  const coldestC = winters.length ? average(winters) : null;
  const coldestF = coldestC === null ? null : Math.round((coldestC * 9 / 5 + 32) * 10) / 10;
  return {
    last_frost: frostFree ? null : averageDate(full.filter(y => y.last).map(y => dayOf(y.last))),
    first_frost: frostFree ? null : averageDate(full.filter(y => y.first).map(y => dayOf(y.first))),
    frost_free: frostFree,
    coldest_f: coldestF,
    zone: coldestF === null ? null : zoneFromF(coldestF),
    years: full.length,
  };
}

async function getJson(ctx, url) {
  const fetchFn = ctx.fetch ?? globalThis.fetch;
  let res;
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(ctx.config.lookupTimeoutMs ?? DEFAULT_TIMEOUT_MS) });
  } catch {
    throw failed();
  }
  if (!res.ok) throw failed();
  try { return await res.json(); } catch { throw failed(); }
}

export async function searchPlaces(ctx, q) {
  const params = new URLSearchParams({ name: q, count: '8', language: 'en', format: 'json' });
  const body = await getJson(ctx, `${GEOCODE}?${params}`);
  return (Array.isArray(body?.results) ? body.results : []).map(r => ({
    label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    latitude: r.latitude,
    longitude: r.longitude,
    time_zone: r.timezone ?? null,
    country_code: r.country_code ?? null,
    elevation_m: typeof r.elevation === 'number' ? r.elevation : null,
  }));
}

// The weather service corrects its lows for elevation. Without `elevation_m` it uses the ground at the
// point (a town's center); land up a mountain from that town can be much colder, so the owner can give
// their land's own elevation. The reply says which elevation was used.
export async function estimateClimate(ctx, { latitude, longitude, elevation_m }) {
  const params = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), start_date: FROM, end_date: TO,
    daily: 'temperature_2m_min', timezone: 'auto',
  });
  if (typeof elevation_m === 'number') params.set('elevation', String(elevation_m));
  const body = await getJson(ctx, `${ARCHIVE}?${params}`);
  if (!Array.isArray(body?.daily?.time)) throw failed();
  const hemisphere = latitude < 0 ? 'south' : 'north';
  const used = typeof body.elevation === 'number' ? body.elevation : elevation_m ?? null;
  return { hemisphere, ...estimateFromDaily(body.daily, hemisphere), elevation_m: used, source: 'Open-Meteo' };
}
