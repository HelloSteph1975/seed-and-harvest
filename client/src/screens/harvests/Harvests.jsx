import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Select } from '../../components/Field.jsx';
import { useToast } from '../../components/ToastProvider.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { useToday } from '../../lib/useToday.js';
import { api } from '../../lib/api.js';
import { errorText } from '../../lib/errors.js';
import { byStatus } from '../../lib/places.js';
import { starterText } from '../../lib/starter.js';
import { dayText } from '../../lib/tasks.js';
import { qtyText, splitText } from '../../lib/harvests.js';
import { useT } from '../../i18n/I18nProvider.jsx';
import { HarvestDialog } from './HarvestDialog.jsx';
import { Summary } from './Summary.jsx';

// The Hearth & Larder state of a harvest's larder part, with Send again when it didn't get there.
export function LarderTag({ harvest, onSend }) {
  const { t } = useT();
  if (!harvest.larder_qty || harvest.larder_state === 'off' || harvest.larder_state === 'removed') return null;
  const key = harvest.larder_state === 'sent' ? 'sent' : harvest.larder_state === 'pending' ? 'sending' : 'notSent';
  return (
    <>
      {' '}<span className={`tag larder-${key}`} title={harvest.larder_error ?? undefined}>{t(`harvests.larder.${key}`)}</span>
      {harvest.larder_state === 'failed' && onSend && <Button size="sm" variant="ghost" onClick={() => onSend(harvest)}>{t('harvests.sendAgain')}</Button>}
    </>
  );
}

// One harvest line: crop (with a link to where it grew), amount, date, split and larder state.
export function HarvestLine({ h, today, onEdit, onDelete, onSend, showCrop = true }) {
  const { t, tc, language } = useT();
  const { settings } = useSettings();
  const units = settings?.units ?? 'us';
  const to = h.source.kind === 'planting' ? `/plantings/${h.source.id}` : `/microgreens/trays/${h.source.id}`;
  const name = starterText(tc, h.crop, 'name', h.crop.name);
  const split = splitText(h, units, t);
  return (
    <li>
      <span className="grow">
        {showCrop && <><Link to={to}><strong>{name}</strong>{h.variety_name ? ` (${h.variety_name})` : ''}</Link> · </>}
        <span>{qtyText(h.quantity, h.unit, units, t)}</span> <span className="muted">{dayText(h.harvested_on, language, today)}</span>
        {split && <><br /><span className="muted">{split}</span></>}
        <LarderTag harvest={h} onSend={onSend} />
      </span>
      {onEdit && <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('harvests.editOne', { day: dayText(h.harvested_on, language, today) })} onClick={() => onEdit(h)} />}
      {onDelete && <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('harvests.deleteOne', { day: dayText(h.harvested_on, language, today) })} onClick={() => onDelete(h)} />}
    </li>
  );
}

// Send again, then reload whatever lists the harvest.
export function useSendAgain(reload) {
  const { t } = useT();
  const toast = useToast();
  return async h => {
    try { await api.post(`/api/harvests/${h.id}/send`); } catch (err) { toast.show({ message: errorText(err, t) }); }
    await reload();
  };
}

export function Harvests() {
  const { t } = useT();
  const { settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const places = useResource('/api/places');
  const list = places.data ? byStatus(places.data) : [];
  const placeParam = params.get('place');
  const place = placeParam === 'all' ? null : list.find(p => String(p.id) === placeParam) ?? list.find(p => p.status === 'current') ?? list[0] ?? null;
  const today = useToday(place?.time_zone || settings?.time_zone);
  const year = /^\d{4}$/.test(params.get('year') ?? '') ? params.get('year') : today.slice(0, 4);
  const tab = params.get('tab') === 'summary' ? 'summary' : 'list';
  const set = (k, v) => { const next = new URLSearchParams(params); next.set(k, v); setParams(next, { replace: true }); };
  const years = Array.from({ length: 6 }, (_, i) => String(Number(today.slice(0, 4)) - i));
  return (
    <>
      <PageHeader title={t('nav.harvests')} />
      <div className="tabs" role="tablist" aria-label={t('nav.harvests')}>
        {['list', 'summary'].map(k => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' is-active' : ''}`} onClick={() => set('tab', k)}>{t(`harvests.tab.${k}`)}</button>
        ))}
      </div>
      <div className="filters">
        <label className="inline-field">{t('spaces.place')}{' '}
          <Select aria-label={t('spaces.place')} value={place ? String(place.id) : 'all'} onChange={e => set('place', e.target.value)}
            options={[{ value: 'all', label: t('harvests.allPlaces') }, ...list.map(p => ({ value: String(p.id), label: p.name }))]} />
        </label>
        <label className="inline-field">{t('harvests.year')}{' '}
          <Select aria-label={t('harvests.year')} value={year} onChange={e => set('year', e.target.value)} options={years.map(y => ({ value: y, label: y }))} />
        </label>
      </div>
      <LoadState loading={places.loading && !places.data} error={places.error} keepChildren={Boolean(places.data)} onRetry={places.reload}>
        {places.data && (tab === 'summary' ? <Summary place={place} year={year} /> : <HarvestList place={place} year={year} today={today} />)}
      </LoadState>
    </>
  );
}

function HarvestList({ place, year, today }) {
  const { t } = useT();
  const toast = useToast();
  const harvests = useResource(`/api/harvests?year=${year}${place ? `&place_id=${place.id}` : ''}`);
  const [editing, setEditing] = useState(null);
  const send = useSendAgain(harvests.reload);
  const remove = async h => {
    try { await harvests.act(() => api.del(`/api/harvests/${h.id}`)); toast.show({ message: t('harvests.deleted') }); } catch (err) { toast.show({ message: errorText(err, t) }); }
  };
  return (
    <LoadState loading={harvests.loading && !harvests.data} error={harvests.error} keepChildren={Boolean(harvests.data)} onRetry={harvests.reload}>
      {harvests.data?.length === 0 && <p className="muted">{t('harvests.none', { year })}</p>}
      <ul className="list">
        {harvests.data?.map(h => <HarvestLine key={h.id} h={h} today={today} onEdit={setEditing} onDelete={remove} onSend={send} />)}
      </ul>
      {editing && <HarvestDialog record={editing} today={today} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); harvests.reload(); }} />}
    </LoadState>
  );
}
