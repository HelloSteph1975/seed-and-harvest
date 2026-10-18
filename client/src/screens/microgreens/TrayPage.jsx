import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { PhotoGallery } from '../../components/PhotoGallery.jsx';
import { useConfirm } from '../../components/ConfirmProvider.jsx';
import { useToast } from '../../components/ToastProvider.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { useToday } from '../../lib/useToday.js';
import { api } from '../../lib/api.js';
import { errorText } from '../../lib/errors.js';
import { starterText } from '../../lib/starter.js';
import { addDays, dayText } from '../../lib/tasks.js';
import { toDisplay, unitLabel } from '../../lib/units.js';
import { safetyNote } from '../../lib/safety.js';
import { useT } from '../../i18n/I18nProvider.jsx';

export function TrayPageRoute() {
  const { id } = useParams();
  return <TrayPage key={id} id={id} />;
}

// Who a tray is for, with its warning when the crop isn't plainly safe for that animal.
export function ForWhom({ tray }) {
  const { t } = useT();
  if (!tray.animal) return <span>{t('trays.people')}</span>;
  const note = safetyNote(tray.safety, tray.animal, t);
  return (
    <>
      <span>{tray.animal.name}{tray.animal.deleted ? ` ${t('trays.inTrash')}` : ''}</span>
      {note && <span className={`tag safety-tag safety-${note.level}`} title={note.text}>{t(`trays.tag.${note.level}`)}</span>}
    </>
  );
}

function TrayPage({ id }) {
  const { t, tc, language } = useT();
  const { settings } = useSettings();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const tray = useResource(`/api/trays/${id}`);
  const places = useResource('/api/places');
  const x = tray.data;
  const plant = useResource(x ? `/api/plants/${x.plant_id}` : null).data;
  const place = x ? places.data?.find(p => p.id === x.space.place_id) : null;
  const today = useToday(place?.time_zone || settings?.time_zone);
  const units = settings?.units ?? 'us';
  const name = x ? starterText(tc, x.plant, 'name', x.plant.name) : '';
  const day = iso => dayText(iso, language, today);
  const guide = plant?.guides.find(g => g.stage === 'microgreens');
  const note = x ? safetyNote(x.safety, x.animal, t) : null;

  // One request at a time: a double click must not sow two trays or cut one twice.
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const once = async fn => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    // A sowing that worked moves to the new tray, so the guard stays on until this page is gone.
    let leaving = false;
    try { leaving = await fn() === 'leaving'; } finally { if (!leaving) { inFlight.current = false; setBusy(false); } }
  };
  const change = body => once(async () => {
    try { await tray.save({ version: x.version, ...body }, { to: `/api/trays/${x.id}` }); } catch (err) { toast.show({ message: errorText(err, t) }); tray.reload(); }
  });
  const sowAgain = () => once(async () => {
    try {
      const out = await api.post(`/api/trays/${x.id}/sow-again`, { sown_on: today });
      navigate(`/microgreens/trays/${out.id}`);
      return 'leaving';
    } catch (err) { toast.show({ message: errorText(err, t) }); return null; }
  });
  const remove = async () => {
    if (!await confirm({ title: t('trays.deleteTitle', { name }), body: t('trays.deleteBody'), confirmLabel: t('common.delete'), danger: true })) return;
    try { await api.del(`/api/trays/${x.id}`); } catch (err) { toast.show({ message: errorText(err, t) }); tray.reload(); return; }
    navigate('/microgreens');
    toast.show({ message: t('trays.deleted', { name }), duration: 8000,
      action: { label: t('common.undo'), onClick: async () => {
        try { await api.post(`/api/trays/${x.id}/restore`); navigate(`/microgreens/trays/${x.id}`); } catch (err) { toast.show({ message: errorText(err, t) }); }
      } } });
  };

  return (
    <article className="entry tray">
      <LoadState loading={tray.loading && !x} error={tray.error} keepChildren={Boolean(x)} onRetry={tray.reload}>
        {x && (
          <>
            <PageHeader title={name}>
              <Button as={Link} variant="ghost" icon={Pencil} to={`/microgreens/trays/${x.id}/edit`}>{t('common.edit')}</Button>
              <Button variant="ghost" icon={Trash2} onClick={remove}>{t('common.delete')}</Button>
            </PageHeader>
            <p className="entry-meta">
              <Link to={`/spaces/${x.space.id}`}>{x.space.name}</Link>
              <span className="tag">{t(`trays.status.${x.status}`)}</span>
              <Link to={`/library/plants/${x.plant_id}`}>{t('plantings.aboutPlant')}</Link>
              {guide && <Link to={`/library/guides/${guide.id}`}>{starterText(tc, guide, 'title', guide.title)}</Link>}
            </p>
            <dl className="entry-facts">
              <div className="fact-row"><dt>{t('trays.sown')}</dt><dd>{day(x.sown_on)}</dd></div>
              <div className="fact-row"><dt>{t('trays.harvestOn')}</dt><dd>{day(x.harvest_on)}</dd></div>
              {x.harvested_on && <div className="fact-row"><dt>{t('trays.harvestedOn')}</dt><dd>{day(x.harvested_on)}</dd></div>}
              <div className="fact-row"><dt>{t('trays.count')}</dt><dd>{x.tray_count}</dd></div>
              {x.seed_g != null && <div className="fact-row"><dt>{t('trays.seedShort')}</dt><dd>{toDisplay('seed', x.seed_g, units)} {unitLabel('seed', units)}</dd></div>}
              <div className="fact-row"><dt>{t('trays.for')}</dt><dd><ForWhom tray={x} /></dd></div>
              {x.repeat_days && <div className="fact-row"><dt>{t('trays.repeat')}</dt><dd>{t('trays.every', { n: x.repeat_days })}{x.next_sow_on ? ` · ${t('trays.nextSow', { day: day(x.next_sow_on) })}` : ''}</dd></div>}
            </dl>
            {note && <p className={`note safety-${note.level}`}>{note.text}</p>}
            {x.notes && <p>{x.notes}</p>}
            <div className="button-row" aria-busy={busy}>
              {x.status === 'planned' && <Button disabled={busy} onClick={() => change({ status: 'growing', sown_on: today, harvest_on: addDays(today, x.plant.days_min ?? 7) })}>{t('trays.sownToday')}</Button>}
              {x.status === 'growing' && <Button disabled={busy} onClick={() => change({ status: 'harvested', harvested_on: today })}>{t('trays.harvestedToday')}</Button>}
              {x.status === 'growing' && <Button variant="ghost" disabled={busy} onClick={() => change({ status: 'discarded' })}>{t('trays.discard')}</Button>}
              <Button variant="ghost" disabled={busy} onClick={sowAgain}>{t('trays.sowAgain')}</Button>
              {x.next_sow_on && <Button variant="ghost" disabled={busy} onClick={() => change({ repeat_days: null })}>{t('trays.stopRepeat')}</Button>}
            </div>
            <PhotoGallery ownerType="tray" ownerId={x.id} />
          </>
        )}
      </LoadState>
      <p><Link to="/microgreens">{t('trays.back')}</Link></p>
    </article>
  );
}
