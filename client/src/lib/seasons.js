export const SEASONS = ['spring', 'summer', 'fall', 'winter'];

// The season a month falls in: March to May is spring in the north and fall in the south.
export function seasonOf(month, hemisphere = 'north') {
  const north = month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'fall' : 'winter';
  if (hemisphere !== 'south') return north;
  return { spring: 'fall', summer: 'winter', fall: 'spring', winter: 'summer' }[north];
}
