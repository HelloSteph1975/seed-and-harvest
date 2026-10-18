import { transaction } from '../db/connection.js';
import { repos } from '../db/repos.js';
import { notFound, notInTrash } from '../http.js';
import { validate } from '../validate.js';
import { invalid } from './fields.js';

export const ANIMAL_KINDS = ['goat', 'chicken', 'other'];
export const ANIMAL_SCHEMA = {
  name: { type: 'string!', maxLength: 60 },
  kind: { type: ANIMAL_KINDS, required: true },
  notes: { type: 'string', maxLength: 2000 },
  sort_order: { type: 'int', min: 0, max: 10000 },
};

// How safe a crop is for an animal: goats and chickens use the plant's own ratings, any other animal
// the owner's rating for it. Null means nobody has rated it, which is never the same as safe.
export function safetyFor(db, plant, animal) {
  if (!plant || !animal) return null;
  if (animal.kind === 'goat') return plant.safety_goats ?? null;
  if (animal.kind === 'chicken') return plant.safety_chickens ?? null;
  return db.prepare('SELECT safety FROM plant_animal_safety WHERE plant_id = ? AND animal_id = ?').get(plant.id, animal.id)?.safety ?? null;
}

export const listAnimals = db => repos(db).animals.list();

export function createAnimal(db, body) {
  return transaction(db, () => {
    const r = validate(ANIMAL_SCHEMA, body ?? {});
    if (r.errors) throw invalid(r.errors, r.codes);
    return repos(db).animals.create(r.data);
  });
}

export function updateAnimal(db, id, body, version) {
  return transaction(db, () => {
    const r = validate(ANIMAL_SCHEMA, body ?? {}, { partial: true });
    if (r.errors) throw invalid(r.errors, r.codes);
    const row = repos(db).animals.update(id, r.data, version);
    if (!row) throw notFound();
    if (row.kind !== 'other') db.prepare('DELETE FROM plant_animal_safety WHERE animal_id = ?').run(id);
    return row;
  });
}

export function deleteAnimal(db, id) {
  transaction(db, () => { if (!repos(db).animals.remove(id)) throw notFound(); });
}

export function restoreAnimal(ctx, id) {
  return transaction(ctx.db, () => {
    const row = repos(ctx.db).animals.get(id, { includeDeleted: true });
    if (!row || !row.deleted_at) throw notInTrash();
    repos(ctx.db).animals.restore(id);
    return repos(ctx.db).animals.get(id);
  });
}

// Trays fed to this animal keep their dates and crop, without the link; its ratings go with it.
export function purgeAnimal(ctx, row) {
  ctx.db.prepare('UPDATE trays SET animal_id = NULL WHERE animal_id = ?').run(row.id);
  ctx.db.prepare('DELETE FROM plant_animal_safety WHERE animal_id = ?').run(row.id);
  repos(ctx.db).animals.purge(row.id);
}
