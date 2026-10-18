import { useCallback, useState } from 'react';
import { Dialog } from '../../components/Dialog.jsx';
import { Button } from '../../components/Button.jsx';
import { Field, TextArea, DateInput, Select } from '../../components/Field.jsx';
import { ConflictDialog } from '../../components/ConflictDialog.jsx';
import { PhotoGallery } from '../../components/PhotoGallery.jsx';
import { useRecordForm } from '../../lib/useRecordForm.js';
import { api } from '../../lib/api.js';
import { LOG_KINDS } from '../../lib/tasks.js';
import { useT } from '../../i18n/I18nProvider.jsx';

const pick = x => ({ on_date: x?.on_date ?? '', kind: x?.kind ?? 'note', note: x?.note ?? '' });

// Add or edit one dated note in a planting's log. Photos go on an entry once it's saved.
export function LogDialog({ plantingId, record, today, onClose, onSaved }) {
  const { t } = useT();
  const [target, setTarget] = useState(record ? { id: record.id, version: record.version } : null);
  const [initial] = useState(() => pick(record ?? { on_date: today }));
  const submit = useCallback(async (v, { version: forced }) => {
    const body = { on_date: v.on_date, kind: v.kind, note: v.note };
    const out = target
      ? await api.patch(`/api/log/${target.id}`, { ...body, version: forced ?? target.version })
      : await api.post(`/api/plantings/${plantingId}/log`, body);
    setTarget({ id: out.id, version: out.version });
    return out;
  }, [target, plantingId]);
  const f = useRecordForm({ initial, submit });
  const v = f.values;
  const save = async e => { if (await f.onSubmit(e)) onSaved(); };
  const keep = async () => { if (await f.keepMine()) onSaved(); };
  return (
    <>
      <Dialog open onClose={onClose} title={record ? t('log.edit') : t('log.add')}
        footer={<>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="log-form" disabled={f.saving || !v.on_date || (record && !f.dirty)}>{f.saving ? t('common.saving') : t('common.save')}</Button>
        </>}>
        <form id="log-form" onSubmit={save}>
          <fieldset disabled={f.saving}>
            <Field label={t('log.date')} error={f.errors.on_date}><DateInput value={v.on_date} onChange={e => f.set('on_date', e.target.value)} /></Field>
            <Field label={t('log.kindLabel')} error={f.errors.kind}>
              <Select value={v.kind} onChange={e => f.set('kind', e.target.value)} options={LOG_KINDS.map(k => ({ value: k, label: t(`log.kind.${k}`) }))} />
            </Field>
            <Field label={t('log.note')} error={f.errors.note}><TextArea value={v.note} onChange={e => f.set('note', e.target.value)} rows={4} maxLength={2000} /></Field>
          </fieldset>
          {f.formError && <p className="form-error" role="alert">{f.formError}</p>}
        </form>
        {record && <PhotoGallery ownerType="log" ownerId={record.id} />}
      </Dialog>
      <ConflictDialog conflict={f.conflict} onKeepMine={keep} onTakeTheirs={() => { setTarget(s => ({ ...s, version: f.conflict.version })); f.takeTheirs(pick); }} onDismiss={f.dismissConflict} />
    </>
  );
}
