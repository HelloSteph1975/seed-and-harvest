import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Field, TextInput, TextArea, Select, DateInput, Checkbox } from '../../components/Field.jsx';
import { ConflictDialog } from '../../components/ConflictDialog.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { useRecordForm } from '../../lib/useRecordForm.js';
import { useToday } from '../../lib/useToday.js';
import { api, ApiError } from '../../lib/api.js';
import { byStatus } from '../../lib/places.js';
import { starterText } from '../../lib/starter.js';
import { zoneFit } from '../../lib/windows.js';
import { addYears, yearsText, allowedStarts, dayText, startFrom, STATUSES, suggestStart } from '../../lib/tasks.js';
import { keepOrConvert, toDisplay, unitLabel, UnitError } from '../../lib/units.js';
import { useT } from '../../i18n/I18nProvider.jsx';

const pickWith = (defaults, units) => p => ({
  place_id: String(p?.space?.place_id ?? defaults.place ?? ''),
  space_id: String(p?.space_id ?? defaults.space ?? ''),
  plant_id: String(p?.plant_id ?? defaults.plant ?? ''),
  variety_id: p?.variety?.id ? String(p.variety.id) : '',
  how_started: p?.how_started ?? '',
  count: p ? (p.count == null ? '' : String(p.count)) : defaults.count ?? '',
  row_m: toDisplay('length', p ? p.row_m : defaults.row, units),
  start_on: p?.start_on ?? '',
  status: p?.status ?? 'planned',
  notes: p?.notes ?? '',
  in_container: p ? p.in_container === 1 : false,
  bought_from: p?.bought_from ?? '',
  bought_on: p?.bought_on ?? '',
  price: p?.price == null ? '' : String(p.price),
  size_when_bought: p?.size_when_bought ?? '',
  bears_on: p?.bears_on ?? '',
});

// What a link can fill in for a new planting. `row` is in meters; `year` plans for that year.
function plantingDefaults(params) {
  const whole = v => (/^\d{1,6}$/.test(v ?? '') ? v : null);
  const row = Number(params.get('row'));
  const year = params.get('year');
  return {
    plant: params.get('plant'), space: params.get('space'), place: params.get('place'), count: whole(params.get('count')),
    row: row > 0 && row <= 10000 ? row : null, year: /^\d{4}$/.test(year ?? '') ? year : null,
  };
}

export function PlantingFormRoute() {
  const { id } = useParams();
  return <PlantingFormLoader key={id ?? 'new'} id={id} />;
}

function PlantingFormLoader({ id }) {
  const { t, ready: languageReady } = useT();
  const { settings, error: settingsError, reload: reloadSettings } = useSettings();
  const [params] = useSearchParams();
  const planting = useResource(id ? `/api/plantings/${id}` : null);
  const places = useResource('/api/places');
  const plants = useResource('/api/plants');
  const ready = (!id || planting.data) && places.data && plants.data && settings && languageReady;
  const error = planting.error ?? places.error ?? plants.error ?? settingsError;
  return (
    <>
      <PageHeader title={id ? t('plantings.edit') : t('plantings.new')} />
      <LoadState loading={!ready} error={ready ? null : error}
        onRetry={() => { if (id) planting.reload(); places.reload(); plants.reload(); if (settingsError) reloadSettings(); }}>
        {ready && <PlantingForm record={id ? planting.data : null} places={byStatus(places.data)} plants={plants.data} settings={settings}
          defaults={plantingDefaults(params)} perennialOnly={params.get('perennial') === '1'} />}
      </LoadState>
      {!ready && error && <p><Link to="/plantings">{t('plantings.back')}</Link></p>}
    </>
  );
}

// The tasks a planting would make, from the server's own rules. Replies to older questions are dropped.
function usePreview(body) {
  const [state, setState] = useState({ tasks: null, error: null });
  const seq = useRef(0);
  const key = body ? JSON.stringify(body) : null;
  useEffect(() => {
    const mine = ++seq.current;
    if (!key) { setState({ tasks: null, error: null }); return undefined; }
    const timer = setTimeout(() => {
      api.post('/api/plantings/preview', JSON.parse(key)).then(
        out => { if (seq.current === mine) setState({ tasks: out.tasks, error: null }); },
        error => { if (seq.current === mine) setState({ tasks: null, error }); },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [key]);
  return state;
}

function PlantingForm({ record, places, plants: allPlants, settings, defaults, perennialOnly }) {
  const plants = perennialOnly ? allPlants.filter(p => p.perennial) : allPlants;
  const { t, tc, language } = useT();
  const navigate = useNavigate();
  const fallbackPlace = places.find(p => String(p.id) === defaults.place)?.id ?? places.find(p => p.status === 'current')?.id ?? places[0]?.id;
  const units = settings.units ?? 'us';
  const [pick] = useState(() => pickWith({ ...defaults, place: fallbackPlace }, units));
  const [initial] = useState(() => pick(record));
  const [target, setTarget] = useState(record ? { id: record.id, version: record.version } : null);

  const submit = useCallback(async (v, { version: forced }) => {
    const n = v.count.trim();
    if (n && !/^\d+$/.test(n)) throw new ApiError('Please fix the highlighted fields.', 400, { count: '' }, null, { detailCodes: { count: { code: 'not_whole' } } });
    let row;
    try { row = keepOrConvert('length', v.row_m, initial.row_m, record ? record.row_m : defaults.row ?? null, units); } catch (err) {
      if (!(err instanceof UnitError)) throw err;
      throw new ApiError('Please fix the highlighted fields.', 400, { row_m: '' }, null, { detailCodes: { row_m: { code: 'not_number' } } });
    }
    const price = v.price.trim().replace(',', '.');
    if (price && !(Number.isFinite(Number(price)) && Number(price) >= 0)) {
      throw new ApiError('Please fix the highlighted fields.', 400, { price: '' }, null, { detailCodes: { price: { code: 'not_number' } } });
    }
    const body = {
      space_id: Number(v.space_id), plant_id: Number(v.plant_id), variety_id: v.variety_id ? Number(v.variety_id) : null,
      how_started: v.how_started, count: n ? Number(n) : null, row_m: row, start_on: v.start_on, status: v.status, notes: v.notes,
      in_container: v.in_container, bought_from: v.bought_from, bought_on: v.bought_on || null, price: price ? Number(price) : null,
      size_when_bought: v.size_when_bought, bears_on: v.bears_on || null,
    };
    const out = target
      ? await api.patch(`/api/plantings/${target.id}`, { ...body, version: forced ?? target.version })
      : await api.post('/api/plantings', body);
    setTarget({ id: out.id, version: out.version });
    return out;
  }, [target, initial, record, defaults.row, units]);
  const f = useRecordForm({ initial, submit });
  const v = f.values;

  const place = places.find(p => String(p.id) === v.place_id) ?? null;
  const spaces = useResource(v.place_id ? `/api/spaces?place_id=${v.place_id}` : null);
  const plant = useResource(v.plant_id ? `/api/plants/${v.plant_id}` : null).data;
  const today = useToday(place?.time_zone || settings.time_zone);
  const starts = allowedStarts(plant);
  const spaceShown = Boolean(spaces.data?.some(s => String(s.id) === v.space_id));

  // Keep the space, variety and way of starting valid when the place or plant changes.
  useEffect(() => {
    if (spaces.data && !spaces.data.some(s => String(s.id) === v.space_id)) f.set('space_id', spaces.data[0] ? String(spaces.data[0].id) : '');
  }, [spaces.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const containerTouched = useRef(Boolean(record));
  const spaceKind = (spaces.data ?? []).find(s => String(s.id) === v.space_id)?.kind;
  useEffect(() => {
    if (!containerTouched.current && spaceKind) f.set('in_container', spaceKind === 'container');
  }, [spaceKind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!plant) return;
    if (!starts.includes(v.how_started)) f.set('how_started', starts[0]);
    if (v.variety_id && !plant.varieties.some(x => String(x.id) === v.variety_id)) f.set('variety_id', '');
  }, [plant]); // eslint-disable-line react-hooks/exhaustive-deps

  // Planning for a later year looks for start dates from its January 1.
  const from = defaults.year && `${defaults.year}-01-01` > today ? `${defaults.year}-01-01` : today;
  const suggestion = suggestStart(plant, place, v.how_started, from);
  const fit = plant && place ? zoneFit(plant, place) : 'unknown';
  const showPurchase = Boolean(plant?.perennial) || v.how_started === 'start' || v.how_started === 'mature';
  const estimate = () => {
    if (!plant || !/^\d{4}-\d{2}-\d{2}$/.test(v.start_on)) return;
    const years = v.how_started === 'mature' ? 1 : (plant.years_min ?? 1);
    f.set('bears_on', addYears(v.start_on, Math.max(1, years)));
  };
  const previewBody = spaceShown && v.plant_id && v.how_started && /^\d{4}-\d{2}-\d{2}$/.test(v.start_on)
    ? { space_id: Number(v.space_id), plant_id: Number(v.plant_id), how_started: v.how_started, start_on: v.start_on } : null;
  const preview = usePreview(previewBody);

  const done = out => { if (out && !f.isDirtyNow()) navigate(`/plantings/${out.id}`); };
  const save = async e => done(await f.onSubmit(e));
  const keep = async () => done(await f.keepMine());
  const takeTheirs = () => { setTarget(s => ({ ...s, version: f.conflict.version })); f.takeTheirs(pick); };
  const cancel = () => navigate(target ? `/plantings/${target.id}` : '/plantings');
  const canSave = spaceShown && Boolean(v.plant_id && v.how_started && v.start_on) && (!record || f.dirty);
  const plantName = p => starterText(tc, p, 'name', p.name);
  const day = iso => dayText(iso, language, today);

  return (
    <>
      <form className="entry-form" onSubmit={save}>
        <fieldset disabled={f.saving}>
          <Field label={t('spaces.place')}>
            <Select value={v.place_id} onChange={e => { f.set('place_id', e.target.value); f.set('space_id', ''); }} options={places.map(p => ({ value: String(p.id), label: p.name }))} />
          </Field>
          <Field label={t('plantings.space')} error={f.errors.space_id}
            hint={spaces.data && spaces.data.length === 0 ? t('plantings.noSpaces') : undefined}>
            <Select value={v.space_id} onChange={e => f.set('space_id', e.target.value)} options={(spaces.data ?? []).map(s => ({ value: String(s.id), label: s.name }))} />
          </Field>
          {spaces.data?.length === 0 && <p><Link to={`/spaces/new?place=${v.place_id}`}>{t('spaces.add')}</Link></p>}
          <Field label={t('plantings.plant')} error={f.errors.plant_id}>
            <Select value={v.plant_id} onChange={e => f.set('plant_id', e.target.value)} placeholder={t('plantings.pickPlant')}
              options={[...plants].sort((a, b) => plantName(a).localeCompare(plantName(b), language)).map(p => ({ value: String(p.id), label: plantName(p) }))} />
          </Field>
          {plant?.varieties.length > 0 && (
            <Field label={t('plantings.variety')} error={f.errors.variety_id}>
              <Select value={v.variety_id} onChange={e => f.set('variety_id', e.target.value)} placeholder={t('plantings.noVariety')}
                options={plant.varieties.map(x => ({ value: String(x.id), label: x.name }))} />
            </Field>
          )}
          <Field label={t('plantings.howStarted')} error={f.errors.how_started}>
            <Select value={v.how_started} onChange={e => f.set('how_started', e.target.value)} options={starts.map(k => ({ value: k, label: t(`plantings.how.${k}`) }))} />
          </Field>
          <Field label={t('plantings.count')} error={f.errors.count}>
            <TextInput inputMode="numeric" value={v.count} onChange={e => f.set('count', e.target.value)} maxLength={6} />
          </Field>
          <Field label={t('plantings.row', { unit: unitLabel('length', units) })} error={f.errors.row_m}>
            <TextInput inputMode="decimal" value={v.row_m} onChange={e => f.set('row_m', e.target.value)} maxLength={8} />
          </Field>
          <Field label={t('plantings.startOn')} error={f.errors.start_on} hint={t(`plantings.startHint.${v.how_started || 'start'}`)}>
            <DateInput value={v.start_on} onChange={e => f.set('start_on', e.target.value)} />
          </Field>
          <div className="suggest" aria-live="polite">
            {suggestion.window && (
              <p>{t(`plants.window.${suggestion.window.kind}`)}: {t('plants.range', { from: day(suggestion.window.from), to: day(suggestion.window.to) })}{' '}
                <Button size="sm" variant="ghost" onClick={() => f.set('start_on', startFrom(suggestion.window, from))}>{t('plantings.useDate')}</Button></p>
            )}
            {suggestion.anyDay && <p className="muted">{t('plants.microgreenAnyTime')}</p>}
            {suggestion.needs?.map(n => (
              <p key={n} className="note">{t(`plants.need.${n === 'last_frost' ? 'last_frost_only' : n}`)} {place && <Link to={`/places/${place.id}/edit`}>{t('plants.editPlace')}</Link>}</p>
            ))}
            {suggestion.needs?.length === 0 && <p className="muted">{t('plantings.noWindow')}</p>}
            {fit === 'too_cold' && (v.in_container ? <p className="note">{t('plantings.potShelter')}</p> : <p className="note">{t('plants.tooCold', { place: place.name })}</p>)}
            {fit === 'too_warm' && <p className="note">{t('plants.tooWarm', { place: place.name })}</p>}
          </div>
          <Field label={t('plantings.status')} error={f.errors.status}>
            <Select value={v.status} onChange={e => f.set('status', e.target.value)} options={STATUSES.map(s => ({ value: s, label: t(`plantings.statusName.${s}`) }))} />
          </Field>
          <Checkbox label={t('plantings.inContainer')} checked={v.in_container} onChange={e => { containerTouched.current = true; f.set('in_container', e.target.checked); }} />
          {showPurchase && (
            <fieldset className="purchase">
              <legend>{t('plantings.purchase')}</legend>
              <Field label={t('plantings.boughtFrom')} error={f.errors.bought_from}>
                <TextInput value={v.bought_from} onChange={e => f.set('bought_from', e.target.value)} maxLength={120} />
              </Field>
              <Field label={t('plantings.boughtOn')} error={f.errors.bought_on}>
                <DateInput value={v.bought_on} onChange={e => f.set('bought_on', e.target.value)} />
              </Field>
              <Field label={t('plantings.price')} error={f.errors.price}>
                <TextInput inputMode="decimal" value={v.price} onChange={e => f.set('price', e.target.value)} maxLength={12} />
              </Field>
              <Field label={t('plantings.sizeWhenBought')} error={f.errors.size_when_bought} hint={t('plantings.sizeHint')}>
                <TextInput value={v.size_when_bought} onChange={e => f.set('size_when_bought', e.target.value)} maxLength={120} />
              </Field>
              <Field label={t('plantings.bearsOn')} error={f.errors.bears_on}>
                <DateInput value={v.bears_on} onChange={e => f.set('bears_on', e.target.value)} />
              </Field>
              {plant?.perennial ? <p><Button size="sm" variant="ghost" onClick={estimate}>{t('plantings.useEstimate')}</Button>
                {plant.years_min != null && <span className="muted"> {yearsText(t, plant.years_min, plant.years_max)}</span>}</p> : null}
            </fieldset>
          )}
          <Field label={t('plantings.notes')} error={f.errors.notes}>
            <TextArea value={v.notes} onChange={e => f.set('notes', e.target.value)} rows={3} maxLength={2000} />
          </Field>
        </fieldset>
        {record && <p className="muted small">{t('plantings.editNote')}</p>}
        {f.formError && <p className="form-error" role="alert">{f.formError}</p>}
        <div className="form-actions">
          <Button variant="ghost" onClick={cancel}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={f.saving || !canSave}>{f.saving ? t('common.saving') : t('common.save')}</Button>
        </div>
      </form>
      <section className="card preview" aria-labelledby="preview-title">
        <h2 id="preview-title">{t('plantings.preview')}</h2>
        {!previewBody && <p className="muted">{t('plantings.previewHint')}</p>}
        {previewBody && preview.tasks && (
          <ul className="list">
            {preview.tasks.map((x, i) => (
              <li key={i}><span className="grow">{t(`tasks.kind.${x.kind}`)}</span>
                <span className="muted">{x.end_on ? t('plants.range', { from: day(x.due_on), to: day(x.end_on) }) : day(x.due_on)}</span></li>
            ))}
          </ul>
        )}
      </section>
      <ConflictDialog conflict={f.conflict} onKeepMine={keep} onTakeTheirs={takeTheirs} onDismiss={f.dismissConflict} />
    </>
  );
}
