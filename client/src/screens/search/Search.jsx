import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { useResource } from '../../lib/useResource.js';
import { starterText } from '../../lib/starter.js';
import { useT } from '../../i18n/I18nProvider.jsx';

const MIN = 2;
const GROUPS = ['plants', 'guides', 'plantings', 'log', 'places', 'spaces'];

export function Search() {
  const { t, tc } = useT();
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const long = q.length >= MIN;
  const result = useResource(long ? `/api/search?${new URLSearchParams({ q })}` : null);

  // How each group's items look: [link, name, detail].
  const line = {
    plants: p => [`/library/plants/${p.id}`, starterText(tc, p, 'name', p.name),
      [t(`plants.kind.${p.kind}`), p.summary && starterText(tc, p, 'summary', p.summary)].filter(Boolean).join(' · ')],
    guides: g => [`/library/guides/${g.id}`, starterText(tc, g, 'title', g.title),
      g.plant_name ? starterText(tc, { starter_key: g.plant_starter_key, is_starter: g.plant_is_starter }, 'name', g.plant_name) : t('guides.basics')],
    places: p => [`/places/${p.id}`, p.name, p.location],
    spaces: s => [`/spaces/${s.id}`, s.name, `${t(`spaces.kind.${s.kind}`)} · ${s.place_name}`],
    plantings: x => [`/plantings/${x.id}`,
      `${tc(x.plant_is_starter ? x.plant_starter_key : null, 'name', x.plant_name)}${x.variety_name ? ` (${x.variety_name})` : ''}`,
      `${x.space_name} · ${t(`plantings.statusName.${x.status}`)}`],
    log: x => [`/plantings/${x.planting_id}`, x.note, `${t(`log.kind.${x.kind}`)} · ${tc(x.plant_is_starter ? x.plant_starter_key : null, 'name', x.plant_name)} · ${x.on_date}`],
  };
  const groups = result.data?.groups;
  const shown = groups ? GROUPS.filter(g => groups[g]?.total > 0) : [];

  return (
    <>
      <PageHeader title={t('search.title')} />
      {!long && <p className="muted">{t('search.tooShort')}</p>}
      {long && (
        <LoadState loading={!groups && !result.error} error={result.error} onRetry={result.reload}>
          <p>{t('search.results', { q })}</p>
          {groups && shown.length === 0 && <p className="muted">{t('search.none', { q })}</p>}
          {shown.map(g => {
            const { total, items } = groups[g];
            return (
              <section key={g} className="search-group" aria-labelledby={`search-${g}`}>
                <h2 id={`search-${g}`}>{t(`search.group.${g}`)} <span className="muted search-count">{t('search.count', { n: total })}</span></h2>
                <ul className="list">
                  {items.map(item => {
                    const [to, name, detail] = line[g](item);
                    return (
                      <li key={item.id}>
                        <Link to={to} className="search-row"><strong>{name}</strong>{detail && <span className="muted">{detail}</span>}</Link>
                      </li>
                    );
                  })}
                </ul>
                {total > items.length && <p className="muted">{t('search.more', { n: total - items.length })}</p>}
              </section>
            );
          })}
        </LoadState>
      )}
    </>
  );
}
