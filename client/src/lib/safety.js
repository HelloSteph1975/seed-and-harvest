// What to tell the owner about feeding a crop to one of their animals. Safe needs no note; a crop
// nobody has rated is never treated as safe.
export function safetyNote(safety, animal, t) {
  if (!animal) return null;
  const name = animal.name;
  if (safety === 'safe') return null;
  if (safety === 'avoid') return { level: 'avoid', text: t('safety.avoid', { animal: name }) };
  if (safety === 'small') return { level: 'small', text: t('safety.small', { animal: name }) };
  return { level: 'unrated', text: t('safety.unrated', { animal: name }) };
}

// The same rating the server works out: goats and chickens from the plant, others from its list.
export function ratingFor(plant, animal) {
  if (!plant || !animal) return null;
  if (animal.kind === 'goat') return plant.safety_goats ?? null;
  if (animal.kind === 'chicken') return plant.safety_chickens ?? null;
  return plant.animal_safety?.find(x => x.animal_id === animal.id)?.safety ?? null;
}
