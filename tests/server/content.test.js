import { describe, it, expect } from 'vitest';
import { BASE_CONTENT } from './helpers.js';
import { CONTENT_DIR, readFolder } from '../../server/services/starter.js';
import { PLANT_KINDS, SAFETY } from '../../server/services/plants.js';
import { STAGES } from '../../server/services/guides.js';

const RANGES = ['start_indoors', 'transplant', 'sow', 'fall_sow', 'days', 'years', 'zones'];
const KEY = /^[a-z0-9]+(?:[.-][a-z0-9_]+)*$/;

// Every problem in one content folder, as readable lines (empty means all good).
function problems(dir) {
  const out = [];
  const plants = readFolder(dir, 'plants');
  const guides = readFolder(dir, 'guides');
  const keys = new Set();
  for (const e of [...plants, ...guides]) {
    if (!KEY.test(e.starter_key ?? '')) out.push(`bad key ${e.starter_key}`);
    if (keys.has(e.starter_key)) out.push(`duplicate key ${e.starter_key}`);
    keys.add(e.starter_key);
    if (!Number.isInteger(e.content_version ?? 1) || (e.content_version ?? 1) < 1) out.push(`${e.starter_key}: bad content_version`);
  }
  const plantKeys = new Set(plants.map(p => p.starter_key));
  const basicsKeys = new Set(guides.filter(g => !g.plant).map(g => g.starter_key));
  for (const p of plants) {
    const k = p.starter_key;
    if (!k.startsWith('plant.')) out.push(`${k}: plant keys start with plant.`);
    if (!p.name || !PLANT_KINDS.includes(p.kind)) out.push(`${k}: needs a name and a known kind`);
    for (const f of RANGES) {
      const v = p[f];
      if (v === undefined) continue;
      if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isInteger) || v[0] > v[1]) out.push(`${k}: ${f} must be [min, max]`);
    }
    for (const m of p.frost_free_months ?? []) if (!Number.isInteger(m) || m < 1 || m > 12) out.push(`${k}: bad month ${m}`);
    for (const list of ['companions', 'avoid']) {
      for (const c of p[list] ?? []) if (c.startsWith('plant.') && !plantKeys.has(c)) out.push(`${k}: ${list} names missing ${c}`);
    }
    for (const s of ['safety_goats', 'safety_chickens']) if (p[s] != null && !SAFETY.includes(p[s])) out.push(`${k}: bad ${s}`);
    if (p.kind !== 'microgreen' && (p.soak_hours != null || p.safety_goats != null)) out.push(`${k}: microgreen fields on a ${p.kind}`);
    for (const pr of p.preserves ?? []) if (!pr.form || !pr.unit || !(pr.raw_kg > 0)) out.push(`${k}: bad preserve`);
    if (!guides.some(g => g.plant === k)) out.push(`${k}: has no guide`);
  }
  for (const g of guides) {
    const k = g.starter_key;
    if (!k.startsWith('guide.')) out.push(`${k}: guide keys start with guide.`);
    if (!g.title || !STAGES.includes(g.stage)) out.push(`${k}: needs a title and a known stage`);
    if (!Array.isArray(g.steps) || !g.steps.length || g.steps.length > 40 || !g.steps.every(s => typeof s === 'string' && s.trim())) out.push(`${k}: needs 1 to 40 steps`);
    for (const s of g.supplies ?? []) if (!s.name) out.push(`${k}: a supply needs a name`);
    if (g.plant && !plantKeys.has(g.plant)) out.push(`${k}: plant ${g.plant} is missing`);
    if (g.basics && !basicsKeys.has(g.basics)) out.push(`${k}: basics ${g.basics} is missing`);
    if (!g.plant && g.basics) out.push(`${k}: a basics guide can't link to another`);
  }
  return out;
}

// Low-acid crops with canned preserving amounts: their guides must say pressure canner.
const LOW_ACID = ['plant.potato', 'plant.sweet-potato', 'plant.carrot', 'plant.sweet-corn', 'plant.winter-squash', 'plant.pumpkin', 'plant.green-bean'];

describe('starter content files', () => {
  it('low-acid crops that list canned amounts tell you to use a pressure canner', () => {
    const plants = readFolder(CONTENT_DIR, 'plants');
    const guides = readFolder(CONTENT_DIR, 'guides');
    const missing = LOW_ACID.filter(k => plants.some(p => p.starter_key === k && (p.preserves ?? []).some(x => /canned/i.test(x.form))))
      .filter(k => !guides.some(g => g.plant === k && g.steps.some(s => /pressure canner/i.test(s))));
    expect(missing).toEqual([]);
  });
  it('garlic goes in around the first fall frost, and the potato guide warns about green potatoes', () => {
    const garlic = readFolder(CONTENT_DIR, 'plants').find(p => p.starter_key === 'plant.garlic');
    expect(garlic.fall_sow).toEqual([-2, 2]);
    const potato = readFolder(CONTENT_DIR, 'guides').find(g => g.starter_key === 'guide.potato.harvest');
    expect(potato.steps.some(s => /green/i.test(s) && /don.t eat|do not eat/i.test(s))).toBe(true);
  });
  it('the garlic guide agrees with its timing, and the raised bed soil amount adds up', () => {
    const guides = readFolder(CONTENT_DIR, 'guides');
    expect(guides.find(g => g.starter_key === 'guide.garlic.sow_outdoors').summary).toMatch(/around your first fall frost/i);
    const bed = guides.find(g => g.starter_key === 'guide.basics.raised-beds').supplies.find(x => /topsoil/i.test(x.name));
    expect(bed.amount).toMatch(/0\.9 m³/);
  });
  it('the test fixtures are well formed', () => expect(problems(BASE_CONTENT)).toEqual([]));
  it('the real starter content is well formed', () => expect(problems(CONTENT_DIR)).toEqual([]));
});
