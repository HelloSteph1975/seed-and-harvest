import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Select } from '../../components/Field.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { useToday } from '../../lib/useToday.js';
import { byStatus } from '../../lib/places.js';
import { starterText } from '../../lib/starter.js';
import { dayText, STATUSES, taskTitle } from '../../lib/tasks.js';
import { useT } from '../../i18n/I18nProvider.jsx';

export function Plantings() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const places = useResource('/api/places');
  const list = places.data ? byStatus(places.data) : [];
  const place = list.find(p => String(p.id) === params.get('place')) ?? list.find(p => p.status === 'current') ?? list[0] ?? null;
  const status = STATUSES.includes(params.get('status')) ? params.get('status') : '';
  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  return (
    <>
      <PageHeader title={t('nav.plantings')}>
        <Button as={Link} to={place ? `/plantings/new?place=${place.id}` : '/plantings/new'} icon={Plus}>{t('plantings.add')}</Button>
      </PageHeader>
      <LoadState loading={places.loading && !places.data} error={places.error} keepChildren={Boolean(places.data)} onRetry={places.reload}>
        {places.data && list.length === 0 && <p>{t('plants.needPlace')} <Link to="/places/new">{t('places.add')}</Link></p>}
        {place && (
          <>
            <div className="filters">
              {list.length > 1 && (
                <label className="inline-field">{t('spaces.place')}{' '}
                  <Select aria-label={t('spaces.place')} value={String(place.id)} onChange={e => setParam('place', e.target.value)}
                    options={list.map(p => ({ value: String(p.id), label: p.name }))} />
                </label>
              )}
              <label className="inline-field">{t('plantings.status')}{' '}
                <Select aria-label={t('plantings.status')} value={status} onChange={e => setParam('status', e.target.value)} placeholder={t('plantings.allStatuses')}
                  options={STATUSES.map(s => ({ value: s, label: t(`plantings.statusName.${s}`) }))} />
              </label>
            </div>
            <PlantingList place={place} status={status} />
          </>
        )}
      </LoadState>
    </>
  );
}

function PlantingList({ place, status }) {
  const { t, tc, language } = useT();
  const { settings } = useSettings();
  const today = useToday(place.time_zone || settings?.time_zone);
  const plantings = useResource(`/api/plantings?place_id=${place.id}${status ? `&status=${status}` : ''}`);
  const groups = [];
  for (const p of plantings.data ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.space.id === p.space.id) last.rows.push(p); else groups.push({ space: p.space, rows: [p] });
  }
  return (
    <LoadState loading={plantings.loading && !plantings.data} error={plantings.error} keepChildren={Boolean(plantings.data)} onRetry={plantings.reload}>
      {plantings.data?.length === 0 && <p className="muted">{t('plantings.none')}</p>}
      {groups.map(g => (
        <section key={g.space.id} aria-labelledby={`space-${g.space.id}`} className="planting-group">
          <h2 id={`space-${g.space.id}`}>{g.space.name}</h2>
          <ul className="list">
            {g.rows.map(p => (
              <li key={p.id}>
                <span className="grow">
                  <Link to={`/plantings/${p.id}`}><strong>{starterText(tc, p.plant, 'name', p.plant.name)}</strong>{p.variety ? ` (${p.variety.name})` : ''}</Link>
                  {p.count != null && <span className="muted"> · {t('plantings.countShort', { n: p.count })}</span>}
                  <br />
                  <span className="muted">{t(`plantings.statusName.${p.status}`)}
                    {p.next_task && <> · {t('plantings.next', { task: taskTitle(p.next_task, t), day: dayText(p.next_task.due_on, language, today) })}</>}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </LoadState>
  );
}
