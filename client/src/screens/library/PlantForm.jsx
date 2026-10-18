import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Field, TextInput, TextArea, Select, Checkbox } from '../../components/Field.jsx';
import { ToggleGroup } from '../../components/ToggleGroup.jsx';
import { ChipsInput } from '../../components/ChipsInput.jsx';
import { ListEditor, withKeys } from '../../components/ListEditor.jsx';
import { ConflictDialog } from '../../components/ConflictDialog.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { useRecordForm } from '../../lib/useRecordForm.js';
import { api, ApiError } from '../../lib/api.js';
import { keepOrConvert, toDisplay, unitLabel, UnitError } from '../../lib/units.js';
import { monthName } from '../../lib/places.js';
import { useT } from '../../i18n/I18nProvider.jsx';
import { PLANT_KINDS } from './Library.jsx';

// Sizes are edited as text in the chosen units and sent back unchanged when untouched.
const SIZES = { spacing_cm: 'spacing', container_liters: 'volume', yield_kg: 'weight', seed_g_per_tray: 'seed' };
const RANGES = ['start_indoors', 'sow', 'transplant', 'fall_sow', 'days', 'years', 'zone'];
const WHOLE = ['soak_hours'];
const TEXTS = ['name', 'latin_name', 'family', 'summary', 'greenhouse_notes', 'problems', 'notes'];
const CHOICES = ['kind', 'sun', 'water', 'yield_per', 'safety_goats', 'safety_chickens'];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const str = v => (v == null ? '' : String(v));

const pickWith = units => p => ({
  ...Object.fromEntries(TEXTS.map(k => [k, p?.[k] ?? ''])),
  ...Object.fromEntries(CHOICES.map(k => [k, p?.[k] ?? (k === 'kind' ? 'vegetable' : '')])),
  ...Object.fromEntries(Object.entries(SIZES).map(([k, kind]) => [k, toDisplay(kind, p?.[k] ?? null, units)])),
  ...Object.fromEntries(RANGES.flatMap(r => [[`${r}_min`, str(p?.[`${r}_min`])], [`${r}_max`, str(p?.[`${r}_max`])]])),
  soak_hours: str(p?.soak_hours),
  container_ok: p ? p.container_ok === 1 : false,
  perennial: p ? p.perennial === 1 : false,
  frost_free_months: p?.frost_free_months ?? [],
  companions: p?.companions ?? [],
  avoid: p?.avoid ?? [],
  // Each row keeps the weight it opened with, so an untouched row goes back exactly as stored.
  preserves: withKeys((p?.preserves ?? []).map(x => {
    const shown = toDisplay('weight', x.raw_kg, units);
    return { form: x.form, unit: x.unit, weight: shown, startText: shown, startKg: x.raw_kg };
  })),
});

export function PlantFormRoute() {
  const { id } = useParams();
  return <PlantFormLoader key={id ?? 'new'} id={id} />;
}

function PlantFormLoader({ id }) {
  const { t, ready } = useT();
  const { settings, error: settingsError, reload: reloadSettings } = useSettings();
  const plant = useResource(id ? `/api/plants/${id}` : null);
  const ok = (!id || plant.data) && settings && ready;
  const error = plant.error ?? settingsError;
  const [created, setCreated] = useState(false);
  return (
    <>
      <PageHeader title={id || created ? t('plants.edit') : t('plants.new')} />
      <LoadState loading={!ok} error={ok ? null : error} onRetry={() => { if (id) plant.reload(); if (settingsError) reloadSettings(); }}>
        {ok && <PlantForm record={id ? plant.data : null} units={settings.units} onCreated={setCreated} />}
      </LoadState>
      {!ok && error && <p><Link to="/library">{t('library.back')}</Link></p>}
    </>
  );
}

function bodyOf(v, start, units) {
  const body = { container_ok: v.container_ok, perennial: v.perennial, frost_free_months: v.frost_free_months, companions: v.companions, avoid: v.avoid };
  for (const k of TEXTS) body[k] = v[k];
  for (const k of CHOICES) body[k] = v[k] || null;
  const bad = {};
  const number = (k, text, whole) => {
    const s = text.trim().replace(',', '.');
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || (whole && !Number.isInteger(n))) { bad[k] = { code: whole ? 'not_whole' : 'not_number' }; return undefined; }
    return n;
  };
  for (const r of RANGES) for (const end of ['min', 'max']) body[`${r}_${end}`] = number(`${r}_${end}`, v[`${r}_${end}`], true);
  for (const k of WHOLE) body[k] = number(k, v[k], false);
  for (const [k, kind] of Object.entries(SIZES)) {
    try { body[k] = keepOrConvert(kind, v[k], start.text[k], start.row?.[k] ?? null, units); } catch (err) {
      if (!(err instanceof UnitError)) throw err;
      bad[k] = { code: 'not_size' };
    }
  }
  body.preserves = [];
  v.preserves.forEach((x, i) => {
    if (!x.form.trim() && !x.unit.trim() && !x.weight.trim()) return;
    try {
      const kg = keepOrConvert('weight', x.weight, x.startText ?? null, x.startKg ?? null, units);
      body.preserves.push({ form: x.form.trim(), unit: x.unit.trim(), raw_kg: kg });
    } catch (err) {
      if (!(err instanceof UnitError)) throw err;
      bad[`preserves.${i}`] = { code: 'not_size' };
    }
  });
  if (Object.keys(bad).length) throw new ApiError('Please fix the highlighted fields.', 400, Object.fromEntries(Object.keys(bad).map(k => [k, ''])), null, { detailCodes: bad });
  return body;
}

function PlantForm({ record, units, onCreated }) {
  const { t, language } = useT();
  const navigate = useNavigate();
  const [pick] = useState(() => pickWith(units));
  const [initial] = useState(() => pick(record));
  const [start, setStart] = useState(() => ({ text: initial, row: record }));
  const [target, setTarget] = useState(record ? { id: record.id, version: record.version } : null);
  const submit = useCallback(async (v, { version: forced }) => {
    const body = bodyOf(v, start, units);
    const out = target
      ? await api.patch(`/api/plants/${target.id}`, { ...body, version: forced ?? target.version })
      : await api.post('/api/plants', body);
    if (!target) onCreated(true);
    setTarget({ id: out.id, version: out.version });
    setStart({ text: pick(out), row: out });
    return out;
  }, [target, start, units, pick, onCreated]);
  const f = useRecordForm({ initial, submit });
  const v = f.values;
  const done = out => { if (out && !f.isDirtyNow()) navigate(`/library/plants/${out.id}`); };
  const save = async e => done(await f.onSubmit(e));
  const keep = async () => done(await f.keepMine());
  const takeTheirs = () => { setTarget(s => ({ ...s, version: f.conflict.version })); setStart({ text: pick(f.conflict), row: f.conflict }); f.takeTheirs(pick); };
  const cancel = () => navigate(target ? `/library/plants/${target.id}` : '/library');
  const canSave = Boolean(v.name.trim()) && (!record || f.dirty);

  const text = (k, label, opts = {}) => (
    <Field label={label} error={f.errors[k]} hint={opts.hint}>
      {opts.long ? <TextArea value={v[k]} onChange={e => f.set(k, e.target.value)} rows={opts.rows ?? 3} maxLength={opts.max ?? 4000} />
        : <TextInput value={v[k]} onChange={e => f.set(k, e.target.value)} maxLength={opts.max ?? 120} inputMode={opts.mode} />}
    </Field>
  );
  const choice = (k, label, options, empty) => (
    <Field label={label} error={f.errors[k]}>
      <Select value={v[k]} onChange={e => f.set(k, e.target.value)} placeholder={empty} options={options} />
    </Field>
  );
  const range = (r, title, unitPhrase) => (
    <div className="field-pair range">
      {text(`${r}_min`, t('plants.rangeFrom', { title, unit: unitPhrase }), { max: 4, mode: 'numeric' })}
      {text(`${r}_max`, t('plants.rangeTo', { title, unit: unitPhrase }), { max: 4, mode: 'numeric' })}
    </div>
  );
  const size = (k, label) => text(k, `${label} (${unitLabel(SIZES[k], units)})`, { max: 10, mode: 'decimal' });

  return (
    <>
      <form className="entry-form plant-form" onSubmit={save}>
        <fieldset disabled={f.saving}>
          <h2>{t('plants.section.basics')}</h2>
          {text('name', t('plants.name'), { max: 80 })}
          {choice('kind', t('plants.kindLabel'), PLANT_KINDS.map(k => ({ value: k, label: t(`plants.kind.${k}`) })))}
          {text('latin_name', t('plants.latinName'))}
          {text('family', t('plants.family'), { max: 80 })}
          {text('summary', t('plants.summary'), { long: true, max: 600, rows: 2 })}
          <Checkbox label={t('plants.perennial')} checked={v.perennial} onChange={e => f.set('perennial', e.target.checked)} />

          <h2>{t('plants.section.when')}</h2>
          <p className="field-hint">{t('plants.whenHint')}</p>
          {range('start_indoors', t('plants.window.start_indoors'), t('plants.unit.beforeLast'))}
          {range('sow', t('plants.window.sow'), t('plants.unit.afterLast'))}
          {range('transplant', t('plants.window.transplant'), t('plants.unit.afterLast'))}
          {range('fall_sow', t('plants.window.fall_sow'), t('plants.unit.beforeFirst'))}
          <ToggleGroup label={t('plants.frostFreeMonths')} value={v.frost_free_months} onChange={next => f.set('frost_free_months', next)}
            options={MONTHS.map(m => ({ value: m, label: monthName(m, language, 'short') }))} />
          {f.errors.frost_free_months && <small className="field-error" role="alert">{f.errors.frost_free_months}</small>}

          <h2>{t('plants.section.care')}</h2>
          {choice('sun', t('spaces.sun'), ['full', 'part', 'shade'].map(s => ({ value: s, label: t(`spaces.sun.${s}`) })), t('spaces.sunUnknown'))}
          {choice('water', t('plants.water'), ['low', 'medium', 'high'].map(s => ({ value: s, label: t(`plants.water.${s}`) })), t('spaces.sunUnknown'))}
          {size('spacing_cm', t('plants.spacing'))}
          <Checkbox label={t('plants.goodInPot')} checked={v.container_ok} onChange={e => f.set('container_ok', e.target.checked)} />
          {size('container_liters', t('plants.potSize'))}
          {range('zone', t('plants.zones'), t('plants.unit.zone'))}
          {text('greenhouse_notes', t('plants.greenhouseNotes'), { long: true, max: 2000 })}

          <h2>{t('plants.section.harvest')}</h2>
          {range('days', t('plants.daysToHarvest'), t('plants.unit.days'))}
          {range('years', t('plants.yearsToFruit'), t('plants.unit.years'))}
          <div className="field-pair">
            {size('yield_kg', t('plants.yield'))}
            {choice('yield_per', t('plants.yieldPerLabel'), ['plant', 'meter'].map(s => ({ value: s, label: t(`plants.per.${s}`) })), '')}
          </div>

          <fieldset className="field field-group">
            <legend>{t('plants.preserves')}</legend>
            <p className="field-hint">{t('plants.preservesHint')}</p>
            <ListEditor items={v.preserves} onChange={list => f.set('preserves', list)} max={10}
              blank={() => ({ form: '', unit: '', weight: '' })} addLabel={t('plants.addPreserve')}
              itemLabel={(item, i) => item.form || t('plants.preserve', { n: i + 1 })}
              renderItem={(item, i, update) => (
                <>
                  <Field label={t('plants.preserve', { n: i + 1 })} className="supply-name"><TextInput value={item.form} onChange={e => update({ form: e.target.value })} maxLength={80} /></Field>
                  <Field label={t('plants.preserveUnit', { n: i + 1 })} className="supply-amount"><TextInput value={item.unit} onChange={e => update({ unit: e.target.value })} maxLength={40} /></Field>
                  <Field label={t('plants.preserveWeight', { n: i + 1, unit: unitLabel('weight', units) })} error={f.errors[`preserves.${i}`]} className="supply-amount">
                    <TextInput inputMode="decimal" value={item.weight} onChange={e => update({ weight: e.target.value })} maxLength={10} />
                  </Field>
                </>
              )} />
            {f.errors.preserves && <small className="field-error" role="alert">{f.errors.preserves}</small>}
          </fieldset>

          <h2>{t('plants.section.companions')}</h2>
          <ChipsInput id="companions" label={t('plants.companions')} value={v.companions} max={30} keepCase onChange={next => f.set('companions', next)} />
          <ChipsInput id="avoid" label={t('plants.avoid')} value={v.avoid} max={30} keepCase onChange={next => f.set('avoid', next)} />

          {v.kind === 'microgreen' && (
            <>
              <h2>{t('plants.section.microgreens')}</h2>
              {text('soak_hours', t('plants.soakLabel'), { max: 5, mode: 'decimal' })}
              {size('seed_g_per_tray', t('plants.seedPerTray'))}
              {choice('safety_goats', t('plants.goatsLabel'), ['safe', 'small', 'avoid'].map(s => ({ value: s, label: t(`plants.safety.${s}`) })), t('spaces.sunUnknown'))}
              {choice('safety_chickens', t('plants.chickensLabel'), ['safe', 'small', 'avoid'].map(s => ({ value: s, label: t(`plants.safety.${s}`) })), t('spaces.sunUnknown'))}
            </>
          )}

          <h2>{t('plants.section.notes')}</h2>
          {text('problems', t('plants.problems'), { long: true })}
          {text('notes', t('plants.notes'), { long: true, rows: 4 })}
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
