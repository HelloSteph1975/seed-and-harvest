import { plantingWindows } from './windows.js';

export const HOW_STARTED = ['seed_indoors', 'seed_outdoors', 'start', 'mature'];
export const STATUSES = ['planned', 'started', 'growing', 'harvesting', 'done'];
export const LOG_KINDS = ['sowed', 'transplanted', 'planted', 'thinned', 'fed', 'pruned', 'watered', 'problem', 'harvested', 'note'];

// The same rule as the server: a mature plant only for perennials, seed indoors only for plants
// with indoor timing (and microgreens).
export function allowedStarts(plant) {
  if (!plant) return ['seed_outdoors', 'start'];
  const out = [];
  if (plant.start_indoors_min != null || plant.kind === 'microgreen') out.push('seed_indoors');
  out.push('seed_outdoors', 'start');
  if (plant.perennial) out.push('mature');
  return out;
}

// Which planting windows fit each way of starting.
const WINDOW_KINDS = {
  seed_indoors: ['start_indoors'], seed_outdoors: ['sow', 'fall_sow', 'frost_free'], start: ['transplant', 'fall_sow', 'frost_free'], mature: ['transplant', 'frost_free'],
};
const mid = (p, f) => (p[`${f}_min`] != null && p[`${f}_max`] != null ? (p[`${f}_min`] + p[`${f}_max`]) / 2 : null);

// The window a start date can come from: `{ window }` when one fits, `{ needs }` naming the frost
// date to add, or `{ anyDay: true }` for microgreens, which grow inside whenever.
export function suggestStart(plant, place, howStarted, todayISO) {
  if (!plant || !place || !howStarted) return {};
  if (plant.kind === 'microgreen') return { anyDay: true };
  const { windows, needs } = plantingWindows(plant, place, todayISO);
  // Where there is no frost, seeds started indoors go in ahead of the planting months by the plant's lead time.
  const lead = mid(plant, 'start_indoors');
  if (place.frost_free && howStarted === 'seed_indoors' && lead != null) {
    const months = windows.find(w => w.kind === 'frost_free');
    if (months) {
      const back = Math.round(lead * 7);
      const shifted = { kind: 'start_indoors', from: addDays(months.from, -back), to: addDays(months.to, -back) };
      return { window: shifted.to >= todayISO ? shifted : { ...shifted, from: addDays(shifted.from, 365), to: addDays(shifted.to, 365) } };
    }
  }
  const window = windows.find(w => WINDOW_KINDS[howStarted].includes(w.kind));
  if (window) return { window };
  return { needs: needs.filter(n => n !== 'place') };
}

// The date "Use this date" fills in: the window's start, or today once the window has begun.
export const startFrom = (window, todayISO) => (window.from < todayISO ? todayISO : window.from);

export const taskTitle = (task, t) => task.title || t(`tasks.kind.${task.kind}`);

// "Feb 10", with the year when it isn't this year.
export function dayText(iso, language, todayISO) {
  if (!iso) return '';
  const sameYear = todayISO && iso.slice(0, 4) === todayISO.slice(0, 4);
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(language, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}
