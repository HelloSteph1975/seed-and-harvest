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
import { bearingText, dayText, taskTitle } from '../../lib/tasks.js';
import { useT } from '../../i18n/I18nProvider.jsx';

// The perennials at a place: trees, shrubs, vines and perennial herbs, in the ground or in pots.
export function FoodForest() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const places = useResource('/api/places');
  const list = places.data ? byStatus(places.data) : [];
  const place = list.find(p => String(p.id) === params.get('place')) ?? list.find(p => p.status === 'current') ?? list[0] ?? null;
  return (
    <>
      <PageHeader title={t('nav.foodForest')}>
        {place && <Button as={Link} variant="ghost" to={`/library?kinds=fruit_tree,shrub,vine&fit=1&sort=fast&place=${place.id}`}>{t('foodForest.whatToBuy')}</Button>}
        <Button as={Link} icon={Plus} to={place ? `/plantings/new?place=${place.id}&perennial=1` : '/plantings/new?perennial=1'}>{t('foodForest.add')}</Button>
      </PageHeader>
      <p className="muted">{t('foodForest.intro')}</p>
      <LoadState loading={places.loading && !places.data} error={places.error} keepChildren={Boolean(places.data)} onRetry={places.reload}>
        {places.data && !place && <p>{t('plants.needPlace')} <Link to="/places/new">{t('places.add')}</Link></p>}
        {list.length > 1 && place && (
          <label className="inline-field">{t('spaces.place')}{' '}
            <Select aria-label={t('spaces.place')} value={String(place.id)} onChange={e => setParams({ place: e.target.value }, { replace: true })}
              options={list.map(p => ({ value: String(p.id), label: p.name }))} />
          </label>
        )}
        {place && <Perennials place={place} />}
      </LoadState>
    </>
  );
}

function Perennials({ place }) {
  const { t, tc, language } = useT();
  const { settings } = useSettings();
  const today = useToday(place.time_zone || settings?.time_zone);
  const plantings = useResource(`/api/plantings?place_id=${place.id}&perennial=1`);
  const groups = [];
  for (const p of (plantings.data ?? []).filter(x => x.status !== 'done')) {
    const g = groups.find(y => y.space.id === p.space.id);
    if (g) g.rows.push(p); else groups.push({ space: p.space, rows: [p] });
  }
  return (
    <LoadState loading={plantings.loading && !plantings.data} error={plantings.error} keepChildren={Boolean(plantings.data)} onRetry={plantings.reload}>
      {plantings.data && groups.length === 0 && <p className="muted">{t('foodForest.none')}</p>}
      {groups.map(g => (
        <section key={g.space.id} aria-labelledby={`ff-${g.space.id}`} className="planting-group">
          <h2 id={`ff-${g.space.id}`}>{g.space.name}</h2>
          <ul className="list">
            {g.rows.map(p => (
              <li key={p.id}>
                <span className="grow">
                  <Link to={`/plantings/${p.id}`}><strong>{starterText(tc, p.plant, 'name', p.plant.name)}</strong>{p.variety ? ` (${p.variety.name})` : ''}</Link>
                  {p.in_container ? <> <span className="tag">{t('foodForest.pot')}</span></> : null}
                  <br />
                  <span className="muted">{[bearingText(p.bears_on, today, t, language),
                    p.next_task && t('plantings.next', { task: taskTitle(p.next_task, t), day: dayText(p.next_task.due_on, language, today) })].filter(Boolean).join(' · ')}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </LoadState>
  );
}
