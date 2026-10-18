import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Field, TextInput, TextArea, Select, DateInput } from '../../components/Field.jsx';
import { ConflictDialog } from '../../components/ConflictDialog.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { useRecordForm } from '../../lib/useRecordForm.js';
import { useToday } from '../../lib/useToday.js';
import { todayIn } from '../../lib/frost.js';
import { api, ApiError } from '../../lib/api.js';
import { byStatus } from '../../lib/places.js';
import { starterText } from '../../lib/starter.js';
import { addDays } from '../../lib/tasks.js';
import { keepOrConvert, toDisplay, unitLabel, UnitError } from '../../lib/units.js';
import { ratingFor, safetyNote } from '../../lib/safety.js';
import { useT } from '../../i18n/I18nProvider.jsx';

const ACTIVE = ['planned', 'growing'];

const pickWith = (units, defaults) => x => ({
  place_id: String(x?.space?.place_id ?? defaults.place ?? ''),
  space_id: String(x?.space_id ?? defaults.space ?? ''),
  plant_id: String(x?.plant_id ?? defaults.plant ?? ''),
  animal_id: x?.animal_id ? String(x.animal_id) : '',
  tray_count: String(x?.tray_count ?? 1),
  sown_on: x?.sown_on ?? defaults.today,
  harvest_on: x?.harvest_on ?? '',
  seed: toDisplay('seed', x?.seed_g ?? null, units),
  repeat_days: x?.repeat_days == null ? '' : String(x.repeat_days),
  notes: x?.notes ?? '',
});

export function TrayFormRoute() {
  const { id } = useParams();
  return <TrayFormLoader key={id ?? 'new'} id={id} />;
}

function TrayFormLoader({ id }) {
  const { t, ready: languageReady } = useT();
  const { settings, error: settingsError, reload: reloadSettings } = useSettings();
  const [params] = useSearchParams();
  const tray = useResource(id ? `/api/trays/${id}` : null);
  const places = useResource('/api/places');
  const plants = useResource('/api/plants?kind=microgreen');
  const animals = useResource('/api/animals');
  const ready = (!id || tray.data) && places.data && plants.data && animals.data && settings && languageReady;
  const error = tray.error ?? places.error ?? plants.error ?? animals.error ?? settingsError;
  return (
    <>
      <PageHeader title={id ? t('trays.edit') : t('trays.new')} />
      <LoadState loading={!ready} error={ready ? null : error}
        onRetry={() => { if (id) tray.reload(); places.reload(); plants.reload(); animals.reload(); if (settingsError) reloadSettings(); }}>
        {ready && <TrayForm record={id ? tray.data : null} places={byStatus(places.data)} plants={plants.data.filter(p => p.kind === 'microgreen')}
          animals={animals.data} settings={settings} defaults={{ plant: params.get('plant'), space: params.get('space'), place: params.get('place') }} />}
      </LoadState>
      {!ready && error && <p><Link to="/microgreens">{t('trays.back')}</Link></p>}
    </>
  );
}

function TrayForm({ record, places, plants, animals, settings, defaults }) {
  const { t, tc, language } = useT();
  const navigate = useNavigate();
  const units = settings.units;
  const fallbackPlace = places.find(p => String(p.id) === defaults.place)?.id ?? places.find(p => p.status === 'current')?.id ?? places[0]?.id;
  const firstPlace = places.find(p => p.id === fallbackPlace);
  const todayAtStart = useToday(firstPlace?.time_zone || settings.time_zone);
  const [pick] = useState(() => pickWith(units, { ...defaults, place: fallbackPlace, today: todayAtStart }));
  const [initial] = useState(() => pick(record));
  const [start, setStart] = useState(() => ({ text: initial, row: record }));
  const [target, setTarget] = useState(record ? { id: record.id, version: record.version } : null);
  // Dates and seed fill in from the crop until the owner changes them by hand.
  const touched = useRef({ harvest_on: Boolean(record), seed: Boolean(record) });


  const submit = useCallback(async (v, { version: forced }) => {
    const bad = {};
    const whole = (k, s, min, max) => {
      const n = s.trim();
      if (!n) return null;
      if (!/^\d+$/.test(n) || Number(n) < min || Number(n) > max) { bad[k] = { code: 'not_whole' }; return undefined; }
      return Number(n);
    };
    const body = {
      space_id: Number(v.space_id), plant_id: Number(v.plant_id), animal_id: v.animal_id ? Number(v.animal_id) : null,
      tray_count: whole('tray_count', v.tray_count, 1, 1000) ?? 1, sown_on: v.sown_on, harvest_on: v.harvest_on || null,
      repeat_days: whole('repeat_days', v.repeat_days, 1, 60), notes: v.notes,
    };
    try { body.seed_g = keepOrConvert('seed', v.seed, start.text.seed, start.row?.seed_g ?? null, units); } catch (err) {
      if (!(err instanceof UnitError)) throw err;
      bad.seed = { code: 'not_size' };
    }
    if (Object.keys(bad).length) throw new ApiError('Please fix the highlighted fields.', 400, Object.fromEntries(Object.keys(bad).map(k => [k, ''])), null, { detailCodes: bad });
    // Planned or growing follows the sown date against the chosen place's own today. A tray that is
    // already cut or thrown out (as last saved or taken from a conflict) keeps its status.
    const chosen = places.find(p => String(p.id) === v.place_id);
    const placeToday = todayIn(chosen?.time_zone || settings.time_zone);
    if (!start.row || ACTIVE.includes(start.row.status)) body.status = v.sown_on > placeToday ? 'planned' : 'growing';
    const out = target
      ? await api.patch(`/api/trays/${target.id}`, { ...body, version: forced ?? target.version })
      : await api.post('/api/trays', body);
    setTarget({ id: out.id, version: out.version });
    setStart({ text: pick(out), row: out });
    return out;
  }, [target, start, units, pick, places, settings.time_zone]);
  const f = useRecordForm({ initial, submit });
  const v = f.values;

  const spaces = useResource(v.place_id ? `/api/spaces?place_id=${v.place_id}` : null);
  const plant = useResource(v.plant_id ? `/api/plants/${v.plant_id}` : null).data;
  const onRack = useResource(v.space_id ? `/api/trays?space_id=${v.space_id}` : null).data;
  const racksFirst = [...(spaces.data ?? [])].sort((a, b) => (b.kind === 'microgreen_rack') - (a.kind === 'microgreen_rack'));
  const spaceShown = racksFirst.some(s => String(s.id) === v.space_id);
  const rack = racksFirst.find(s => String(s.id) === v.space_id);
  // A tray's animal in the Trash stays chosen and labelled, so its warning still shows.
  const trashed = record?.animal?.deleted ? record.animal : null;
  const animal = animals.find(a => String(a.id) === v.animal_id) ?? (trashed && String(trashed.id) === v.animal_id ? trashed : null);
  const note = plant && animal ? safetyNote(ratingFor(plant, animal), animal, t) : null;

  useEffect(() => {
    if (spaces.data && !spaceShown) f.set('space_id', racksFirst[0] ? String(racksFirst[0].id) : '');
  }, [spaces.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!plant) return;
    if (!touched.current.harvest_on && /^\d{4}-\d{2}-\d{2}$/.test(v.sown_on)) f.set('harvest_on', addDays(v.sown_on, plant.days_min ?? 7));
  }, [plant, v.sown_on]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!plant || touched.current.seed || plant.seed_g_per_tray == null) return;
    const n = /^\d+$/.test(v.tray_count.trim()) ? Number(v.tray_count) : 1;
    f.set('seed', toDisplay('seed', n * plant.seed_g_per_tray, units));
  }, [plant, v.tray_count]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = /^\d+$/.test(v.tray_count.trim()) ? Number(v.tray_count) : 1;
  const already = (onRack ?? []).filter(x => ACTIVE.includes(x.status) && x.id !== record?.id).reduce((n, x) => n + x.tray_count, 0);
  const full = rack?.tray_count != null && onRack && already + count > rack.tray_count;

  const done = out => { if (out && !f.isDirtyNow()) navigate(`/microgreens/trays/${out.id}`); };
  const save = async e => done(await f.onSubmit(e));
  const keep = async () => done(await f.keepMine());
  const takeTheirs = () => { setTarget(s => ({ ...s, version: f.conflict.version })); setStart({ text: pick(f.conflict), row: f.conflict }); f.takeTheirs(pick); };
  const cancel = () => navigate(target ? `/microgreens/trays/${target.id}` : '/microgreens');
  const canSave = spaceShown && Boolean(v.plant_id && v.sown_on) && (!record || f.dirty);
  const plantName = p => starterText(tc, p, 'name', p.name);

  return (
    <>
      <form className="entry-form" onSubmit={save}>
        <fieldset disabled={f.saving}>
          <Field label={t('spaces.place')}>
            <Select value={v.place_id} onChange={e => { f.set('place_id', e.target.value); f.set('space_id', ''); }} options={places.map(p => ({ value: String(p.id), label: p.name }))} />
          </Field>
          <Field label={t('trays.rack')} error={f.errors.space_id}>
            <Select value={v.space_id} onChange={e => f.set('space_id', e.target.value)} options={racksFirst.map(s => ({ value: String(s.id), label: s.name }))} />
          </Field>
          {full && <p className="note">{t('trays.rackFull', { rack: rack.name, n: rack.tray_count, m: already + count })}</p>}
          <Field label={t('trays.crop')} error={f.errors.plant_id}>
            <Select value={v.plant_id} onChange={e => f.set('plant_id', e.target.value)} placeholder={t('trays.pickCrop')}
              options={[...plants].sort((a, b) => plantName(a).localeCompare(plantName(b), language)).map(p => ({ value: String(p.id), label: plantName(p) }))} />
          </Field>
          {plant?.soak_hours != null && plant.soak_hours > 0 && <p className="muted">{t('trays.soak', { n: plant.soak_hours })}</p>}
          <Field label={t('trays.count')} error={f.errors.tray_count}>
            <TextInput inputMode="numeric" value={v.tray_count} onChange={e => f.set('tray_count', e.target.value)} maxLength={4} />
          </Field>
          <Field label={t('trays.sown')} error={f.errors.sown_on}>
            <DateInput value={v.sown_on} onChange={e => f.set('sown_on', e.target.value)} />
          </Field>
          <Field label={t('trays.harvestOn')} error={f.errors.harvest_on}>
            <DateInput value={v.harvest_on} onChange={e => { touched.current.harvest_on = true; f.set('harvest_on', e.target.value); }} />
          </Field>
          <Field label={t('trays.seed', { unit: unitLabel('seed', units) })} error={f.errors.seed}>
            <TextInput inputMode="decimal" value={v.seed} onChange={e => { touched.current.seed = true; f.set('seed', e.target.value); }} maxLength={10} />
          </Field>
          <Field label={t('trays.for')} error={f.errors.animal_id}>
            <Select value={v.animal_id} onChange={e => f.set('animal_id', e.target.value)} placeholder={t('trays.people')}
              options={[...animals.map(a => ({ value: String(a.id), label: a.name })), ...(trashed ? [{ value: String(trashed.id), label: `${trashed.name} ${t('trays.inTrash')}` }] : [])]} />
          </Field>
          {note && <p className={`note safety-${note.level}`} role="status">{note.text}</p>}
          <Field label={t('trays.repeat')} error={f.errors.repeat_days} hint={t('trays.repeatHint')}>
            <TextInput inputMode="numeric" value={v.repeat_days} onChange={e => f.set('repeat_days', e.target.value)} maxLength={2} />
          </Field>
          <Field label={t('trays.notes')} error={f.errors.notes}>
            <TextArea value={v.notes} onChange={e => f.set('notes', e.target.value)} rows={3} maxLength={2000} />
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
