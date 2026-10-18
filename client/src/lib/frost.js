// "YYYY-MM-DD" today in a time zone (UTC if the zone is unknown).
export function todayIn(timeZone, now = new Date()) {
  let zone = timeZone || 'UTC';
  try { new Intl.DateTimeFormat('en-CA', { timeZone: zone }); } catch { zone = 'UTC'; }
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dayNumber = iso => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;

// The date "MM-DD" falls on in a year (Feb 29 becomes Feb 28 in other years).
const inYear = (md, year) => `${year}-${md === '02-29' && !isLeap(year) ? '02-28' : md}`;

// The next of the place's two frost dates, counting today as 0 days. Null for a frost-free place
// or one with no frost dates. Works the same in both hemispheres: it is just the next date.
export function nextFrostEvent(place, todayISO) {
  if (!place || place.frost_free) return null;
  const year = Number(todayISO.slice(0, 4));
  const options = [['last', place.last_frost], ['first', place.first_frost]]
    .filter(([, md]) => md)
    .map(([kind, md]) => {
      let date = inYear(md, year);
      if (date < todayISO) date = inYear(md, year + 1);
      return { kind, date, days: dayNumber(date) - dayNumber(todayISO) };
    })
    .sort((a, b) => a.days - b.days);
  return options[0] ?? null;
}
