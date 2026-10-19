import { listHarvests } from './harvests.js';

const UNITS = ['kg', 'count', 'bunch'];
const zero = () => ({ kg: 0, count: 0, bunch: 0 });
const round = n => Math.round(n * 1e6) / 1e6;
const PARTS = { larder: 'larder_qty', animals: 'animals_qty', given: 'given_qty', sold: 'sold_qty', kept: 'kept_qty' };

// A year's harvests added up per crop and per place: how much, where it went, and sales income.
// Amounts stay apart by unit (weights in kg, counts, bunches). Microgreen trays count under their crop,
// and a place is the one the planting or tray is at now.
export function yearSummary(db, { year, place_id }, placeNames) {
  const crops = new Map();
  const places = new Map();
  const totals = { ...zero(), income: 0 };
  for (const h of listHarvests(db, { year, place_id })) {
    const u = UNITS.includes(h.unit) ? h.unit : 'kg';
    let c = crops.get(h.crop.plant_id);
    if (!c) {
      c = { plant_id: h.crop.plant_id, name: h.crop.name, starter_key: h.crop.starter_key, is_starter: h.crop.is_starter, totals: zero(), income: 0,
        ...Object.fromEntries(Object.keys(PARTS).map(k => [k, zero()])) };
      crops.set(h.crop.plant_id, c);
    }
    c.totals[u] += h.quantity;
    for (const [k, field] of Object.entries(PARTS)) c[k][u] += h[field] ?? 0;
    c.income += h.sold_price ?? 0;
    let p = places.get(h.place_id);
    if (!p) { p = { place_id: h.place_id, name: placeNames.get(h.place_id) ?? '', ...zero(), income: 0 }; places.set(h.place_id, p); }
    p[u] += h.quantity;
    p.income += h.sold_price ?? 0;
    totals[u] += h.quantity;
    totals.income += h.sold_price ?? 0;
  }
  const tidy = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v && typeof v === 'object' ? tidy(v) : v]));
  const byWeight = (a, b) => b.totals.kg - a.totals.kg || b.totals.count - a.totals.count || a.name.localeCompare(b.name);
  return {
    year,
    by_crop: [...crops.values()].sort(byWeight).map(tidy),
    by_place: [...places.values()].sort((a, b) => b.kg - a.kg || a.name.localeCompare(b.name)).map(tidy),
    totals: tidy(totals),
  };
}
