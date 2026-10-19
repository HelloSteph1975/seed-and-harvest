import { addDays } from './dates.js';
import { suppliesFor } from './guides.js';

// Which guide stage each kind of task links to.
export const TASK_STAGE = {
  start_seeds: 'start_indoors', pot_up: 'start_indoors', harden_off: 'transplant', transplant: 'transplant', plant: 'transplant',
  sow: 'sow_outdoors', thin: 'sow_outdoors', feed: 'care', pests: 'care', harvest: 'harvest', other: null,
  prune: 'care', mulch: 'care', protect: 'container', check_pot: 'container',
};

// Planted as cloves, tubers, slips or sets at their final spacing, so never thinned; cloves and
// seed potatoes go straight in the ground, so they skip hardening off too.
const NO_THIN = new Set(['plant.garlic', 'plant.potato', 'plant.sweet-potato', 'plant.onion', 'plant.leek']);
const NO_HARDEN = new Set(['plant.garlic', 'plant.potato']);

const mid = (p, f) => (p[`${f}_min`] != null && p[`${f}_max`] != null ? (p[`${f}_min`] + p[`${f}_max`]) / 2 : null);
const task = (kind, due_on, end_on = null) => ({ kind, due_on, end_on, stage: TASK_STAGE[kind] });

// The tasks a planting needs, worked out from the plant's timing and the first action's date.
// Ranges count at their middle, rounded to whole days. Pure: no database.
export function planTasks(plant, howStarted, startOn) {
  const out = [];
  let inGround = null;
  if (plant.kind === 'microgreen') {
    out.push(task('sow', startOn));
    inGround = startOn;
  } else if (howStarted === 'mature') {
    return [task('plant', startOn)];
  } else if (howStarted === 'seed_indoors') {
    const lead = mid(plant, 'start_indoors') ?? 0;
    const after = mid(plant, 'transplant') ?? 0;
    out.push(task('start_seeds', startOn));
    if (lead >= 6) out.push(task('pot_up', addDays(startOn, 21)));
    inGround = addDays(startOn, Math.round((lead + after) * 7));
    out.push(task('harden_off', addDays(inGround, -7)), task('transplant', inGround));
  } else if (howStarted === 'seed_outdoors') {
    out.push(task('sow', startOn));
    if ((plant.spacing_cm ?? 0) >= 5 && !NO_THIN.has(plant.starter_key)) out.push(task('thin', addDays(startOn, 14)));
    inGround = startOn;
  } else {
    inGround = startOn;
    if (!NO_HARDEN.has(plant.starter_key)) out.push(task('harden_off', addDays(startOn, -7)));
    out.push(task('transplant', startOn));
  }
  if (plant.kind !== 'microgreen' && !plant.perennial) out.push(task('pests', addDays(inGround, 21)), task('feed', addDays(inGround, 28)));
  if (!plant.perennial && plant.days_min != null && plant.days_max != null) out.push(task('harvest', addDays(inGround, plant.days_min), addDays(inGround, plant.days_max)));
  return out.sort((a, b) => a.due_on.localeCompare(b.due_on));
}

// The guide each task opens: the plant's own guide for that stage, else a basics guide for it.
// Hardening off has its own basics guide. A mature plant also takes its pot guide.
export function guideFor(db, plant, kind) {
  const plantId = plant.id;
  const stage = TASK_STAGE[kind];
  if (!stage) return null;
  if (plant.kind === 'microgreen' && (kind === 'sow' || kind === 'harvest')) {
    const own = db.prepare("SELECT id FROM guides WHERE plant_id = ? AND stage = 'microgreens' AND deleted_at IS NULL ORDER BY sort_order, id LIMIT 1").get(plantId);
    const basics = own ?? db.prepare("SELECT id FROM guides WHERE plant_id IS NULL AND stage = 'microgreens' AND deleted_at IS NULL ORDER BY id LIMIT 1").get();
    if (basics) return basics.id;
  }
  if (kind === 'harden_off') {
    return db.prepare("SELECT id FROM guides WHERE starter_key = 'guide.basics.harden-off' AND deleted_at IS NULL").get()?.id ?? null;
  }
  const stages = kind === 'plant' ? ['transplant', 'container'] : [stage];
  for (const s of stages) {
    const own = db.prepare('SELECT id FROM guides WHERE plant_id = ? AND stage = ? AND deleted_at IS NULL ORDER BY sort_order, id LIMIT 1').get(plantId, s);
    if (own) return own.id;
  }
  for (const s of stages) {
    const basics = db.prepare('SELECT id FROM guides WHERE plant_id IS NULL AND stage = ? AND deleted_at IS NULL ORDER BY id LIMIT 1').get(s);
    if (basics) return basics.id;
  }
  return null;
}

export function linkGuides(db, plant, tasks) {
  return tasks.map(t => ({ ...t, guide_id: guideFor(db, plant, t.kind) }));
}

// The tasks as the form previews them: with each guide's title and supplies.
export function describeTasks(db, tasks) {
  return tasks.map(t => {
    const g = t.guide_id ? db.prepare('SELECT id, title, starter_key, is_starter FROM guides WHERE id = ?').get(t.guide_id) : null;
    return { kind: t.kind, due_on: t.due_on, end_on: t.end_on, guide: g, supplies: g ? suppliesFor(db, g.id) : [] };
  });
}
