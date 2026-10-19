import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Select } from '../../components/Field.jsx';
import { PhotoGallery } from '../../components/PhotoGallery.jsx';
import { useConfirm } from '../../components/ConfirmProvider.jsx';
import { useToast } from '../../components/ToastProvider.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { useToday } from '../../lib/useToday.js';
import { api } from '../../lib/api.js';
import { errorText } from '../../lib/errors.js';
import { starterText } from '../../lib/starter.js';
import { bearingText, dayText, STATUSES, taskTitle } from '../../lib/tasks.js';
import { useT } from '../../i18n/I18nProvider.jsx';
import { TaskDialog } from './TaskDialog.jsx';
import { LogDialog } from './LogDialog.jsx';
import { MoveDialog } from './MoveDialog.jsx';
import { HarvestDialog } from '../harvests/HarvestDialog.jsx';
import { HarvestLine, useSendAgain } from '../harvests/Harvests.jsx';

export function PlantingPageRoute() {
  const { id } = useParams();
  return <PlantingPage key={id} id={id} />;
}

// What a guide asks for, loaded only when the owner opens it.
function GuideSupplies({ guideId }) {
  const { t, tc } = useT();
  const guide = useResource(`/api/guides/${guideId}`);
  if (!guide.data) return <p className="muted small">{guide.error ? errorText(guide.error, t) : t('common.loading')}</p>;
  if (!guide.data.supplies.length) return <p className="muted small">{t('tasks.noSupplies')}</p>;
  return (
    <ul className="supplies">
      {guide.data.supplies.map((s, i) => (
        <li key={i}>{starterText(tc, guide.data, `supply.${i + 1}.name`, s.name)}
          {s.amount && <span className="muted">: {starterText(tc, guide.data, `supply.${i + 1}.amount`, s.amount)}</span>}</li>
      ))}
    </ul>
  );
}

export function TaskLine({ task, today, onToggle, onEdit, onDelete, showPlant }) {
  const { t, tc, language } = useT();
  const [open, setOpen] = useState(false);
  // The tick shows at once; the saved task replaces it when the reload comes back.
  const [pending, setPending] = useState(null);
  const title = taskTitle(task, t);
  const toggle = async checked => {
    setPending(checked);
    try { await onToggle(task, checked); } finally { setPending(null); }
  };
  const day = iso => dayText(iso, language, today);
  const overdue = !task.done_on && (task.end_on ?? task.due_on) < today;
  return (
    <li className={`task${task.done_on ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}`}>
      <label className="task-check">
        <input type="checkbox" checked={pending ?? Boolean(task.done_on)} disabled={pending !== null} onChange={e => toggle(e.target.checked)} />
        <span>{title}{showPlant && task.plant ? <> · <Link to={`/plantings/${task.planting_id}`}>{starterText(tc, task.plant, 'name', task.plant.name)}{task.variety_name ? ` (${task.variety_name})` : ''}</Link></> : null}</span>
      </label>
      <span className="muted task-when">{task.end_on ? t('plants.range', { from: day(task.due_on), to: day(task.end_on) }) : day(task.due_on)}
        {task.done_on && <> · {t('tasks.doneOn', { day: day(task.done_on) })}</>}</span>
      {task.guide && <Link className="task-guide" to={`/library/guides/${task.guide.id}`}>{starterText(tc, task.guide, 'title', task.guide.title)}</Link>}
      {task.guide && <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(o => !o)}>{t('tasks.supplies')}</Button>}
      {onEdit && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('tasks.editOne', { name: title })} onClick={() => onEdit(task)} />}
      {onDelete && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('tasks.deleteOne', { name: title })} onClick={() => onDelete(task)} />}
      {task.notes && <p className="muted small task-notes">{task.notes}</p>}
      {open && task.guide && <GuideSupplies guideId={task.guide.id} />}
    </li>
  );
}

// Marks a task done (with the place's own today) or not done, then reloads what shows it.
export function useToggleTask(reload) {
  const { t } = useT();
  const toast = useToast();
  return async (task, done, today) => {
    try { await api.patch(`/api/tasks/${task.id}`, { version: task.version, done_on: done ? today : null }); } catch (err) {
      toast.show({ message: errorText(err, t) });
    }
    await reload();
  };
}

function PlantingPage({ id }) {
  const { t, tc, language } = useT();
  const { settings } = useSettings();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const planting = useResource(`/api/plantings/${id}`);
  const places = useResource('/api/places');
  const [task, setTask] = useState(null);
  const [entry, setEntry] = useState(null);
  const [moving, setMoving] = useState(false);
  const [harvest, setHarvest] = useState(null);
  const harvests = useResource(`/api/harvests?planting_id=${id}`);
  const sendAgain = useSendAgain(harvests.reload);
  const removeHarvest = async h => {
    try { await harvests.act(() => api.del(`/api/harvests/${h.id}`)); toast.show({ message: t('harvests.deleted') }); } catch (err) { toast.show({ message: errorText(err, t) }); }
  };
  const p = planting.data;
  const place = p ? places.data?.find(x => x.id === p.space.place_id) : null;
  const today = useToday(place?.time_zone || settings?.time_zone);
  const toggle = useToggleTask(planting.reload);
  const name = p ? starterText(tc, p.plant, 'name', p.plant.name) : '';

  const remove = async () => {
    if (!await confirm({ title: t('plantings.deleteTitle', { name }), body: t('plantings.deleteBody'), confirmLabel: t('common.delete'), danger: true })) return;
    try { await api.del(`/api/plantings/${p.id}`); } catch (err) { toast.show({ message: errorText(err, t) }); planting.reload(); return; }
    navigate('/plantings');
    toast.show({ message: t('plantings.deleted', { name }), duration: 8000,
      action: { label: t('common.undo'), onClick: async () => {
        try { await api.post(`/api/plantings/${p.id}/restore`); navigate(`/plantings/${p.id}`); } catch (err) { toast.show({ message: errorText(err, t) }); }
      } } });
  };
  const setStatus = async status => {
    try { await planting.save({ version: p.version, status }, { to: `/api/plantings/${p.id}` }); } catch (err) { toast.show({ message: errorText(err, t) }); planting.reload(); }
  };
  const removeTask = async x => {
    try { await planting.act(() => api.del(`/api/tasks/${x.id}`)); toast.show({ message: t('tasks.deleted', { name: taskTitle(x, t) }) }); }
    catch (err) { toast.show({ message: errorText(err, t) }); }
  };
  const removeEntry = async x => {
    try { await planting.act(() => api.del(`/api/log/${x.id}`)); toast.show({ message: t('log.deleted') }); }
    catch (err) { toast.show({ message: errorText(err, t) }); }
  };

  return (
    <article className="entry planting">
      <LoadState loading={planting.loading && !p} error={planting.error} keepChildren={Boolean(p)} onRetry={planting.reload}>
        {p && (
          <>
            <PageHeader title={p.variety ? `${name} (${p.variety.name})` : name}>
              <Button as={Link} variant="ghost" icon={Pencil} to={`/plantings/${p.id}/edit`}>{t('common.edit')}</Button>
              {p.in_container ? <Button variant="ghost" onClick={() => setMoving(true)}>{t('plantings.move')}</Button> : null}
              <Button variant="ghost" icon={Trash2} onClick={remove}>{t('common.delete')}</Button>
            </PageHeader>
            <p className="entry-meta">
              <Link to={`/spaces/${p.space.id}`}>{p.space.name}</Link>
              {place && <span>{place.name}</span>}
              <span>{t(`plantings.how.${p.how_started}`)}</span>
              {p.in_container ? <span className="tag">{t('foodForest.pot')}</span> : null}
              {p.count != null && <span>{t('plantings.countShort', { n: p.count })}</span>}
              <Link to={`/library/plants/${p.plant.id}`}>{t('plantings.aboutPlant')}</Link>
            </p>
            <label className="inline-field">{t('plantings.status')}{' '}
              <Select aria-label={t('plantings.status')} value={p.status} onChange={e => setStatus(e.target.value)}
                options={STATUSES.map(s => ({ value: s, label: t(`plantings.statusName.${s}`) }))} />
            </label>
            {p.bears_on && <p className="lead">{bearingText(p.bears_on, today, t, language)}</p>}
            {(p.bought_from || p.bought_on || p.price != null || p.size_when_bought) && (
              <section aria-labelledby="purchase-title">
                <h2 id="purchase-title">{t('plantings.purchase')}</h2>
                <dl className="entry-facts">
                  {p.bought_from && <div className="fact-row"><dt>{t('plantings.boughtFrom')}</dt><dd>{p.bought_from}</dd></div>}
                  {p.bought_on && <div className="fact-row"><dt>{t('plantings.boughtOn')}</dt><dd>{dayText(p.bought_on, language, today)}</dd></div>}
                  {p.price != null && <div className="fact-row"><dt>{t('plantings.price')}</dt><dd>{p.price.toLocaleString(language, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</dd></div>}
                  {p.size_when_bought && <div className="fact-row"><dt>{t('plantings.sizeWhenBought')}</dt><dd>{p.size_when_bought}</dd></div>}
                </dl>
              </section>
            )}
            {p.notes && p.notes.split(/\n\s*\n/).map((x, i) => <p key={i}>{x}</p>)}
            <section aria-labelledby="tasks-title">
              <h2 id="tasks-title">{t('tasks.title')}</h2>
              {p.tasks.length === 0 && <p className="muted">{t('tasks.none')}</p>}
              <ul className="list tasks">
                {p.tasks.map(x => <TaskLine key={x.id} task={x} today={today} onToggle={(tk, done) => toggle(tk, done, today)} onEdit={setTask} onDelete={removeTask} />)}
              </ul>
              <Button variant="ghost" icon={Plus} onClick={() => setTask({})}>{t('tasks.add')}</Button>
            </section>
            <section aria-labelledby="harvests-title">
              <h2 id="harvests-title">{t('nav.harvests')}</h2>
              {harvests.data?.length === 0 && <p className="muted">{t('harvests.noneHere')}</p>}
              <ul className="list">
                {harvests.data?.map(h => <HarvestLine key={h.id} h={h} today={today} showCrop={false} onEdit={setHarvest} onDelete={removeHarvest} onSend={sendAgain} />)}
              </ul>
              <Button variant="ghost" icon={Plus} onClick={() => setHarvest({})}>{t('harvests.add')}</Button>
            </section>
            <section aria-labelledby="log-title">
              <h2 id="log-title">{t('log.title')}</h2>
              {p.log.length === 0 && <p className="muted">{t('log.none')}</p>}
              <ul className="list log">
                {p.log.map(x => (
                  <li key={x.id}>
                    <span className="grow"><strong>{x.kind === 'note' && !x.note && x.task_kind ? t(`tasks.kind.${x.task_kind}`) : t(`log.kind.${x.kind}`)}</strong> <span className="muted">{dayText(x.on_date, language, today)}</span>
                      {x.note && <><br /><span>{x.note}</span></>}</span>
                    <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('log.editOne', { day: dayText(x.on_date, language, today) })} onClick={() => setEntry(x)} />
                    <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('log.deleteOne', { day: dayText(x.on_date, language, today) })} onClick={() => removeEntry(x)} />
                  </li>
                ))}
              </ul>
              <Button variant="ghost" icon={Plus} onClick={() => setEntry({})}>{t('log.add')}</Button>
            </section>
            <PhotoGallery ownerType="planting" ownerId={p.id} />
            {task && <TaskDialog plantingId={p.id} record={task.id ? task : null} today={today}
              onClose={() => setTask(null)} onSaved={() => { setTask(null); planting.reload(); }} />}
            {moving && <MoveDialog planting={p} today={today} onClose={() => { setMoving(false); planting.reload(); }}
              onMove={body => planting.save({ version: p.version, ...body }, { method: 'post', to: `/api/plantings/${p.id}/move` })}
              onMoved={out => { setMoving(false); toast.show({ message: t('plantings.moved', { space: out.space.name }) }); }} />}
            {harvest && <HarvestDialog source={{ planting_id: p.id }} record={harvest.id ? harvest : null} today={today}
              onClose={() => setHarvest(null)} onSaved={() => { setHarvest(null); harvests.reload(); planting.reload(); }} />}
            {entry && <LogDialog plantingId={p.id} record={entry.id ? entry : null} today={today}
              onClose={() => setEntry(null)} onSaved={() => { setEntry(null); planting.reload(); }} />}
          </>
        )}
      </LoadState>
      <p><Link to="/plantings">{t('plantings.back')}</Link></p>
    </article>
  );
}
