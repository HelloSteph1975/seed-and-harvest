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
import { yearsText } from '../../lib/tasks.js';

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

// Perennials first by fewest years to fruit, then annuals by fewest days to harvest; nothing known goes last.
const speed = p => (p.years_min != null ? [0, p.years_min] : p.days_min != null ? [1, p.days_min] : [2, 0]);
const bySpeed = (a, b) => { const x = speed(a); const y = speed(b); return x[0] - y[0] || x[1] - y[1]; };

function PlantList() {
  const { t, tc, language } = useT();
  const [params] = useSearchParams();
  const list = useResource('/api/plants');
  const places = useResource('/api/places');
  // "What to buy" opens the library with its filters in the address.
  const [kinds, setKinds] = useState(() => (params.get('kinds') ?? '').split(',').filter(k => PLANT_KINDS.includes(k)));
  const [pot, setPot] = useState(() => params.get('pot') === '1');
  const [fit, setFit] = useState(() => params.get('fit') === '1');
  const [sort, setSort] = useState(() => (params.get('sort') === 'fast' ? 'fast' : 'name'));
  const [placeId, setPlaceId] = useState(() => (params.get('place') ? Number(params.get('place')) : null));
  const placeList = places.data ? byStatus(places.data) : [];
  const place = placeList.find(p => p.id === placeId) ?? placeList.find(p => p.status === 'current') ?? placeList[0];
  const byName = (a, b) => a.shown.localeCompare(b.shown, language, { sensitivity: 'base' });
  const rows = (list.data ?? []).filter(p => (!kinds.length || kinds.includes(p.kind)) && (!pot || p.container_ok))
    .map(p => {
      const zone = place ? zoneFit(p, place) : 'unknown';
      // Too tender for the place, but good in a pot: it can winter inside, so it stays when pots are wanted.
      return { ...p, shown: starterText(tc, p, 'name', p.name), potInside: fit && pot && zone === 'too_cold' && Boolean(p.container_ok), zone };
    })
    .filter(p => !fit || !place || ['fits', 'unknown'].includes(p.zone) || p.potInside)
    .sort((a, b) => (sort === 'fast' ? bySpeed(a, b) : 0) || byName(a, b));
  return (
    <section className="library-plants">
      <div className="filters">
        <ToggleGroup label={t('plants.kindFilter')} value={kinds} onChange={setKinds}
          options={PLANT_KINDS.map(k => ({ value: k, label: t(`plants.kind.${k}`) }))} />
        <Checkbox label={t('plants.goodInPot')} checked={pot} onChange={e => setPot(e.target.checked)} />
        <label className="inline-field">{t('plants.sortBy')}{' '}
          <Select aria-label={t('plants.sortBy')} value={sort} onChange={e => setSort(e.target.value)}
            options={[{ value: 'name', label: t('plants.sort.name') }, { value: 'fast', label: t('plants.sort.fast') }]} />
        </label>
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
              <p className="muted">{t(`plants.kind.${p.kind}`)}{p.is_starter ? <> · <span className="tag">{t('common.starter')}</span></> : null}
                {p.potInside && <> · <span className="tag">{t('plants.potInside')}</span></>}
                {sort === 'fast' && p.years_min != null && <> · {yearsText(t, p.years_min, p.years_max)}</>}</p>
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
