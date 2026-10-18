import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Field, TextInput, TextArea, Select, Checkbox } from '../../components/Field.jsx';
import { ToggleGroup } from '../../components/ToggleGroup.jsx';
import { ConflictDialog } from '../../components/ConflictDialog.jsx';
import { useResource } from '../../lib/useResource.js';
import { useRecordForm } from '../../lib/useRecordForm.js';
import { api } from '../../lib/api.js';
import { monthName, needsFrostDates } from '../../lib/places.js';
import { useT } from '../../i18n/I18nProvider.jsx';
import { ClimateLookup } from './ClimateLookup.jsx';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// The form's values from a stored place (or a blank one).
const pick = p => ({
  name: p?.name ?? '',
  status: p?.status ?? '',
  location: p?.location ?? '',
  latitude: p?.latitude ?? null,
  longitude: p?.longitude ?? null,
  time_zone: p?.time_zone ?? '',
  hemisphere: p?.hemisphere ?? 'north',
  zone: p?.zone ?? '',
  last_frost: p?.last_frost ?? '',
  first_frost: p?.first_frost ?? '',
  frost_free: p ? p.frost_free === 1 : false,
  wet_months: p?.wet_months ?? [],
  notes: p?.notes ?? '',
});

// A blank status lets the server choose (current for the first place, otherwise later).
const toBody = v => {
  const { status, ...rest } = v;
  return status ? { ...rest, status } : rest;
};

export function PlaceFormRoute() {
  const { id } = useParams();
  return <PlaceFormLoader key={id ?? 'new'} id={id} />;
}

function PlaceFormLoader({ id }) {
  const { t, ready: languageReady } = useT();
  const place = useResource(id ? `/api/places/${id}` : null);
  const ready = (!id || place.data) && languageReady;
  const [created, setCreated] = useState(false);
  return (
    <>
      <PageHeader title={id || created ? t('places.edit') : t('places.new')} />
      <LoadState loading={!ready} error={ready ? null : place.error} onRetry={place.reload}>
        {ready && <PlaceForm record={id ? place.data : null} onCreated={setCreated} />}
      </LoadState>
      {!ready && place.error && <p><Link to="/places">{t('places.back')}</Link></p>}
    </>
  );
}

function PlaceForm({ record, onCreated }) {
  const { t, language } = useT();
  const navigate = useNavigate();
  const [initial] = useState(() => pick(record));
  const [target, setTarget] = useState(record ? { id: record.id, version: record.version } : null);
  const [estimated, setEstimated] = useState(false);
  const submit = useCallback(async (values, { version: forced }) => {
    const body = toBody(values);
    const out = target
      ? await api.patch(`/api/places/${target.id}`, { ...body, version: forced ?? target.version })
      : await api.post('/api/places', body);
    if (!target) onCreated(true);
    setTarget({ id: out.id, version: out.version });
    return out;
  }, [target, onCreated]);
  const f = useRecordForm({ initial, submit });
  const v = f.values;

  const done = out => { if (out && !f.isDirtyNow()) navigate(`/places/${out.id}`); };
  const save = async e => done(await f.onSubmit(e));
  const keep = async () => done(await f.keepMine());
  const takeTheirs = () => { setTarget(s => ({ ...s, version: f.conflict.version })); f.takeTheirs(pick); };
  const cancel = () => navigate(target ? `/places/${target.id}` : '/places');
  const canSave = Boolean(v.name.trim()) && (!record || f.dirty);

  const fill = est => {
    for (const k of ['location', 'latitude', 'longitude', 'hemisphere']) f.set(k, est[k]);
    f.set('time_zone', est.time_zone ?? '');
    f.set('zone', est.zone ?? '');
    f.set('frost_free', Boolean(est.frost_free));
    f.set('last_frost', est.last_frost ?? '');
    f.set('first_frost', est.first_frost ?? '');
    setEstimated(true);
  };

  return (
    <>
      <form className="entry-form" onSubmit={save}>
        <fieldset disabled={f.saving}>
          <Field label={t('places.name')} error={f.errors.name}>
            <TextInput value={v.name} onChange={e => f.set('name', e.target.value)} maxLength={80} />
          </Field>
          <Field label={t('places.status')} error={f.errors.status}>
            <Select value={v.status} onChange={e => f.set('status', e.target.value)} placeholder={record ? undefined : t('places.statusAuto')}
              options={['current', 'future', 'past'].map(s => ({ value: s, label: t(`places.statusOption.${s}`) }))} />
          </Field>
          <ClimateLookup onPick={fill} disabled={f.saving} />
          {estimated && <p className="note" role="status">{t('places.estimated')}</p>}
          <Field label={t('places.location')} error={f.errors.location}>
            <TextInput value={v.location} onChange={e => f.set('location', e.target.value)} maxLength={120} />
          </Field>
          {v.time_zone && <p className="muted">{t('places.timeZoneLine', { zone: v.time_zone })}</p>}
          <Field label={t('places.hemisphere')} error={f.errors.hemisphere}>
            <Select value={v.hemisphere} onChange={e => f.set('hemisphere', e.target.value)}
              options={['north', 'south'].map(h => ({ value: h, label: t(`places.hemisphere.${h}`) }))} />
          </Field>
          <Field label={t('places.zone')} error={f.errors.zone} hint={t('places.zoneHint')}>
            <TextInput value={v.zone} onChange={e => f.set('zone', e.target.value)} maxLength={3} />
          </Field>
          <Checkbox label={t('places.frostFree')} checked={v.frost_free} onChange={e => f.set('frost_free', e.target.checked)} />
          {v.frost_free ? (
            <ToggleGroup label={t('places.wetMonths')} value={v.wet_months} onChange={next => f.set('wet_months', next)}
              options={MONTHS.map(m => ({ value: m, label: monthName(m, language, 'short') }))} />
          ) : (
            <>
              <Field label={t('places.lastFrost')} error={f.errors.last_frost} hint={t('places.frostHint')}>
                <TextInput value={v.last_frost} onChange={e => f.set('last_frost', e.target.value)} maxLength={5} placeholder="03-20" />
              </Field>
              <Field label={t('places.firstFrost')} error={f.errors.first_frost} hint={t('places.frostHint')}>
                <TextInput value={v.first_frost} onChange={e => f.set('first_frost', e.target.value)} maxLength={5} placeholder="11-10" />
              </Field>
            </>
          )}
          {needsFrostDates(v) && <p className="note">{t('places.needFrost')}</p>}
          <Field label={t('places.notes')} error={f.errors.notes}>
            <TextArea value={v.notes} onChange={e => f.set('notes', e.target.value)} rows={4} maxLength={2000} />
          </Field>
        </fieldset>
        {f.formError && <p className="form-error" role="alert">{f.formError}</p>}
        <div className="form-actions">
          <Button variant="ghost" onClick={cancel}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={f.saving || !canSave}>{f.saving ? t('common.saving') : t('common.save')}</Button>
        </div>
      </form>
      <ConflictDialog conflict={f.conflict} onKeepMine={keep} onTakeTheirs={takeTheirs} onDismiss={f.dismissConflict} />
    </>
  );
}
