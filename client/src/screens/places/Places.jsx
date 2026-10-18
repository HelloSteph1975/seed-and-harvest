import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { ReorderButtons } from '../../components/ReorderButtons.jsx';
import { useResource } from '../../lib/useResource.js';
import { useReorder } from '../../lib/useReorder.js';
import { byStatus, frostDay } from '../../lib/places.js';
import { useT } from '../../i18n/I18nProvider.jsx';

export function PlaceSummary({ place }) {
  const { t, language } = useT();
  const bits = [];
  if (place.zone) bits.push(t('places.zoneShort', { zone: place.zone }));
  if (place.frost_free) bits.push(t('places.frostFreeShort'));
  else if (place.last_frost || place.first_frost) {
    bits.push(t('places.frostShort', { last: frostDay(place.last_frost, language) || '?', first: frostDay(place.first_frost, language) || '?' }));
  }
  return bits.length ? <span className="muted">{bits.join(' · ')}</span> : null;
}

export function Places() {
  const { t } = useT();
  const list = useResource('/api/places');
  const rows = useMemo(() => (list.data ? byStatus(list.data) : []), [list.data]);
  // Places show grouped by status (current, later, past), so moves happen within a group and save the order shown.
  const shown = useMemo(() => ({ ...list, data: rows }), [list, rows]);
  const move = useReorder(shown, '/api/places');
  const group = p => rows.filter(r => r.status === p.status);
  return (
    <>
      <PageHeader title={t('places.title')}>
        <Button as={Link} to="/places/new" icon={Plus}>{t('places.add')}</Button>
      </PageHeader>
      <p className="muted">{t('places.intro')}</p>
      <LoadState loading={list.loading && !list.data} error={list.error} keepChildren={Boolean(list.data)} onRetry={list.reload}>
        {list.data?.length === 0 && <p>{t('places.empty')}</p>}
        <ul className="list">
          {rows.map((p, i) => (
            <li key={p.id}>
              <span className="grow">
                <Link to={`/places/${p.id}`}><strong>{p.name}</strong></Link>{' '}
                <span className={`tag tag-${p.status}`}>{t(`places.status.${p.status}`)}</span>
                <br /><PlaceSummary place={p} />
              </span>
              <ReorderButtons index={group(p).indexOf(p)} count={group(p).length} onMove={(at, delta) => move(i - group(p).indexOf(p) + at, delta)} label={p.name} />
            </li>
          ))}
        </ul>
      </LoadState>
    </>
  );
}
