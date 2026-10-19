import { useCallback, useState } from 'react';
import { Dialog } from '../../components/Dialog.jsx';
import { Button } from '../../components/Button.jsx';
import { Field, TextInput, TextArea, Select, DateInput } from '../../components/Field.jsx';
import { ConflictDialog } from '../../components/ConflictDialog.jsx';
import { PhotoGallery } from '../../components/PhotoGallery.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { useRecordForm } from '../../lib/useRecordForm.js';
import { api, ApiError } from '../../lib/api.js';
import { keepOrConvert, toDisplay, unitLabel, UnitError } from '../../lib/units.js';
import { PARTS } from '../../lib/harvests.js';
import { useT } from '../../i18n/I18nProvider.jsx';

const AMOUNTS = ['quantity', ...PARTS];
// Amounts are typed in the chosen units; each keeps the text and value it opened with, so an
// untouched amount goes back exactly as it was stored.
const shown = (h, k, units) => (h?.[k] == null ? '' : h.unit === 'kg' ? toDisplay('weight', h[k], units) : String(h[k]).replace(/^0$/, ''));
const pickWith = (units, today) => h => ({
  harvested_on: h?.harvested_on ?? today,
  unit: h?.unit ?? 'kg',
  ...Object.fromEntries(AMOUNTS.map(k => [k, h && h[k] ? shown(h, k, units) : ''])),
  animal_id: h?.animal_id ? String(h.animal_id) : '',
  given_to: h?.given_to ?? '',
  sold_price: h?.sold_price == null ? '' : String(h.sold_price),
  sold_to: h?.sold_to ?? '',
  notes: h?.notes ?? '',
});

// A number typed in the form, in stored units (kg for weights). Blank is 0 for the parts.
function amountOf(v, k, units, start) {
  if (v.unit === 'kg') return keepOrConvert('weight', v[k], start.text[k], start.row?.unit === 'kg' ? start.row?.[k] ?? null : null, units) ?? 0;
  const s = v[k].trim().replace(',', '.');
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new UnitError('Not a number');
  return n;
}

// Weights show one decimal, so parts typed from the shown total can add up to a hair more than the stored
// amount. This much (in kg) is let through as rounding.
const slackFor = (unit, units) => (unit === 'kg' ? (units === 'metric' ? 0.05 : 0.05 * 0.45359237) : 0);

// Record a harvest from a planting or a tray, or edit one.
export function HarvestDialog({ source, record, today, onClose, onSaved }) {
  const { t } = useT();
  const { settings } = useSettings();
  const units = settings?.units ?? 'us';
  const animals = useResource('/api/animals').data ?? [];
  const [pick] = useState(() => pickWith(units, today));
  const [initial] = useState(() => pick(record));
  const [start, setStart] = useState(() => ({ text: initial, row: record }));
  const [target, setTarget] = useState(record ? { id: record.id, version: record.version } : null);

  const submit = useCallback(async (v, { version: forced }) => {
    const body = { harvested_on: v.harvested_on, unit: v.unit, animal_id: v.animal_id ? Number(v.animal_id) : null, given_to: v.given_to, sold_to: v.sold_to, notes: v.notes };
    const bad = {};
    for (const k of AMOUNTS) {
      try { body[k] = amountOf(v, k, units, start); } catch (err) { if (!(err instanceof UnitError)) throw err; bad[k] = { code: 'not_number' }; }
    }
    // Within that rounding, the last part typed gives way.
    const over = PARTS.reduce((n, k) => n + (body[k] ?? 0), 0) - (body.quantity ?? 0);
    const slack = slackFor(v.unit, units);
    if (over > 1e-9 && over <= slack + 1e-9) {
      const typed = [...PARTS].reverse().find(k => v[k] !== start.text[k] && body[k] >= over);
      if (typed) body[typed] = Math.max(0, Math.round((body[typed] - over) * 1e9) / 1e9);
    }
    const price = v.sold_price.trim().replace(',', '.');
    if (price && !(Number(price) >= 0)) bad.sold_price = { code: 'not_number' }; else body.sold_price = price ? Number(price) : null;
    if (Object.keys(bad).length) throw new ApiError('Please fix the highlighted fields.', 400, Object.fromEntries(Object.keys(bad).map(k => [k, ''])), null, { detailCodes: bad });
    const out = target
      ? await api.patch(`/api/harvests/${target.id}`, { ...body, version: forced ?? target.version })
      : await api.post('/api/harvests', { ...source, ...body });
    setTarget({ id: out.id, version: out.version });
    setStart({ text: pick(out), row: out });
    return out;
  }, [target, start, units, pick, source]);
  const f = useRecordForm({ initial, submit });
  const v = f.values;

  // What was kept fresh, worked out live from the amounts as they will be saved (untouched ones exactly as stored).
  const exact = k => { try { return amountOf(v, k, units, start); } catch { return NaN; } };
  const total = exact('quantity');
  const parts = PARTS.reduce((n, k) => n + exact(k), 0);
  const tooMuch = total > 0 && parts - total > slackFor(v.unit, units) + 1e-9;
  const left = Math.max(0, total - parts);
  const kept = v.unit === 'kg' ? toDisplay('weight', left, units) : String(Math.round(left * 100) / 100);
  const label = v.unit === 'kg' ? unitLabel('weight', units) : t(`harvests.unit.${v.unit}`);
  // An old harvest whose animal was emptied from the Trash keeps its part; only a new or changed part needs one.
  const needsAnimal = exact('animals_qty') > 0 && !v.animal_id && (!record || v.animals_qty !== start.text.animals_qty);
  const save = async e => { if (await f.onSubmit(e)) onSaved(); };
  const keep = async () => { if (await f.keepMine()) onSaved(); };
  const canSave = total > 0 && !tooMuch && !needsAnimal && Boolean(v.harvested_on) && (!record || f.dirty);
  const unitChoice = u => {
    // Changing the unit converts nothing: the amounts are typed again.
    f.set('unit', u);
    for (const k of AMOUNTS) f.set(k, '');
  };
  const amount = (k, labelKey) => (
    <Field label={t(labelKey)} error={f.errors[k]}>
      <TextInput inputMode="decimal" value={v[k]} onChange={e => f.set(k, e.target.value)} maxLength={10} />
    </Field>
  );
  return (
    <>
      <Dialog open onClose={onClose} title={record ? t('harvests.edit') : t('harvests.add')}
        footer={<>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="harvest-form" disabled={f.saving || !canSave}>{f.saving ? t('common.saving') : t('common.save')}</Button>
        </>}>
        <form id="harvest-form" onSubmit={save}>
          <fieldset disabled={f.saving}>
            <Field label={t('harvests.date')} error={f.errors.harvested_on}><DateInput value={v.harvested_on} onChange={e => f.set('harvested_on', e.target.value)} /></Field>
            <div className="field-pair">
              {amount('quantity', 'harvests.amount')}
              <Field label={t('harvests.unitLabel')}>
                <Select value={v.unit} onChange={e => unitChoice(e.target.value)}
                  options={[{ value: 'kg', label: t('harvests.unit.weight', { unit: unitLabel('weight', units) }) }, { value: 'count', label: t('harvests.unit.count') }, { value: 'bunch', label: t('harvests.unit.bunch') }]} />
              </Field>
            </div>
            <fieldset className="harvest-split">
              <legend>{t('harvests.where')}</legend>
              {amount('larder_qty', 'harvests.larder')}
              {settings?.larder_link && <p className="muted small">{t('harvests.larderLink')}</p>}
              <div className="field-pair">
                {amount('animals_qty', 'harvests.animals')}
                <Field label={t('harvests.whichAnimals')} error={f.errors.animal_id}>
                  <Select value={v.animal_id} onChange={e => f.set('animal_id', e.target.value)} placeholder={t('harvests.pickAnimal')}
                    options={animals.map(a => ({ value: String(a.id), label: a.name }))} />
                </Field>
              </div>
              <div className="field-pair">
                {amount('given_qty', 'harvests.given')}
                <Field label={t('harvests.givenTo')}><TextInput value={v.given_to} onChange={e => f.set('given_to', e.target.value)} maxLength={120} /></Field>
              </div>
              <div className="field-pair">
                {amount('sold_qty', 'harvests.sold')}
                <Field label={t('harvests.price')} error={f.errors.sold_price}><TextInput inputMode="decimal" value={v.sold_price} onChange={e => f.set('sold_price', e.target.value)} maxLength={12} /></Field>
              </div>
              <Field label={t('harvests.soldTo')}><TextInput value={v.sold_to} onChange={e => f.set('sold_to', e.target.value)} maxLength={120} /></Field>
              <p className={tooMuch ? 'form-error' : 'muted'} role="status">
                {tooMuch ? t('harvests.tooMuch') : total > 0 ? t('harvests.kept', { amount: `${kept} ${label}` }) : ''}
              </p>
            </fieldset>
            <Field label={t('harvests.notes')} error={f.errors.notes}><TextArea value={v.notes} onChange={e => f.set('notes', e.target.value)} rows={2} maxLength={2000} /></Field>
          </fieldset>
          {f.formError && <p className="form-error" role="alert">{f.formError}</p>}
        </form>
        {record && <PhotoGallery ownerType="harvest" ownerId={record.id} />}
      </Dialog>
      <ConflictDialog conflict={f.conflict} onKeepMine={keep} onTakeTheirs={() => { setTarget(s => ({ ...s, version: f.conflict.version })); setStart({ text: pick(f.conflict), row: f.conflict }); f.takeTheirs(pick); }} onDismiss={f.dismissConflict} />
    </>
  );
}

