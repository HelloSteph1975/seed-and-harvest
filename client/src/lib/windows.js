// When to plant at a place, worked out from the plant's timing (weeks around the frost dates, or
// planting months for frost-free places). Every window is the next one that hasn't ended yet.

const DAY = 86400000;
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const iso = ms => new Date(ms).toISOString().slice(0, 10);
// "MM-DD" in a year as a UTC time (Feb 29 becomes Feb 28 in other years).
function dateIn(md, year) {
  const [m, d] = md.split('-').map(Number);
  return Date.UTC(year, m - 1, Math.min(d, daysIn(year, m)));
}

const has = (p, f) => p[`${f}_min`] != null && p[`${f}_max`] != null;

// A window around a frost date: `from`/`to` are weeks after it (negative = before).
function aroundFrost(kind, md, fromWeeks, toWeeks, todayISO) {
  const year = Number(todayISO.slice(0, 4));
  for (const y of [year - 1, year, year + 1]) {
    const base = dateIn(md, y);
    const w = { kind, from: iso(base + fromWeeks * 7 * DAY), to: iso(base + toWeeks * 7 * DAY) };
    if (w.to >= todayISO) return w;
  }
  return null;
}

// Runs of consecutive months; a run that reaches December joins one that starts in January.
function monthRuns(months) {
  const set = [...new Set(months)].sort((a, b) => a - b);
  const runs = [];
  for (const m of set) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === m - 1) last.push(m);
    else runs.push([m]);
  }
  if (runs.length > 1 && runs[0][0] === 1 && runs[runs.length - 1].at(-1) === 12) {
    const first = runs.shift();
    runs[runs.length - 1].push(...first);
  }
  return runs;
}

function monthWindow(run, todayISO) {
  const year = Number(todayISO.slice(0, 4));
  const start = run[0];
  const end = run[run.length - 1];
  for (const y of [year - 1, year, year + 1]) {
    const endYear = end < start ? y + 1 : y;
    const w = { kind: 'frost_free', from: iso(Date.UTC(y, start - 1, 1)), to: iso(Date.UTC(endYear, end - 1, daysIn(endYear, end))) };
    if (w.to >= todayISO) return w;
  }
  return null;
}

export function plantingWindows(plant, place, todayISO) {
  if (!place) return { windows: [], needs: ['place'] };
  const windows = [];
  const needs = new Set();
  if (place.frost_free) {
    for (const run of monthRuns(plant.frost_free_months ?? [])) windows.push(monthWindow(run, todayISO));
  } else {
    const last = place.last_frost;
    const first = place.first_frost;
    if (has(plant, 'start_indoors')) {
      if (last) windows.push(aroundFrost('start_indoors', last, -plant.start_indoors_max, -plant.start_indoors_min, todayISO));
      else needs.add('last_frost');
    }
    for (const kind of ['transplant', 'sow']) {
      if (!has(plant, kind)) continue;
      if (last) windows.push(aroundFrost(kind, last, plant[`${kind}_min`], plant[`${kind}_max`], todayISO));
      else needs.add('last_frost');
    }
    if (has(plant, 'fall_sow')) {
      if (first) windows.push(aroundFrost('fall_sow', first, -plant.fall_sow_max, -plant.fall_sow_min, todayISO));
      else needs.add('first_frost');
    }
  }
  return { windows: windows.filter(Boolean).sort((a, b) => a.from.localeCompare(b.from)), needs: [...needs] };
}

const zoneNumber = zone => (zone ? Number.parseInt(zone, 10) : null);

// Whether a perennial survives the place's winters; annuals and missing zones are 'unknown'.
export function zoneFit(plant, place) {
  const z = zoneNumber(place?.zone);
  if (!plant?.perennial || plant.zone_min == null || plant.zone_max == null || !z) return 'unknown';
  if (z < plant.zone_min) return 'too_cold';
  if (z > plant.zone_max) return 'too_warm';
  return 'fits';
}
