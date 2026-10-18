import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Field, TextInput, TextArea, Select, Checkbox } from '../../components/Field.jsx';
import { ConflictDialog } from '../../components/ConflictDialog.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { useRecordForm } from '../../lib/useRecordForm.js';
import { api, ApiError } from '../../lib/api.js';
import { keepOrConvert, toDisplay, unitLabel, UnitError } from '../../lib/units.js';
import { byStatus } from '../../lib/places.js';
import { KIND_FIELDS, SPACE_KINDS, SUN } from '../../lib/spaces.js';
import { useT } from '../../i18n/I18nProvider.jsx';

// Sizes are edited as text in the chosen units; `start` keeps the text and metric value they opened
// with, so a size nobody touched goes back exactly as it was stored.
const SIZES = { length_m: 'length', width_m: 'length', pot_liters: 'volume' };

const pickWith = (units, placeId) => s => ({
  place_id: String(s?.place_id ?? placeId ?? ''),
  name: s?.name ?? '',
  kind: s?.kind ?? 'bed',
  length_m: toDisplay('length', s?.length_m ?? null, units),
  width_m: toDisplay('length', s?.width_m ?? null, units),
  pot_liters: toDisplay('volume', s?.pot_liters ?? null, units),
  tray_count: s?.tray_count == null ? '' : String(s.tray_count),
  heated: s ? s.heated === 1 : false,
  sun: s?.sun ?? '',
  notes: s?.notes ?? '',
});

export function SpaceFormRoute() {
  const { id } = useParams();
  return <SpaceFormLoader key={id ?? 'new'} id={id} />;
}

function SpaceFormLoader({ id }) {
  const { t, ready: languageReady } = useT();
  const { settings, error: settingsError, reload: reloadSettings } = useSettings();
  const [params] = useSearchParams();
  const space = useResource(id ? `/api/spaces/${id}` : null);
  const places = useResource('/api/places');
  const ready = (!id || space.data) && places.data && settings && languageReady;
  const error = space.error ?? places.error ?? settingsError;
  const [created, setCreated] = useState(false);
  return (
    <>
      <PageHeader title={id || created ? t('spaces.edit') : t('spaces.new')} />
      <LoadState loading={!ready} error={ready ? null : error} onRetry={() => { if (id) space.reload(); places.reload(); if (settingsError) reloadSettings(); }}>
        {ready && <SpaceForm record={id ? space.data : null} places={byStatus(places.data)} units={settings.units}
          presetPlace={params.get('place')} onCreated={setCreated} />}
      </LoadState>
      {!ready && error && <p><Link to="/spaces">{t('spaces.back')}</Link></p>}
    </>
  );
}

function SpaceForm({ record, places, units, presetPlace, onCreated }) {
  const { t } = useT();
  const navigate = useNavigate();
  const fallbackPlace = places.find(p => String(p.id) === presetPlace)?.id ?? places.find(p => p.status === 'current')?.id ?? places[0]?.id;
  const [pick] = useState(() => pickWith(units, fallbackPlace));
  const [initial] = useState(() => pick(record));
  const [start, setStart] = useState(() => ({ text: initial, row: record }));
  const [target, setTarget] = useState(record ? { id: record.id, version: record.version } : null);

  const submit = useCallback(async (v, { version: forced }) => {
    const keep = KIND_FIELDS[v.kind];
    const body = { place_id: Number(v.place_id), name: v.name, kind: v.kind, sun: v.sun || null, notes: v.notes, heated: v.heated };
    const bad = {};
    for (const [field, kind] of Object.entries(SIZES)) {
      if (!keep.includes(field)) continue;
      try { body[field] = keepOrConvert(kind, v[field], start.text[field], start.row?.[field] ?? null, units); } catch (err) {
        if (!(err instanceof UnitError)) throw err;
        bad[field] = { code: 'not_size' };
      }
    }
    if (keep.includes('tray_count')) {
      const n = v.tray_count.trim();
      if (n && !/^\d+$/.test(n)) bad.tray_count = { code: 'not_whole' };
      else body.tray_count = n ? Number(n) : null;
    }
    if (Object.keys(bad).length) throw new ApiError('Please fix the highlighted fields.', 400, Object.fromEntries(Object.keys(bad).map(k => [k, ''])), null, { detailCodes: bad });
    const out = target
      ? await api.patch(`/api/spaces/${target.id}`, { ...body, version: forced ?? target.version })
      : await api.post('/api/spaces', body);
    if (!target) onCreated(true);
    setTarget({ id: out.id, version: out.version });
    setStart({ text: pick(out), row: out });
    return out;
  }, [target, onCreated, start, units, pick]);
  const f = useRecordForm({ initial, submit });
  const v = f.values;
  const show = KIND_FIELDS[v.kind];

  const done = out => { if (out && !f.isDirtyNow()) navigate(`/spaces/${out.id}`); };
  const save = async e => done(await f.onSubmit(e));
  const keep = async () => done(await f.keepMine());
  const takeTheirs = () => {
    setTarget(s => ({ ...s, version: f.conflict.version }));
    setStart({ text: pick(f.conflict), row: f.conflict });
    f.takeTheirs(pick);
  };
  const cancel = () => navigate(target ? `/spaces/${target.id}` : '/spaces');
  const canSave = Boolean(v.name.trim()) && Boolean(v.place_id) && (!record || f.dirty);
  const len = unitLabel('length', units);

  return (
    <>
      <form className="entry-form" onSubmit={save}>
        <fieldset disabled={f.saving}>
          <Field label={t('spaces.place')} error={f.errors.place_id}>
            <Select value={v.place_id} onChange={e => f.set('place_id', e.target.value)} options={places.map(p => ({ value: String(p.id), label: p.name }))} />
          </Field>
          <Field label={t('spaces.name')} error={f.errors.name}>
            <TextInput value={v.name} onChange={e => f.set('name', e.target.value)} maxLength={80} />
          </Field>
          <Field label={t('spaces.kindLabel')} error={f.errors.kind}>
            <Select value={v.kind} onChange={e => f.set('kind', e.target.value)} options={SPACE_KINDS.map(k => ({ value: k, label: t(`spaces.kind.${k}`) }))} />
          </Field>
          {show.includes('length_m') && (
            <div className="field-pair">
              <Field label={t('spaces.length', { unit: len })} error={f.errors.length_m}>
                <TextInput inputMode="decimal" value={v.length_m} onChange={e => f.set('length_m', e.target.value)} maxLength={10} />
              </Field>
              <Field label={t('spaces.width', { unit: len })} error={f.errors.width_m}>
                <TextInput inputMode="decimal" value={v.width_m} onChange={e => f.set('width_m', e.target.value)} maxLength={10} />
              </Field>
            </div>
          )}
          {show.includes('pot_liters') && (
            <Field label={t('spaces.pot', { unit: unitLabel('volume', units) })} error={f.errors.pot_liters}>
              <TextInput inputMode="decimal" value={v.pot_liters} onChange={e => f.set('pot_liters', e.target.value)} maxLength={10} />
            </Field>
          )}
          {show.includes('tray_count') && (
            <Field label={t('spaces.trayCount')} error={f.errors.tray_count}>
              <TextInput inputMode="numeric" value={v.tray_count} onChange={e => f.set('tray_count', e.target.value)} maxLength={4} />
            </Field>
          )}
          {show.includes('heated') && <Checkbox label={t('spaces.heated')} checked={v.heated} onChange={e => f.set('heated', e.target.checked)} />}
          <Field label={t('spaces.sun')} error={f.errors.sun}>
            <Select value={v.sun} onChange={e => f.set('sun', e.target.value)} placeholder={t('spaces.sunUnknown')}
              options={SUN.map(s => ({ value: s, label: t(`spaces.sun.${s}`) }))} />
          </Field>
          <Field label={t('spaces.notes')} error={f.errors.notes}>
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
