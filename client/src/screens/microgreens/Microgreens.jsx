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
import { addDays, dayText } from '../../lib/tasks.js';
import { useT } from '../../i18n/I18nProvider.jsx';
import { ForWhom } from './TrayPage.jsx';

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export function Microgreens() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const places = useResource('/api/places');
  const list = places.data ? byStatus(places.data) : [];
  const place = list.find(p => String(p.id) === params.get('place')) ?? list.find(p => p.status === 'current') ?? list[0] ?? null;
  return (
    <>
      <PageHeader title={t('nav.microgreens')}>
        <Button as={Link} variant="ghost" to="/microgreens/animals">{t('animals.title')}</Button>
        <Button as={Link} icon={Plus} to={place ? `/microgreens/trays/new?place=${place.id}` : '/microgreens/trays/new'}>{t('trays.add')}</Button>
      </PageHeader>
      <LoadState loading={places.loading && !places.data} error={places.error} keepChildren={Boolean(places.data)} onRetry={places.reload}>
        {places.data && !place && <p>{t('plants.needPlace')} <Link to="/places/new">{t('places.add')}</Link></p>}
        {list.length > 1 && place && (
          <label className="inline-field">{t('spaces.place')}{' '}
            <Select aria-label={t('spaces.place')} value={String(place.id)} onChange={e => setParams({ place: e.target.value }, { replace: true })}
              options={list.map(p => ({ value: String(p.id), label: p.name }))} />
          </label>
        )}
        {place && <TrayLists place={place} />}
      </LoadState>
    </>
  );
}

function TrayLists({ place }) {
  const { t, tc, language } = useT();
  const { settings } = useSettings();
  const today = useToday(place.time_zone || settings?.time_zone);
  const trays = useResource(`/api/trays?place_id=${place.id}`);
  const all = trays.data ?? [];
  const active = all.filter(x => x.status === 'growing' || x.status === 'planned');
  const sowNext = all.filter(x => x.next_sow_on && x.next_sow_on <= addDays(today, 6)).sort((a, b) => a.next_sow_on.localeCompare(b.next_sow_on));
  const recent = all.filter(x => x.status === 'harvested' && x.harvested_on >= addDays(today, -30));
  const groups = [];
  for (const x of [...active].sort((a, b) => a.harvest_on.localeCompare(b.harvest_on))) {
    const g = groups.find(y => y.space.id === x.space.id);
    if (g) g.rows.push(x); else groups.push({ space: x.space, rows: [x] });
  }
  const name = x => starterText(tc, x.plant, 'name', x.plant.name);
  const when = x => {
    if (x.status === 'planned') return t('trays.plannedFor', { day: dayText(x.sown_on, language, today) });
    const n = daysBetween(today, x.harvest_on);
    return n <= 0 ? t('trays.ready') : t('trays.daysToGo', { n });
  };
  return (
    <LoadState loading={trays.loading && !trays.data} error={trays.error} keepChildren={Boolean(trays.data)} onRetry={trays.reload}>
      {trays.data && active.length === 0 && sowNext.length === 0 && <p className="muted">{t('trays.none')}</p>}
      {sowNext.length > 0 && (
        <section aria-labelledby="sow-next" className="card">
          <h2 id="sow-next">{t('trays.sowNextTitle')}</h2>
          <ul className="list">
            {sowNext.map(x => (
              <li key={x.id}><Link to={`/microgreens/trays/${x.id}`}>{name(x)}</Link>
                <span className="muted"> · {x.space.name} · {dayText(x.next_sow_on, language, today)} · </span><ForWhom tray={x} /></li>
            ))}
          </ul>
        </section>
      )}
      {groups.map(g => (
        <section key={g.space.id} aria-labelledby={`rack-${g.space.id}`} className="planting-group">
          <h2 id={`rack-${g.space.id}`}>{g.space.name}</h2>
          <ul className="list">
            {g.rows.map(x => (
              <li key={x.id}>
                <span className="grow"><Link to={`/microgreens/trays/${x.id}`}><strong>{name(x)}</strong></Link>
                  {x.tray_count > 1 && <span className="muted"> × {x.tray_count}</span>}
                  <br /><span className={daysBetween(today, x.harvest_on) <= 0 && x.status === 'growing' ? 'ready' : 'muted'}>{when(x)}</span>
                  <span className="muted"> · </span><ForWhom tray={x} /></span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {recent.length > 0 && (
        <section aria-labelledby="recent-trays">
          <h2 id="recent-trays">{t('trays.recent')}</h2>
          <ul className="list">
            {recent.map(x => <li key={x.id}><Link to={`/microgreens/trays/${x.id}`}>{name(x)}</Link> <span className="muted">{dayText(x.harvested_on, language, today)}</span></li>)}
          </ul>
        </section>
      )}
    </LoadState>
  );
}
