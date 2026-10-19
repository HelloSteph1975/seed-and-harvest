import { toDisplay, unitLabel } from './units.js';

export const HARVEST_UNITS = ['kg', 'count', 'bunch'];
export const PARTS = ['larder_qty', 'animals_qty', 'given_qty', 'sold_qty'];

// "5 lb", "12" or "3 bunches": weights in the chosen units, other amounts as they are.
export function qtyText(q, unit, units, t) {
  if (q == null) return '';
  if (unit === 'kg') return `${toDisplay('weight', q, units)} ${unitLabel('weight', units)}`;
  const n = Math.round(q * 100) / 100;
  return unit === 'bunch' ? t('harvests.bunches', { n }) : t('harvests.count', { n });
}

// "2 lb to the larder, 1 lb sold": the parts that went somewhere other than the kitchen.
export function splitText(h, units, t) {
  const bits = [];
  for (const k of PARTS) if (h[k] > 0) bits.push(t(`harvests.part.${k}`, { amount: qtyText(h[k], h.unit, units, t) }));
  return bits.join(', ');
}
