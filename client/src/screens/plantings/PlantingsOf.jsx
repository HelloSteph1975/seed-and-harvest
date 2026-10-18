import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { useResource } from '../../lib/useResource.js';
import { starterText } from '../../lib/starter.js';
import { useT } from '../../i18n/I18nProvider.jsx';

// A short list of plantings on a plant's or a space's page, with a way to plan another.
export function PlantingsOf({ url, title, empty, addTo, addLabel, showPlant = false }) {
  const { t, tc } = useT();
  const list = useResource(url);
  return (
    <section aria-labelledby="plantings-of">
      <h2 id="plantings-of">{title}</h2>
      <LoadState loading={list.loading && !list.data} error={list.error} keepChildren={Boolean(list.data)} onRetry={list.reload}>
        {list.data?.length === 0 && <p className="muted">{empty}</p>}
        <ul className="list">
          {list.data?.map(p => (
            <li key={p.id}>
              <Link to={`/plantings/${p.id}`}>
                {showPlant ? starterText(tc, p.plant, 'name', p.plant.name) : p.space.name}{p.variety ? ` (${p.variety.name})` : ''}
              </Link>
              <span className="muted"> · {t(`plantings.statusName.${p.status}`)}</span>
            </li>
          ))}
        </ul>
      </LoadState>
      <Button as={Link} variant="ghost" icon={Plus} to={addTo}>{addLabel}</Button>
    </section>
  );
}
