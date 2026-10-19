import { useSearchParams, Link } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Select } from '../../components/Field.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { byStatus } from '../../lib/places.js';
import { starterText } from '../../lib/starter.js';
import { toDisplay, unitLabel } from '../../lib/units.js';
import { useT } from '../../i18n/I18nProvider.jsx';

function Group({ id, title, rows, empty }) {
  const { t, tc } = useT();
  const { settings } = useSettings();
  const units = settings?.units ?? 'us';
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {rows.length === 0 && <p className="muted">{empty}</p>}
      <ul className="list">
        {rows.map(r => {
          const amounts = [
            r.count != null && t('plantings.countShort', { n: r.count, count: r.count }),
            r.row_m != null && t('plan.rowOf', { n: toDisplay('length', r.row_m, units), unit: unitLabel('length', units) }),
          ].filter(Boolean);
          return (
            <li key={`${r.plant.id}:${r.variety?.id ?? ''}`}>
              <span className="grow">
                <strong>{starterText(tc, r.plant, 'name', r.plant.name)}{r.variety ? ` (${r.variety.name})` : ''}</strong>
                {amounts.length > 0 && <> · {amounts.join(' · ')}</>}
                <br /><span className="muted">{r.spaces.join(', ')}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Seeds, plants and supplies for the plantings planned in a year at one place, laid out to print.
export function ToBuy({ year }) {
  const { t, tc } = useT();
  const [params, setParams] = useSearchParams();
  const places = useResource('/api/places');
  const list = places.data ? byStatus(places.data) : [];
  const place = list.find(p => String(p.id) === params.get('place')) ?? list.find(p => p.status === 'current') ?? list[0] ?? null;
  const out = useResource(place ? `/api/plan/to-buy?year=${year}&place_id=${place.id}` : null);
  const setPlace = v => { const next = new URLSearchParams(params); next.set('place', v); setParams(next, { replace: true }); };
  return (
    <div className="supplies-page">
      <LoadState loading={(places.loading && !places.data) || (place && out.loading && !out.data)} error={places.error ?? out.error}
        keepChildren={Boolean(out.data)} onRetry={() => { places.reload(); out.reload(); }}>
        {places.data && !place && <p>{t('plants.needPlace')} <Link to="/places/new">{t('places.add')}</Link></p>}
        {place && (
          <div className="filters no-print">
            {list.length > 1 && (
              <label className="inline-field">{t('spaces.place')}{' '}
                <Select aria-label={t('spaces.place')} value={String(place.id)} onChange={e => setPlace(e.target.value)} options={list.map(p => ({ value: String(p.id), label: p.name }))} />
              </label>
            )}
            <Button variant="ghost" icon={Printer} onClick={() => window.print()}>{t('plan.print')}</Button>
          </div>
        )}
        {out.data && (
          <>
            <p className="muted">{t('plan.toBuyIntro', { place: place.name, year })}</p>
            <Group id="to-buy-seeds" title={t('plan.seeds')} rows={out.data.seeds} empty={t('plan.noSeeds')} />
            <Group id="to-buy-plants" title={t('plan.plantsToBuy')} rows={out.data.plants} empty={t('plan.noPlants')} />
            <section aria-labelledby="to-buy-supplies">
              <h2 id="to-buy-supplies">{t('plan.supplies')}</h2>
              {out.data.supplies.length === 0 && <p className="muted">{t('plan.noSupplies')}</p>}
              <ul className="list supply-list">
                {out.data.supplies.map(s => (
                  <li key={s.name}>
                    <strong>{tc(s.starter_key, `supply.${s.index}.name`, s.name)}</strong>{' '}
                    <span className="muted">{[...new Set(s.items.map(i => starterText(tc, i.plant, 'name', i.plant.name)))].join(', ')}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </LoadState>
    </div>
  );
}
