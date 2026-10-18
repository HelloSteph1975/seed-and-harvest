import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Field, Select } from '../../components/Field.jsx';
import { ReorderButtons } from '../../components/ReorderButtons.jsx';
import { SpaceKindIcon } from '../../components/SpaceKindIcon.jsx';
import { useResource } from '../../lib/useResource.js';
import { useReorder } from '../../lib/useReorder.js';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { byStatus } from '../../lib/places.js';
import { SPACE_KINDS } from '../../lib/spaces.js';
import { useT } from '../../i18n/I18nProvider.jsx';

const REMEMBER = 'seed-harvest.spaces.place';

export function Spaces() {
  const { t } = useT();
  const places = useResource('/api/places');
  const [params] = useSearchParams();
  const linked = params.get('place');
  const [chosen, setChosen] = useState(() => linked ?? readLocal(REMEMBER));
  // A link that names a place (from Today or a place page) opens that place once; picking
  // another place in the menu afterwards still works.
  const [seenLink, setSeenLink] = useState(null);
  if (linked !== seenLink) {
    setSeenLink(linked);
    if (linked) { setChosen(linked); writeLocal(REMEMBER, linked); }
  }
  const list = places.data ? byStatus(places.data) : [];
  // The remembered place if it still exists, else the current one, else the first.
  const placeId = list.find(p => String(p.id) === chosen)?.id ?? list.find(p => p.status === 'current')?.id ?? list[0]?.id;
  const choose = id => { setChosen(id); writeLocal(REMEMBER, id); };

  return (
    <>
      <PageHeader title={t('spaces.title')}>
        {placeId && <Button as={Link} to={`/spaces/new?place=${placeId}`} icon={Plus}>{t('spaces.add')}</Button>}
      </PageHeader>
      <LoadState loading={places.loading && !places.data} error={places.error} keepChildren={Boolean(places.data)} onRetry={places.reload}>
        {places.data?.length === 0 && <p>{t('spaces.noPlaces')} <Link to="/places/new">{t('places.add')}</Link></p>}
        {placeId && (
          <>
            <Field label={t('spaces.place')}>
              <Select value={String(placeId)} onChange={e => choose(e.target.value)} options={list.map(p => ({ value: String(p.id), label: p.name }))} />
            </Field>
            <SpaceList key={placeId} placeId={placeId} />
          </>
        )}
      </LoadState>
    </>
  );
}

function SpaceList({ placeId }) {
  const { t } = useT();
  const list = useResource(`/api/spaces?place_id=${placeId}`);
  const extra = useMemo(() => ({ place_id: placeId }), [placeId]);
  // Spaces show grouped by kind, so moves happen within a group and save the order shown.
  const groups = useMemo(() => {
    const rows = list.data ?? [];
    return SPACE_KINDS.map(kind => rows.filter(s => s.kind === kind)).filter(g => g.length > 0);
  }, [list.data]);
  const shown = useMemo(() => ({ ...list, data: groups.flat() }), [list, groups]);
  const move = useReorder(shown, '/api/spaces', extra);
  return (
    <LoadState loading={list.loading && !list.data} error={list.error} keepChildren={Boolean(list.data)} onRetry={list.reload}>
      {list.data?.length === 0 && <p className="muted">{t('spaces.empty')}</p>}
      {groups.map((group, g) => {
        const kind = group[0].kind;
        const start = groups.slice(0, g).reduce((n, earlier) => n + earlier.length, 0);
        return (
          <section key={kind} className="space-group">
            <h2><SpaceKindIcon kind={kind} /> {t(`spaces.kindPlural.${kind}`)}</h2>
            <ul className="list">
              {group.map((s, i) => (
                <li key={s.id}>
                  <span className="grow"><Link to={`/spaces/${s.id}`}>{s.name}</Link></span>
                  <ReorderButtons index={i} count={group.length} onMove={(at, delta) => move(start + at, delta)} label={s.name} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </LoadState>
  );
}
