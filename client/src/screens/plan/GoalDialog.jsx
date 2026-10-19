import { useCallback, useState } from 'react';
import { Dialog } from '../../components/Dialog.jsx';
import { Button } from '../../components/Button.jsx';
import { Field, TextInput, TextArea, Select } from '../../components/Field.jsx';
import { ConflictDialog } from '../../components/ConflictDialog.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { useRecordForm } from '../../lib/useRecordForm.js';
import { api, ApiError } from '../../lib/api.js';
import { starterText } from '../../lib/starter.js';
import { keepOrConvert, toDisplay, unitLabel, UnitError } from '../../lib/units.js';
import { useT } from '../../i18n/I18nProvider.jsx';

// Weights are typed in the chosen units and stored in kg; an untouched weight goes back exactly.
const pickWith = units => g => ({
  plant_id: g ? String(g.plant_id) : '',
  goal_kind: g?.goal_kind ?? 'raw',
  unit: g?.unit ?? 'kg',
  amount: !g ? '' : g.goal_kind === 'raw' && g.unit === 'kg' ? toDisplay('weight', g.amount, units) : String(g.amount),
  preserve_position: g?.preserve_position ? String(g.preserve_position) : '',
  notes: g?.notes ?? '',
});

const bad = (k, code) => new ApiError('Please fix the highlighted fields.', 400, { [k]: '' }, null, { detailCodes: { [k]: { code } } });

// Add or edit one pantry goal for `year`.
export function GoalDialog({ year, record, onClose, onSaved }) {
  const { t, tc, language } = useT();
  const { settings } = useSettings();
  const units = settings?.units ?? 'us';
  const plants = useResource('/api/plants').data ?? [];
  const [pick] = useState(() => pickWith(units));
  const [initial] = useState(() => pick(record));
  const [start, setStart] = useState(() => ({ text: initial, row: record }));
  const [target, setTarget] = useState(record ? { id: record.id, version: record.version } : null);

  const submit = useCallback(async (v, { version: forced }) => {
    let amount;
    if (v.goal_kind === 'raw' && v.unit === 'kg') {
      const was = start.row?.goal_kind === 'raw' && start.row?.unit === 'kg' && start.text.unit === 'kg' ? start.row.amount : null;
      try { amount = keepOrConvert('weight', v.amount, start.text.amount, was, units); } catch (err) { if (err instanceof UnitError) throw bad('amount', 'not_number'); throw err; }
    } else {
      const s = v.amount.trim().replace(',', '.');
      amount = s ? Number(s) : null;
      if (s && !Number.isFinite(amount)) throw bad('amount', 'not_number');
    }
    const body = {
      plant_id: Number(v.plant_id), goal_kind: v.goal_kind, amount, notes: v.notes,
      ...(v.goal_kind === 'raw' ? { unit: v.unit } : { preserve_position: v.preserve_position ? Number(v.preserve_position) : null }),
    };
    const out = target
      ? await api.patch(`/api/goals/${target.id}`, { ...body, version: forced ?? target.version })
      : await api.post('/api/goals', { ...body, year });
    setTarget({ id: out.id, version: out.version });
    setStart({ text: pick(out), row: out });
    return out;
  }, [target, start, units, pick, year]);
  const f = useRecordForm({ initial, submit });
  const v = f.values;
  const plant = useResource(v.plant_id ? `/api/plants/${v.plant_id}` : null).data;
  const forms = plant && String(plant.id) === v.plant_id ? plant.preserves : [];
  const save = async e => { if (await f.onSubmit(e)) onSaved(); };
  const keep = async () => { if (await f.keepMine()) onSaved(); };
  const ready = v.plant_id && v.amount.trim() && (v.goal_kind === 'raw' || v.preserve_position);
  const plantName = p => starterText(tc, p, 'name', p.name);
  return (
    <>
      <Dialog open onClose={onClose} title={record ? t('plan.editGoal') : t('plan.addGoal')}
        footer={<>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="goal-form" disabled={f.saving || !ready || (record && !f.dirty)}>{f.saving ? t('common.saving') : t('common.save')}</Button>
        </>}>
        <form id="goal-form" onSubmit={save}>
          <fieldset disabled={f.saving}>
            <Field label={t('plan.plant')} error={f.errors.plant_id}>
              <Select value={v.plant_id} onChange={e => { f.set('plant_id', e.target.value); f.set('preserve_position', ''); }} placeholder={t('plantings.pickPlant')}
                options={[...plants].sort((a, b) => plantName(a).localeCompare(plantName(b), language)).map(p => ({ value: String(p.id), label: plantName(p) }))} />
            </Field>
            <fieldset className="radio-row">
              <legend>{t('plan.kind')}</legend>
              {['raw', 'preserve'].map(k => (
                <label key={k}>
                  <input type="radio" name="goal_kind" value={k} checked={v.goal_kind === k} onChange={() => { f.set('goal_kind', k); f.set('amount', ''); }} />
                  {t(`plan.kind.${k}`)}
                </label>
              ))}
            </fieldset>
            {v.goal_kind === 'raw' ? (
              <div className="field-pair">
                <Field label={t('plan.amount')} error={f.errors.amount}>
                  <TextInput inputMode="decimal" value={v.amount} onChange={e => f.set('amount', e.target.value)} maxLength={10} />
                </Field>
                <Field label={t('plan.unit')} error={f.errors.unit}>
                  <Select value={v.unit} onChange={e => { f.set('unit', e.target.value); f.set('amount', ''); }}
                    options={[{ value: 'kg', label: t('harvests.unit.weight', { unit: unitLabel('weight', units) }) }, { value: 'count', label: t('plan.unit.count') }]} />
                </Field>
              </div>
            ) : (
              <>
                <Field label={t('plan.form')} error={f.errors.preserve_position} hint={plant && forms.length === 0 ? t('plan.noForms') : undefined}>
                  <Select value={v.preserve_position} onChange={e => f.set('preserve_position', e.target.value)} placeholder={t('harvests.pickAnimal')}
                    options={forms.map((p, i) => ({ value: String(i + 1), label: `${p.form} (${p.unit})` }))} />
                </Field>
                <Field label={t('plan.jars')} error={f.errors.amount}>
                  <TextInput inputMode="decimal" value={v.amount} onChange={e => f.set('amount', e.target.value)} maxLength={10} />
                </Field>
              </>
            )}
            <Field label={t('plan.notes')} error={f.errors.notes}><TextArea value={v.notes} onChange={e => f.set('notes', e.target.value)} rows={2} maxLength={2000} /></Field>
          </fieldset>
          {f.formError && <p className="form-error" role="alert">{f.formError}</p>}
        </form>
      </Dialog>
      <ConflictDialog conflict={f.conflict} onKeepMine={keep} onTakeTheirs={() => { setTarget(s => ({ ...s, version: f.conflict.version })); setStart({ text: pick(f.conflict), row: f.conflict }); f.takeTheirs(pick); }} onDismiss={f.dismissConflict} />
    </>
  );
}
