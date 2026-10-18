import { addDays } from './dates.js';

// Care for perennials through the year, as common rules of thumb. Places with frost time it from
// their frost dates; frost-free places from their coolest month and rainy season. Pure: no database.

const FRUIT = new Set(['fruit_tree', 'shrub', 'vine']);
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const pad = n => String(n).padStart(2, '0');
// A frost date ("MM-DD") in a year; February 29 becomes the 28th in other years.
const dayIn = (md, y) => (md === '02-29' && !isLeap(y) ? `${y}-02-28` : `${y}-${md}`);
const zoneNumber = zone => (zone ? Number.parseInt(zone, 10) : null);

// Whether the plant needs winter shelter here: a pot whose plant isn't comfortably hardy (or has no
// zones to tell), or a plant in the ground that is less hardy than the place.
function needsShelter(plant, place, inContainer) {
  const z = zoneNumber(place.zone);
  if (inContainer) return plant.zone_min == null || z == null || plant.zone_min > z - 1;
  return z != null && plant.zone_min != null && z < plant.zone_min;
}

function frostYear(plant, place, inContainer, y) {
  const out = [];
  if (place.last_frost) {
    const L = dayIn(place.last_frost, y);
    if (inContainer) out.push({ kind: 'check_pot', due_on: addDays(L, -42), season_key: `check_pot:${y}` });
    if (FRUIT.has(plant.kind)) out.push({ kind: 'prune', due_on: addDays(L, -28), season_key: `prune:${y}` });
    out.push({ kind: 'feed', due_on: addDays(L, 14), season_key: `feed:${y}:1` });
    if (inContainer) out.push({ kind: 'feed', due_on: addDays(L, 70), season_key: `feed:${y}:2` });
    else out.push({ kind: 'mulch', due_on: addDays(L, 28), season_key: `mulch:${y}` });
  }
  if (place.first_frost && needsShelter(plant, place, inContainer)) {
    out.push({ kind: 'protect', due_on: addDays(dayIn(place.first_frost, y), -7), season_key: `protect:${y}` });
  }
  return out;
}

// The first month of the rainy season and the month after it ends, following it across December.
function rainySeason(months) {
  const set = new Set(months ?? []);
  if (!set.size || set.size === 12) return null;
  const start = [...set].find(m => !set.has(m === 1 ? 12 : m - 1));
  let end = start;
  while (set.has(end === 12 ? 1 : end + 1)) end = end === 12 ? 1 : end + 1;
  return { start, after: end === 12 ? 1 : end + 1 };
}

function frostFreeYear(plant, place, inContainer, y) {
  const south = place.hemisphere === 'south';
  const coolest = south ? 7 : 1;
  const rain = rainySeason(place.wet_months);
  const feedOn = `${y}-${pad(rain ? rain.start : (south ? 9 : 3))}-01`;
  const out = [];
  if (inContainer) out.push({ kind: 'check_pot', due_on: `${y}-${pad(coolest)}-01`, season_key: `check_pot:${y}` });
  if (FRUIT.has(plant.kind)) out.push({ kind: 'prune', due_on: `${y}-${pad(coolest)}-15`, season_key: `prune:${y}` });
  out.push({ kind: 'feed', due_on: feedOn, season_key: `feed:${y}:1` });
  out.push({ kind: 'mulch', due_on: rain ? `${y}-${pad(rain.after)}-01` : addDays(feedOn, 28), season_key: `mulch:${y}` });
  return out;
}

export function careEvents(plant, place, inContainer, fromISO, toISO) {
  if (!plant?.perennial || !place) return [];
  const out = [];
  for (let y = Number(fromISO.slice(0, 4)) - 1; y <= Number(toISO.slice(0, 4)) + 1; y++) {
    out.push(...(place.frost_free ? frostFreeYear(plant, place, inContainer, y) : frostYear(plant, place, inContainer, y)));
  }
  return out.filter(e => e.due_on >= fromISO && e.due_on <= toISO).sort((a, b) => a.due_on.localeCompare(b.due_on) || a.kind.localeCompare(b.kind));
}
