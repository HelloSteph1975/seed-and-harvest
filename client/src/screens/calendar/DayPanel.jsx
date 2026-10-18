import { Link } from 'react-router-dom';
import { formatDay, monthOf } from '../../lib/days.js';
import { starterText } from '../../lib/starter.js';
import { dayText, taskTitle } from '../../lib/tasks.js';
import { useT } from '../../i18n/I18nProvider.jsx';
import { itemName, markClass } from './items.js';

const LONG = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

// One day's items, each opening its planting and its guide.
export function ItemList({ items, today }) {
  const { t, tc, language } = useT();
  return (
    <ul className="cal-items">
      {items.map(item => (
        <li key={item.key} className={`cal-item ${markClass(item)}`}>
          <span className="cal-dot" aria-hidden="true" />
          {item.kind === 'cut' || item.kind === 'sow' ? <Link to={`/microgreens/trays/${item.tray.id}`}>{itemName(item, t, tc)}</Link>
            : item.kind === 'frost' ? <span>{t(item.frost === 'last' ? 'calendar.lastFrost' : 'calendar.firstFrost')}</span> : (
            <>
              <span>{taskTitle(item.task, t)}</span>
              <Link to={`/plantings/${item.task.planting_id}`}>{starterText(tc, item.task.plant, 'name', item.task.plant.name)}{item.task.variety_name ? ` (${item.task.variety_name})` : ''}</Link>
              <span className="muted">{item.task.space.name}</span>
              {item.task.end_on && <span className="muted">{t('plants.range', { from: dayText(item.task.due_on, language, today), to: dayText(item.task.end_on, language, today) })}</span>}
              {item.task.done_on && <span className="tag">{t('tasks.doneOn', { day: dayText(item.task.done_on, language, today) })}</span>}
              {item.task.guide && <Link to={`/library/guides/${item.task.guide.id}`}>{starterText(tc, item.task.guide, 'title', item.task.guide.title)}</Link>}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export function DayPanel({ day, items, today }) {
  const { t, language } = useT();
  const title = formatDay(day, language, LONG);
  return (
    <section className="cal-panel" aria-label={title}>
      <h2>{title}</h2>
      {!items?.length ? <p className="muted">{t('calendar.empty')}</p> : <ItemList items={items} today={today} />}
    </section>
  );
}

// The shown month's days that have something on them, in date order.
export function CalendarList({ month, days, today }) {
  const { t, language } = useT();
  const inMonth = [...days].filter(([day]) => monthOf(day) === month);
  if (inMonth.length === 0) return <p className="muted">{t('calendar.monthEmpty')}</p>;
  return (
    <ol className="cal-list">
      {inMonth.map(([day, items]) => (
        <li key={day}>
          <h3>{formatDay(day, language, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
          <ItemList items={items} today={today} />
        </li>
      ))}
    </ol>
  );
}
