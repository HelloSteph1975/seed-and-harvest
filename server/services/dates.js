// Plain calendar dates (YYYY-MM-DD), worked out in UTC so no time zone or daylight saving shifts them.
const DAY = 86400000;
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}
