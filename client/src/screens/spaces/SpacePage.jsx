import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { PhotoGallery } from '../../components/PhotoGallery.jsx';
import { SpaceKindIcon } from '../../components/SpaceKindIcon.jsx';
import { useConfirm } from '../../components/ConfirmProvider.jsx';
import { useToast } from '../../components/ToastProvider.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { api } from '../../lib/api.js';
import { errorText } from '../../lib/errors.js';
import { sizeText } from '../../lib/spaces.js';
import { useT } from '../../i18n/I18nProvider.jsx';
import { PlantingsOf } from '../plantings/PlantingsOf.jsx';

export function SpacePageRoute() {
  const { id } = useParams();
  return <SpacePage key={id} id={id} />;
}

function SpacePage({ id }) {
  const { t } = useT();
  const { settings } = useSettings();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const space = useResource(`/api/spaces/${id}`);
  const s = space.data;
  const size = s ? sizeText(s, settings?.units ?? 'us', t) : '';

  const remove = async () => {
    if (!await confirm({ title: t('spaces.deleteTitle', { name: s.name }), body: t('spaces.deleteBody'), confirmLabel: t('common.delete'), danger: true })) return;
    const name = s.name;
    try {
      await api.del(`/api/spaces/${s.id}`);
    } catch (err) {
      toast.show({ message: errorText(err, t) });
      space.reload();
      return;
    }
    navigate('/spaces');
    toast.show({
      message: t('spaces.deleted', { name }),
      action: { label: t('common.undo'), onClick: async () => {
        try { await api.post(`/api/spaces/${s.id}/restore`); navigate(`/spaces/${s.id}`); } catch (err) { toast.show({ message: errorText(err, t) }); }
      } },
      duration: 8000,
    });
  };

  return (
    <article className="entry space">
      <LoadState loading={space.loading && !s} error={space.error} keepChildren={Boolean(s)} onRetry={space.reload}>
        {s && (
          <>
            <PageHeader title={s.name}>
              <Button as={Link} variant="ghost" icon={Pencil} to={`/spaces/${s.id}/edit`}>{t('common.edit')}</Button>
              <Button variant="ghost" icon={Trash2} onClick={remove}>{t('common.delete')}</Button>
            </PageHeader>
            <p className="entry-meta"><SpaceKindIcon kind={s.kind} /> <span>{t(`spaces.kind.${s.kind}`)}</span>
              {s.kind === 'greenhouse' && s.heated === 1 && <span className="tag">{t('spaces.heated')}</span>}</p>
            <dl className="entry-facts">
              {size && <><dt>{t('spaces.size')}</dt><dd>{size}</dd></>}
              {s.sun && <><dt>{t('spaces.sun')}</dt><dd>{t(`spaces.sun.${s.sun}`)}</dd></>}
            </dl>
            {s.notes && s.notes.split(/\n\s*\n/).map((para, i) => <p key={i}>{para}</p>)}
            <PlantingsOf url={`/api/plantings?space_id=${s.id}`} title={t('plantings.inSpace')} empty={t('plantings.none')}
              addTo={`/plantings/new?place=${s.place_id}&space=${s.id}`} addLabel={t('plantings.addHere')} showPlant />
            <PhotoGallery ownerType="space" ownerId={s.id} />
          </>
        )}
      </LoadState>
      <p><Link to="/spaces">{t('spaces.back')}</Link></p>
    </article>
  );
}
