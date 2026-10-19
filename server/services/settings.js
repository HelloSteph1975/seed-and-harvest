import { HttpError } from '../http.js';
import { transaction } from '../db/connection.js';

const machineZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function machineRegion() {
  try { return new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale).maximize().region ?? ''; } catch { return ''; }
}

// The few countries that measure in feet and gallons get US units; everyone else starts metric.
const US_UNITS = new Set(['US', 'LR', 'MM']);

export function defaultSettings({ region = machineRegion() } = {}) {
  return { language: 'en', time_zone: machineZone(), units: US_UNITS.has(region) ? 'us' : 'metric', larder_link: false, larder_url: DEFAULT_LARDER_URL };
}

export const DEFAULT_LARDER_URL = 'http://127.0.0.1:4193';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

// The Hearth & Larder address: plain http on this computer, with no path. Returns it tidied, or null.
export function localUrl(v) {
  let u;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'http:' || !LOCAL_HOSTS.has(u.hostname) || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return null;
  return u.origin;
}

// Any zone the runtime understands, aliases like Asia/Calcutta included.
export function validZone(v) {
  if (typeof v !== 'string' || !v) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return true; } catch { return false; }
}
// Each rule returns the value to store, or undefined when it is not valid.
const RULES = {
  language: (v, { languages }) => (languages.includes(v) ? v : undefined),
  time_zone: v => (validZone(v) ? v : undefined),
  units: v => (['us', 'metric'].includes(v) ? v : undefined),
  larder_link: v => (typeof v === 'boolean' ? (v ? '1' : '0') : undefined),
  larder_url: v => localUrl(v) ?? undefined,
};
const CODES = { larder_url: 'not_local' };
const READ = { larder_link: v => v === '1' };

export function getSettings(db) {
  const defaults = defaultSettings();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const saved = Object.fromEntries(rows.filter(r => Object.hasOwn(defaults, r.key)).map(r => [r.key, r.value]));
  for (const k of Object.keys(saved)) if (READ[k]) saved[k] = READ[k](saved[k]);
  return { ...defaults, ...saved };
}

// Settings are whole values saved together; the last save wins.
export function saveSettings(db, input, { languages = ['en'] } = {}) {
  const errors = Object.create(null);
  const codes = Object.create(null);
  const clean = Object.create(null);
  for (const [k, v] of Object.entries(input ?? {})) {
    if (!Object.hasOwn(RULES, k)) { errors[k] = 'Unknown setting'; continue; }
    const out = RULES[k](typeof v === 'string' ? v.trim() : typeof v === 'boolean' ? v : '', { languages });
    if (out === undefined) {
      errors[k] = CODES[k] === 'not_local' ? 'Must be an address on this computer' : 'Not a valid value';
      if (CODES[k]) codes[k] = { code: CODES[k] };
    } else clean[k] = out;
  }
  if (Object.keys(errors).length) {
    throw new HttpError(400, 'Please fix the highlighted fields.', { ...errors }, Object.keys(codes).length ? { code: 'invalid', detailCodes: { ...codes } } : undefined);
  }
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  transaction(db, () => { for (const [k, v] of Object.entries(clean)) up.run(k, v); });
  return getSettings(db);
}
