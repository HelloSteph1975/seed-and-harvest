import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Checkbox, Select } from '../../components/Field.jsx';
import { ToggleGroup } from '../../components/ToggleGroup.jsx';
import { useResource } from '../../lib/useResource.js';
import { starterText } from '../../lib/starter.js';
import { byStatus } from '../../lib/places.js';
import { zoneFit } from '../../lib/windows.js';
import { useT } from '../../i18n/I18nProvider.jsx';

export const PLANT_KINDS = ['vegetable', 'herb', 'microgreen', 'fruit_tree', 'shrub', 'vine'];

export function Library() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'guides' ? 'guides' : 'plants';
  return (
    <>
      <PageHeader title={t('library.title')}>
        <Button as={Link} to={tab === 'guides' ? '/library/guides/new' : '/library/plants/new'} icon={Plus}>
          {tab === 'guides' ? t('guides.add') : t('plants.add')}
        </Button>
      </PageHeader>
      <div className="tabs" role="tablist" aria-label={t('library.title')}>
        {['plants', 'guides'].map(k => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' is-active' : ''}`}
            onClick={() => setParams(k === 'plants' ? {} : { tab: k }, { replace: true })}>{t(`library.tab.${k}`)}</button>
        ))}
      </div>
      {tab === 'plants' ? <PlantList /> : <BasicsList />}
    </>
  );
}

function PlantList() {
  const { t, tc, language } = useT();
  const list = useResource('/api/plants');
  const places = useResource('/api/places');
  const [kinds, setKinds] = useState([]);
  const [pot, setPot] = useState(false);
  const [fit, setFit] = useState(false);
  const [placeId, setPlaceId] = useState(null);
  const placeList = places.data ? byStatus(places.data) : [];
  const place = placeList.find(p => p.id === placeId) ?? placeList.find(p => p.status === 'current') ?? placeList[0];
  const rows = (list.data ?? []).filter(p => (!kinds.length || kinds.includes(p.kind)) && (!pot || p.container_ok)
    && (!fit || !place || ['fits', 'unknown'].includes(zoneFit(p, place))))
    .map(p => ({ ...p, shown: starterText(tc, p, 'name', p.name) }))
    .sort((a, b) => a.shown.localeCompare(b.shown, language, { sensitivity: 'base' }));
  return (
    <section className="library-plants">
      <div className="filters">
        <ToggleGroup label={t('plants.kindFilter')} value={kinds} onChange={setKinds}
          options={PLANT_KINDS.map(k => ({ value: k, label: t(`plants.kind.${k}`) }))} />
        <Checkbox label={t('plants.goodInPot')} checked={pot} onChange={e => setPot(e.target.checked)} />
        {place && (
          <span className="fit-filter">
            <Checkbox label={t('plants.fitsPlace', { place: place.name })} checked={fit} onChange={e => setFit(e.target.checked)} />
            {placeList.length > 1 && (
              <Select aria-label={t('spaces.place')} value={String(place.id)} onChange={e => setPlaceId(Number(e.target.value))}
                options={placeList.map(p => ({ value: String(p.id), label: p.name }))} />
            )}
          </span>
        )}
      </div>
      <LoadState loading={list.loading && !list.data} error={list.error} keepChildren={Boolean(list.data)} onRetry={list.reload}>
        {list.data && rows.length === 0 && <p className="muted">{t('plants.none')}</p>}
        <ul className="cards">
          {rows.map(p => (
            <li key={p.id} className="card plant-card">
              {p.cover && <img src={`/photos/${p.cover}`} alt="" loading="lazy" />}
              <h3><Link to={`/library/plants/${p.id}`}>{p.shown}</Link></h3>
              <p className="muted">{t(`plants.kind.${p.kind}`)}{p.is_starter ? <> · <span className="tag">{t('common.starter')}</span></> : null}</p>
              {p.summary && <p>{starterText(tc, p, 'summary', p.summary)}</p>}
            </li>
          ))}
        </ul>
      </LoadState>
    </section>
  );
}

function BasicsList() {
  const { t, tc } = useT();
  const list = useResource('/api/guides');
  return (
    <section>
      <p className="muted">{t('guides.intro')}</p>
      <LoadState loading={list.loading && !list.data} error={list.error} keepChildren={Boolean(list.data)} onRetry={list.reload}>
        {list.data?.length === 0 && <p className="muted">{t('guides.none')}</p>}
        <ul className="list">
          {list.data?.map(g => (
            <li key={g.id}>
              <Link to={`/library/guides/${g.id}`} className="search-row">
                <strong>{starterText(tc, g, 'title', g.title)}</strong>
                {g.summary && <span className="muted">{starterText(tc, g, 'summary', g.summary)}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </LoadState>
    </section>
  );
}
