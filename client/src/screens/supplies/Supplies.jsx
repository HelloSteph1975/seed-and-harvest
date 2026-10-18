import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Field, Select } from '../../components/Field.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { useToday } from '../../lib/useToday.js';
import { byStatus } from '../../lib/places.js';
import { starterText } from '../../lib/starter.js';
import { addDays, dayText, taskTitle } from '../../lib/tasks.js';
import { useT } from '../../i18n/I18nProvider.jsx';

const WEEKS = ['2', '4', '8'];

// One list of what the coming weeks' tasks need, so the owner can buy ahead.
export function Supplies() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const places = useResource('/api/places');
  const list = places.data ? byStatus(places.data) : [];
  const place = list.find(p => String(p.id) === params.get('place')) ?? list.find(p => p.status === 'current') ?? list[0] ?? null;
  const weeks = WEEKS.includes(params.get('weeks')) ? params.get('weeks') : '4';
  const setParam = (k, v) => { const next = new URLSearchParams(params); next.set(k, v); setParams(next, { replace: true }); };
  return (
    <div className="supplies-page">
      <PageHeader title={t('supplies.title')} />
      <LoadState loading={places.loading && !places.data} error={places.error} keepChildren={Boolean(places.data)} onRetry={places.reload}>
        {places.data && !place && <p>{t('plants.needPlace')} <Link to="/places/new">{t('places.add')}</Link></p>}
        {place && (
          <>
            <div className="filters no-print">
              {list.length > 1 && (
                <Field label={t('spaces.place')}>
                  <Select value={String(place.id)} onChange={e => setParam('place', e.target.value)} options={list.map(p => ({ value: String(p.id), label: p.name }))} />
                </Field>
              )}
              <Field label={t('supplies.ahead')}>
                <Select value={weeks} onChange={e => setParam('weeks', e.target.value)} options={WEEKS.map(w => ({ value: w, label: t('supplies.weeks', { n: Number(w) }) }))} />
              </Field>
            </div>
            <SupplyList place={place} weeks={Number(weeks)} />
          </>
        )}
      </LoadState>
    </div>
  );
}

function SupplyList({ place, weeks }) {
  const { t, tc, language } = useT();
  const { settings } = useSettings();
  const today = useToday(place.time_zone || settings?.time_zone);
  const to = addDays(today, weeks * 7 - 1);
  const supplies = useResource(`/api/supplies?place_id=${place.id}&from=${today}&to=${to}`);
  return (
    <LoadState loading={supplies.loading && !supplies.data} error={supplies.error} keepChildren={Boolean(supplies.data)} onRetry={supplies.reload}>
      <p className="muted">{t('supplies.intro', { place: place.name, from: dayText(today, language, today), to: dayText(to, language, today) })}</p>
      {supplies.data?.length === 0 && <p className="muted">{t('supplies.none')}</p>}
      <ul className="list supply-list">
        {supplies.data?.map(s => (
          <li key={s.name}>
            <details>
              <summary><strong>{tc(s.starter_key, `supply.${s.index}.name`, s.name)}</strong> <span className="muted">{t('supplies.forTasks', { n: s.items.length })}</span></summary>
              <ul>
                {s.items.map(i => (
                  <li key={i.task_id}>
                    {taskTitle({ kind: i.task_kind, title: i.task_title }, t)} · {starterText(tc, i.plant, 'name', i.plant.name)} · {dayText(i.due_on, language, today)}
                    {i.amount && <span className="muted">: {i.amount}</span>}
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </LoadState>
  );
}
