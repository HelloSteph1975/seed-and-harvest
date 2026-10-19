import { LoadState } from '../../components/LoadState.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { starterText } from '../../lib/starter.js';
import { qtyText } from '../../lib/harvests.js';
import { useT } from '../../i18n/I18nProvider.jsx';

const UNITS = ['kg', 'count', 'bunch'];

// "10 lb, 12" for a per-unit total; empty units are left out.
function amounts(o, units, t) {
  return UNITS.filter(u => o?.[u] > 0).map(u => qtyText(o[u], u, units, t)).join(', ') || '-';
}

// A year at a place (or everywhere): what each crop gave, where it went, and what sold.
export function Summary({ place, year }) {
  const { t, tc, language } = useT();
  const { settings } = useSettings();
  const units = settings?.units ?? 'us';
  const summary = useResource(`/api/summary?year=${year}${place ? `&place_id=${place.id}` : ''}`);
  const s = summary.data;
  const money = n => (n ? n.toLocaleString(language, { maximumFractionDigits: 2 }) : '-');
  return (
    <LoadState loading={summary.loading && !s} error={summary.error} keepChildren={Boolean(s)} onRetry={summary.reload}>
      {s && s.by_crop.length === 0 && <p className="muted">{t('harvests.none', { year })}</p>}
      {s && s.by_crop.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="summary">
              <caption>{t('summary.byCrop')}</caption>
              <thead><tr>{['crop', 'total', 'larder', 'kept', 'animals', 'given', 'sold', 'income'].map(k => <th key={k} scope="col">{t(`summary.col.${k}`)}</th>)}</tr></thead>
              <tbody>
                {s.by_crop.map(c => (
                  <tr key={c.plant_id}>
                    <th scope="row">{starterText(tc, c, 'name', c.name)}</th>
                    <td>{amounts(c.totals, units, t)}</td><td>{amounts(c.larder, units, t)}</td><td>{amounts(c.kept, units, t)}</td>
                    <td>{amounts(c.animals, units, t)}</td><td>{amounts(c.given, units, t)}</td><td>{amounts(c.sold, units, t)}</td><td>{money(c.income)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><th scope="row">{t('summary.total')}</th><td>{amounts(s.totals, units, t)}</td><td colSpan={5} /><td>{money(s.totals.income)}</td></tr></tfoot>
            </table>
          </div>
          <div className="table-scroll">
            <table className="summary">
              <caption>{t('summary.byPlace')}</caption>
              <thead><tr><th scope="col">{t('spaces.place')}</th><th scope="col">{t('summary.col.total')}</th><th scope="col">{t('summary.col.income')}</th></tr></thead>
              <tbody>
                {s.by_place.map(p => <tr key={p.place_id}><th scope="row">{p.name}</th><td>{amounts(p, units, t)}</td><td>{money(p.income)}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p className="muted small">{t('summary.note')}</p>
        </>
      )}
    </LoadState>
  );
}
