// Everything is stored metric (meters, liters, °C). In US units the screen shows feet, US gallons
// and °F, and converts back only what the person actually typed.

// Exact definitions: 1 ft = 0.3048 m, 1 in = 2.54 cm, 1 US gal = 3.785411784 L, 1 lb = 0.45359237 kg, 1 oz = 28.349523125 g.
const M_PER_FT = 0.3048;
const CM_PER_IN = 2.54;
const L_PER_GAL = 3.785411784;
const KG_PER_LB = 0.45359237;
const G_PER_OZ = 28.349523125;

const TO_DISPLAY = {
  length: { us: m => m / M_PER_FT, metric: m => m },
  elevation: { us: m => m / M_PER_FT, metric: m => m },
  spacing: { us: cm => cm / CM_PER_IN, metric: cm => cm },
  weight: { us: kg => kg / KG_PER_LB, metric: kg => kg },
  seed: { us: g => g / G_PER_OZ, metric: g => g },
  volume: { us: l => l / L_PER_GAL, metric: l => l },
  temp: { us: c => c * 9 / 5 + 32, metric: c => c },
};
const TO_METRIC = {
  length: { us: ft => ft * M_PER_FT, metric: m => m },
  elevation: { us: ft => ft * M_PER_FT, metric: m => m },
  spacing: { us: inches => inches * CM_PER_IN, metric: cm => cm },
  weight: { us: lb => lb * KG_PER_LB, metric: kg => kg },
  seed: { us: oz => oz * G_PER_OZ, metric: g => g },
  volume: { us: gal => gal * L_PER_GAL, metric: l => l },
  temp: { us: f => (f - 32) * 5 / 9, metric: c => c },
};
const LABELS = { length: { us: 'ft', metric: 'm' }, elevation: { us: 'ft', metric: 'm' }, volume: { us: 'gal', metric: 'L' }, temp: { us: '°F', metric: '°C' },
  spacing: { us: 'in', metric: 'cm' }, weight: { us: 'lb', metric: 'kg' }, seed: { us: 'oz', metric: 'g' } };

export class UnitError extends Error {}

const sys = units => (units === 'metric' ? 'metric' : 'us');

// One decimal, without a trailing ".0". Spacing of 3 inches or more shows whole inches; a little
// seed or a light harvest never shows as 0.
export function toDisplay(kind, metric, units) {
  if (metric === null || metric === undefined || Number.isNaN(metric)) return '';
  const raw = TO_DISPLAY[kind][sys(units)](metric);
  let v = kind === 'spacing' && sys(units) === 'us' && raw >= 3 ? Math.round(raw) : Math.round(raw * 10) / 10;
  if ((kind === 'seed' || kind === 'weight') && metric > 0 && v === 0) v = 0.1;
  return String(Object.is(v, -0) ? 0 : v);
}

// Blank means no value. A comma works as a decimal point. Sizes can't be negative (temperatures and
// elevations below sea level can).
export function toMetric(kind, text, units) {
  const s = String(text ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || (kind !== 'temp' && kind !== 'elevation' && n < 0)) throw new UnitError('Not a number');
  return TO_METRIC[kind][sys(units)](n);
}

export const unitLabel = (kind, units) => LABELS[kind][sys(units)];

// An untouched field sends back exactly what was stored, so opening and saving never drifts.
export function keepOrConvert(kind, text, initialText, initialMetric, units) {
  return text === initialText ? initialMetric : toMetric(kind, text, units);
}
