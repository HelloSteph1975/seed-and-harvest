import { useEffect, useState } from 'react';
import { todayIn } from './frost.js';

// Today's date in a time zone, kept current: checked every minute and whenever the window is
// shown again, so a page left open overnight moves on to the new day.
export function useToday(timeZone) {
  const [today, setToday] = useState(() => todayIn(timeZone));
  useEffect(() => {
    const check = () => setToday(todayIn(timeZone));
    check();
    const timer = setInterval(check, 60000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [timeZone]);
  return today;
}
