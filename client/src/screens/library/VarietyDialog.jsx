import { useCallback, useState } from 'react';
import { Dialog } from '../../components/Dialog.jsx';
import { Button } from '../../components/Button.jsx';
import { Field, TextInput, TextArea } from '../../components/Field.jsx';
import { ConflictDialog } from '../../components/ConflictDialog.jsx';
import { useRecordForm } from '../../lib/useRecordForm.js';
import { api } from '../../lib/api.js';
import { useT } from '../../i18n/I18nProvider.jsx';

const pick = v => ({ name: v?.name ?? '', days: v?.days == null ? '' : String(v.days), notes: v?.notes ?? '' });

// Add or edit one variety of a plant.
export function VarietyDialog({ plantId, record, onClose, onSaved }) {
  const { t } = useT();
  const [target, setTarget] = useState(record ? { id: record.id, version: record.version } : null);
  const submit = useCallback(async (v, { version: forced }) => {
    const body = { name: v.name, days: v.days.trim() ? Number(v.days) : null, notes: v.notes };
    const out = target
      ? await api.patch(`/api/varieties/${target.id}`, { ...body, version: forced ?? target.version })
      : await api.post(`/api/plants/${plantId}/varieties`, body);
    setTarget({ id: out.id, version: out.version });
    return out;
  }, [target, plantId]);
  const [initial] = useState(() => pick(record));
  const f = useRecordForm({ initial, submit });
  const save = async e => { if (await f.onSubmit(e)) onSaved(); };
  const keep = async () => { if (await f.keepMine()) onSaved(); };
  return (
    <>
      <Dialog open onClose={onClose} title={record ? t('varieties.edit', { name: record.name }) : t('varieties.add')}
        footer={<>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="variety-form" disabled={f.saving || !f.values.name.trim()}>{f.saving ? t('common.saving') : t('common.save')}</Button>
        </>}>
        <form id="variety-form" onSubmit={save}>
          <fieldset disabled={f.saving}>
            <Field label={t('varieties.name')} error={f.errors.name}><TextInput value={f.values.name} onChange={e => f.set('name', e.target.value)} maxLength={80} /></Field>
            <Field label={t('varieties.daysLabel')} error={f.errors.days}><TextInput inputMode="numeric" value={f.values.days} onChange={e => f.set('days', e.target.value)} maxLength={4} /></Field>
            <Field label={t('varieties.notes')} error={f.errors.notes}><TextArea value={f.values.notes} onChange={e => f.set('notes', e.target.value)} rows={3} maxLength={2000} /></Field>
          </fieldset>
          {f.formError && <p className="form-error" role="alert">{f.formError}</p>}
        </form>
      </Dialog>
      <ConflictDialog conflict={f.conflict} onKeepMine={keep} onTakeTheirs={() => { setTarget(s => ({ ...s, version: f.conflict.version })); f.takeTheirs(pick); }} onDismiss={f.dismissConflict} />
    </>
  );
}
