// How much to plant for a pantry goal. Pure: the caller passes the goal, the plant (with its yield and
// preserving forms) and last year's yield for this plant, if any. Every number is a rough guide.
//
// `history` is last year's real yield in the goal's own unit: { per: 'plant' | 'meter', amount } (kg, or a
// count for count goals), or null. It wins over the library's yield when both exist.
export function suggestFor(goal, plant, history) {
  let need;
  if (goal.goal_kind === 'preserve') {
    const form = plant.preserves?.[goal.preserve_position - 1];
    if (!form) return { needs: 'preserve' };
    need = { kg: goal.amount * form.raw_kg };
  } else {
    need = goal.unit === 'count' ? { count: goal.amount } : { kg: goal.amount };
  }
  // Library yields are weights, so they only help weight goals.
  const library = need.kg != null && plant.yield_kg > 0 && plant.yield_per ? { per: plant.yield_per, amount: plant.yield_kg } : null;
  const lastYear = history?.amount > 0 ? history : null;
  const use = lastYear ?? library;
  if (!use) return { needs: 'yield' };
  const raw = (need.kg ?? need.count) / use.amount;
  const amount = use.per === 'meter' ? Math.ceil(raw * 2 - 1e-9) / 2 : Math.ceil(raw - 1e-9);
  return {
    per: use.per,
    amount,
    source: lastYear ? 'last_year' : 'library',
    need: { kg: need.kg == null ? undefined : Math.round(need.kg * 1000) / 1000, count: need.count },
    yields: { library, last_year: lastYear },
  };
}
