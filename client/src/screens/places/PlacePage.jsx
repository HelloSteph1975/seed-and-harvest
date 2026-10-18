import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { useConfirm } from '../../components/ConfirmProvider.jsx';
import { useToast } from '../../components/ToastProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { api } from '../../lib/api.js';
import { errorText } from '../../lib/errors.js';
import { frostDay, monthName, needsFrostDates } from '../../lib/places.js';
import { useT } from '../../i18n/I18nProvider.jsx';

export function PlacePageRoute() {
  const { id } = useParams();
  return <PlacePage key={id} id={id} />;
}

function PlacePage({ id }) {
  const { t, language } = useT();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const place = useResource(`/api/places/${id}`);
  const spaces = useResource(`/api/spaces?place_id=${id}`);
  const p = place.data;

  const remove = async () => {
    const n = spaces.data?.length ?? 0;
    const body = [n > 0 && t('places.deleteWithSpaces', { n }), t('places.deleteBody')].filter(Boolean).join(' ');
    if (!await confirm({ title: t('places.deleteTitle', { name: p.name }), body, confirmLabel: t('common.delete'), danger: true })) return;
    const name = p.name;
    try {
      await api.del(`/api/places/${p.id}`);
    } catch (err) {
      toast.show({ message: errorText(err, t) });
      place.reload();
      return;
    }
    navigate('/places');
    toast.show({
      message: t('places.deleted', { name }),
      action: { label: t('common.undo'), onClick: async () => {
        try { await api.post(`/api/places/${p.id}/restore`); navigate(`/places/${p.id}`); } catch (err) { toast.show({ message: errorText(err, t) }); }
      } },
      duration: 8000,
    });
  };

  return (
    <article className="entry place">
      <LoadState loading={place.loading && !p} error={place.error} keepChildren={Boolean(p)} onRetry={place.reload}>
        {p && (
          <>
            <PageHeader title={p.name}>
              <Button as={Link} variant="ghost" icon={Pencil} to={`/places/${p.id}/edit`}>{t('common.edit')}</Button>
              <Button variant="ghost" icon={Trash2} onClick={remove}>{t('common.delete')}</Button>
            </PageHeader>
            <p className="entry-meta"><span className={`tag tag-${p.status}`}>{t(`places.status.${p.status}`)}</span>{p.location && <span>{p.location}</span>}</p>
            <dl className="entry-facts">
              {p.zone && <><dt>{t('places.zone')}</dt><dd>{p.zone}</dd></>}
              {p.frost_free ? (
                <><dt>{t('places.frost')}</dt><dd>{t('places.frostFreeShort')}</dd>
                  {p.wet_months.length > 0 && <><dt>{t('places.wetMonths')}</dt><dd>{p.wet_months.map(m => monthName(m, language)).join(', ')}</dd></>}</>
              ) : (
                <>
                  {p.last_frost && <><dt>{t('places.lastFrost')}</dt><dd>{frostDay(p.last_frost, language)}</dd></>}
                  {p.first_frost && <><dt>{t('places.firstFrost')}</dt><dd>{frostDay(p.first_frost, language)}</dd></>}
                </>
              )}
              <dt>{t('places.hemisphere')}</dt><dd>{t(`places.hemisphere.${p.hemisphere}`)}</dd>
              {p.time_zone && <><dt>{t('places.timeZone')}</dt><dd>{p.time_zone}</dd></>}
            </dl>
            {needsFrostDates(p) && <p className="note">{t('places.needFrost')}</p>}
            {p.notes && p.notes.split(/\n\s*\n/).map((para, i) => <p key={i}>{para}</p>)}
            <section>
              <h2>{t('places.spaces')}</h2>
              <LoadState loading={spaces.loading && !spaces.data} error={spaces.error} keepChildren={Boolean(spaces.data)} onRetry={spaces.reload}>
                {spaces.data?.length === 0 && <p className="muted">{t('places.noSpaces')}</p>}
                <ul className="list">
                  {spaces.data?.map(s => (
                    <li key={s.id}><Link to={`/spaces/${s.id}`}>{s.name}</Link> <span className="muted">{t(`spaces.kind.${s.kind}`)}</span></li>
                  ))}
                </ul>
                <p><Link to={`/spaces/new?place=${p.id}`}>{t('spaces.add')}</Link></p>
              </LoadState>
            </section>
          </>
        )}
      </LoadState>
      <p><Link to="/places">{t('places.back')}</Link></p>
    </article>
  );
}
