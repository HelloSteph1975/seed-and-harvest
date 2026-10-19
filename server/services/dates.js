// Plain calendar dates (YYYY-MM-DD), worked out in UTC so no time zone or daylight saving shifts them.
const DAY = 86400000;
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}

// Today's date in a time zone (the computer's own when the zone is missing or unknown).
export function todayIn(timeZone, now = new Date()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }
}
