import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Select } from '../../components/Field.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { useToday } from '../../lib/useToday.js';
import { byStatus } from '../../lib/places.js';
import { FIRST_MONTH, LAST_MONTH, addMonths, formatDay, dayInRange, gridDays, gridRange, monthOf, validMonth } from '../../lib/days.js';
import { useT } from '../../i18n/I18nProvider.jsx';
import { byDay } from './items.js';
import { MonthGrid } from './MonthGrid.jsx';
import { CalendarList, DayPanel } from './DayPanel.jsx';

// Address: ?place=&month=YYYY-MM&view=month|list&day=YYYY-MM-DD. No month means the month of the
// place's own today.
export function Calendar() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const places = useResource('/api/places');
  const list = places.data ? byStatus(places.data) : [];
  const place = list.find(p => String(p.id) === params.get('place')) ?? list.find(p => p.status === 'current') ?? list[0] ?? null;
  const change = (edit, opts) => {
    const next = new URLSearchParams(params);
    edit(next);
    setParams(next, opts);
  };
  return (
    <div className="calendar">
      <PageHeader title={t('nav.calendar')}>
        {list.length > 1 && place && (
          <Select aria-label={t('spaces.place')} value={String(place.id)} onChange={e => change(p => p.set('place', e.target.value))}
            options={list.map(p => ({ value: String(p.id), label: p.name }))} />
        )}
      </PageHeader>
      <LoadState loading={places.loading && !places.data} error={places.error} keepChildren={Boolean(places.data)} onRetry={places.reload}>
        {places.data && !place && <p>{t('plants.needPlace')} <Link to="/places/new">{t('places.add')}</Link></p>}
        {place && <PlaceCalendar place={place} params={params} change={change} />}
      </LoadState>
    </div>
  );
}

function PlaceCalendar({ place, params, change }) {
  const { t, language } = useT();
  const { settings } = useSettings();
  const today = useToday(place.time_zone || settings?.time_zone);
  const asked = params.get('month');
  const badMonth = asked !== null && !validMonth(asked);
  const month = validMonth(asked) ? asked : monthOf(today);
  const view = params.get('view') === 'list' ? 'list' : 'month';
  const range = gridRange(month);
  const tasks = useResource(`/api/tasks?place_id=${place.id}&from=${range.from}&to=${range.to}`);
  const trays = useResource(`/api/trays?place_id=${place.id}`);
  useEffect(() => { if (badMonth) change(p => p.delete('month'), { replace: true }); }, [badMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const openDay = params.get('day');
  const day = dayInRange(openDay) && gridDays(month).includes(openDay) ? openDay : null;
  const goMonth = m => change(p => { p.set('month', m); p.delete('day'); });
  const goToday = () => change(p => { p.delete('month'); p.delete('day'); });
  const setView = v => change(p => { if (v === 'list') p.set('view', 'list'); else p.delete('view'); });
  const selectDay = d => change(p => { if (d === day) p.delete('day'); else p.set('day', d); });
  const days = tasks.data && trays.data && byDay(tasks.data, place, range.from, range.to, trays.data);

  return (
    <>
      <div className="cal-bar">
        <div className="cal-nav">
          <Button variant="ghost" icon={ChevronLeft} aria-label={t('calendar.prev')} disabled={month <= FIRST_MONTH} onClick={() => goMonth(addMonths(month, -1))} />
          <h2>{formatDay(month, language, { month: 'long', year: 'numeric' })}</h2>
          <Button variant="ghost" icon={ChevronRight} aria-label={t('calendar.next')} disabled={month >= LAST_MONTH} onClick={() => goMonth(addMonths(month, 1))} />
        </div>
        <div className="cal-tools">
          <Button variant="ghost" onClick={goToday}>{t('calendar.today')}</Button>
          <div className="cal-views" role="group" aria-label={t('calendar.view')}>
            <button type="button" className="corr-tab" aria-pressed={view === 'month'} onClick={() => setView('month')}>{t('calendar.month')}</button>
            <button type="button" className="corr-tab" aria-pressed={view === 'list'} onClick={() => setView('list')}>{t('calendar.list')}</button>
          </div>
        </div>
      </div>
      <LoadState loading={!days} error={tasks.error ?? trays.error} onRetry={() => { tasks.reload(); trays.reload(); }}>
        {days && (view === 'list' ? <CalendarList month={month} days={days} today={today} /> : (
          <div className="cal-month">
            <MonthGrid month={month} days={days} today={today} selected={day} onSelect={selectDay} />
            {day && <DayPanel day={day} items={days.get(day)} today={today} />}
          </div>
        ))}
      </LoadState>
    </>
  );
}
