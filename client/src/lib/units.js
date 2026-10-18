// Everything is stored metric (meters, liters, °C). In US units the screen shows feet, US gallons
// and °F, and converts back only what the person actually typed.

const FT_PER_M = 3.280839895;
const L_PER_GAL = 3.785411784;

const TO_DISPLAY = {
  length: { us: m => m * FT_PER_M, metric: m => m },
  volume: { us: l => l / L_PER_GAL, metric: l => l },
  temp: { us: c => c * 9 / 5 + 32, metric: c => c },
};
const TO_METRIC = {
  length: { us: ft => ft / FT_PER_M, metric: m => m },
  volume: { us: gal => gal * L_PER_GAL, metric: l => l },
  temp: { us: f => (f - 32) * 5 / 9, metric: c => c },
};
const LABELS = { length: { us: 'ft', metric: 'm' }, volume: { us: 'gal', metric: 'L' }, temp: { us: '°F', metric: '°C' } };

export class UnitError extends Error {}

const sys = units => (units === 'metric' ? 'metric' : 'us');

// One decimal, without a trailing ".0".
export function toDisplay(kind, metric, units) {
  if (metric === null || metric === undefined || Number.isNaN(metric)) return '';
  const v = Math.round(TO_DISPLAY[kind][sys(units)](metric) * 10) / 10;
  return String(Object.is(v, -0) ? 0 : v);
}

// Blank means no value. A comma works as a decimal point. Sizes can't be negative (temperatures can).
export function toMetric(kind, text, units) {
  const s = String(text ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || (kind !== 'temp' && n < 0)) throw new UnitError('Not a number');
  return TO_METRIC[kind][sys(units)](n);
}

export const unitLabel = (kind, units) => LABELS[kind][sys(units)];

// An untouched field sends back exactly what was stored, so opening and saving never drifts.
export function keepOrConvert(kind, text, initialText, initialMetric, units) {
  return text === initialText ? initialMetric : toMetric(kind, text, units);
}
