import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { nextFrostEvent } from '../../lib/frost.js';
import { useToday } from '../../lib/useToday.js';
import { frostDay, monthName, needsFrostDates } from '../../lib/places.js';
import { useT } from '../../i18n/I18nProvider.jsx';
import { TaskList } from './TaskList.jsx';

export function Today() {
  const { t } = useT();
  const places = useResource('/api/places');
  const current = places.data?.find(p => p.status === 'current');
  return (
    <div className="today">
      <PageHeader title={t('nav.today')} />
      <LoadState loading={places.loading && !places.data} error={places.error} keepChildren={Boolean(places.data)} onRetry={places.reload}>
        {places.data?.length === 0 && (
          <section className="card welcome">
            <p>{t('today.welcome')}</p>
            <p><Link className="btn btn-primary btn-md" to="/places/new">{t('places.add')}</Link></p>
          </section>
        )}
        {places.data?.length > 0 && !current && (
          <section className="card">
            <p>{t('today.chooseCurrent')}</p>
            <p><Link to="/places">{t('today.goPlaces')}</Link></p>
          </section>
        )}
        {current && <CurrentPlace place={current} />}
      </LoadState>
    </div>
  );
}

function CurrentPlace({ place }) {
  const { t, language } = useT();
  const { settings } = useSettings();
  const spaces = useResource(`/api/spaces?place_id=${place.id}`);
  const today = useToday(place.time_zone || settings?.time_zone);
  const next = nextFrostEvent(place, today);
  let frostLine = null;
  if (place.frost_free) {
    frostLine = place.wet_months.length
      ? t('today.frostFreeRain', { months: place.wet_months.map(m => monthName(m, language)).join(', ') })
      : t('today.frostFree');
  } else if (next) {
    const key = next.days === 0 ? `today.${next.kind}FrostToday` : `today.${next.kind}FrostIn`;
    frostLine = t(key, { n: next.days, day: frostDay(next.date.slice(5), language) });
  }
  const n = spaces.data?.length;
  return (
    <>
    <section className="card current-place">
      <h2>{place.name}</h2>
      {place.zone && <p><span className="tag">{t('places.zoneShort', { zone: place.zone })}</span></p>}
      {frostLine && <p className="frost-line">{frostLine}</p>}
      {needsFrostDates(place) && <p className="note">{t('places.needFrost')} <Link to={`/places/${place.id}/edit`}>{t('today.addFrost')}</Link></p>}
      {n !== undefined && (n > 0
        ? <p><Link to={`/spaces?place=${place.id}`}>{t('today.spaceCount', { n })}</Link></p>
        : <p className="muted">{t('places.noSpaces')} <Link to={`/spaces/new?place=${place.id}`}>{t('spaces.add')}</Link></p>)}
    </section>
    <TaskList place={place} today={today} />
    </>
  );
}
