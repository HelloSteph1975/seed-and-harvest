import { toDisplay, unitLabel } from './units.js';

export const SPACE_KINDS = ['bed', 'greenhouse', 'container', 'food_forest', 'microgreen_rack', 'seed_starting'];
export const SUN = ['full', 'part', 'shade'];

// The fields each kind keeps. The server clears the others, and the form only shows these.
const SIZED = ['length_m', 'width_m'];
export const KIND_FIELDS = {
  bed: SIZED,
  greenhouse: [...SIZED, 'heated', 'notes_spring', 'notes_summer', 'notes_fall', 'notes_winter'],
  food_forest: SIZED,
  seed_starting: SIZED,
  container: ['pot_liters'],
  microgreen_rack: ['tray_count'],
};

// "10 × 4 ft", "5 gal" or "8 trays" for a space, in the chosen units; '' when there's nothing to show.
export function sizeText(s, units, t) {
  const fields = KIND_FIELDS[s.kind] ?? [];
  if (fields.includes('length_m') && (s.length_m != null || s.width_m != null)) {
    const l = toDisplay('length', s.length_m, units) || '?';
    const w = toDisplay('length', s.width_m, units) || '?';
    return `${l} × ${w} ${unitLabel('length', units)}`;
  }
  if (fields.includes('pot_liters') && s.pot_liters != null) return `${toDisplay('volume', s.pot_liters, units)} ${unitLabel('volume', units)}`;
  if (fields.includes('tray_count') && s.tray_count != null) return t('spaces.trays', { n: s.tray_count });
  return '';
}
