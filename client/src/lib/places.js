// Current place first, then places to come, then past ones; each group in the owner's order.
const RANK = { current: 0, future: 1, past: 2 };
export const byStatus = list => [...list].sort((a, b) => RANK[a.status] - RANK[b.status] || a.sort_order - b.sort_order || a.id - b.id);

// "March 18" from "03-18", in the screen language.
export function frostDay(md, language) {
  if (!md) return '';
  const [m, d] = md.split('-').map(Number);
  return new Date(Date.UTC(2001, m - 1, d)).toLocaleDateString(language, { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export const monthName = (n, language, style = 'long') => new Date(Date.UTC(2001, n - 1, 1)).toLocaleDateString(language, { month: style, timeZone: 'UTC' });

// A place still needs its frost dates when it isn't frost-free and is missing either one.
export const needsFrostDates = p => !p.frost_free && (!p.last_frost || !p.first_frost);
