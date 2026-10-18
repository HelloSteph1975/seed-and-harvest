import { plantingWindows } from './windows.js';

export const HOW_STARTED = ['seed_indoors', 'seed_outdoors', 'start', 'mature'];
export const STATUSES = ['planned', 'started', 'growing', 'harvesting', 'done'];
export const LOG_KINDS = ['sowed', 'transplanted', 'planted', 'thinned', 'fed', 'pruned', 'watered', 'problem', 'harvested', 'mulched', 'protected', 'repotted', 'moved', 'note'];

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
    // Planting windows that haven't ended by today plus the lead time, moved back by it, are the
    // indoor starts that haven't ended by today.
    const back = Math.round(lead * 7);
    const later = plantingWindows(plant, place, addDays(todayISO, back)).windows.filter(w => w.kind === 'frost_free');
    if (later.length) {
      const first = later.reduce((a, b) => (b.from < a.from ? b : a));
      return { window: { kind: 'start_indoors', from: addDays(first.from, -back), to: addDays(first.to, -back) } };
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

// The same day some years later (February 29 becomes the 28th).
export function addYears(iso, n) {
  const y = Number(iso.slice(0, 4)) + n;
  const md = iso.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return `${y}-${md === '02-29' && !leap ? '02-28' : md}`;
}

// "Starts bearing in about 3 months" or "Bearing since Sep 1".
export function bearingText(bearsOn, todayISO, t, language) {
  if (!bearsOn) return null;
  if (bearsOn <= todayISO) return t('plantings.bearingSince', { day: dayText(bearsOn, language, todayISO) });
  const days = Math.round((Date.parse(`${bearsOn}T00:00:00Z`) - Date.parse(`${todayISO}T00:00:00Z`)) / 86400000);
  const months = Math.max(1, Math.round(days / 30));
  return months >= 24 ? t('plantings.bearsInYears', { n: Math.round(months / 12) }) : t('plantings.bearsIn', { n: months });
}

// "1 year", "2 years" or "1 to 3 years" to first fruit.
export function yearsText(t, from, to) {
  if (from == null) return '';
  const top = to ?? from;
  return top === from ? t('plants.years', { n: from }) : t('plants.yearsRange', { from, to: top });
}
