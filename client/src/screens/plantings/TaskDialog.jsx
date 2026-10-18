import { useCallback, useState } from 'react';
import { Dialog } from '../../components/Dialog.jsx';
import { Button } from '../../components/Button.jsx';
import { Field, TextInput, TextArea, DateInput } from '../../components/Field.jsx';
import { ConflictDialog } from '../../components/ConflictDialog.jsx';
import { useRecordForm } from '../../lib/useRecordForm.js';
import { api } from '../../lib/api.js';
import { taskTitle } from '../../lib/tasks.js';
import { useT } from '../../i18n/I18nProvider.jsx';

const pick = x => ({ title: x?.title ?? '', due_on: x?.due_on ?? '', end_on: x?.end_on ?? '', notes: x?.notes ?? '' });

// Add a task of the owner's own, or change the date, window, name or notes of any task.
export function TaskDialog({ plantingId, record, today, onClose, onSaved }) {
  const { t } = useT();
  const [target, setTarget] = useState(record ? { id: record.id, version: record.version } : null);
  const [initial] = useState(() => pick(record ?? { due_on: today }));
  const submit = useCallback(async (v, { version: forced }) => {
    const body = { title: v.title || null, due_on: v.due_on, end_on: v.end_on || null, notes: v.notes };
    const out = target
      ? await api.patch(`/api/tasks/${target.id}`, { ...body, version: forced ?? target.version })
      : await api.post(`/api/plantings/${plantingId}/tasks`, body);
    setTarget({ id: out.id, version: out.version });
    return out;
  }, [target, plantingId]);
  const f = useRecordForm({ initial, submit });
  const v = f.values;
  const save = async e => { if (await f.onSubmit(e)) onSaved(); };
  const keep = async () => { if (await f.keepMine()) onSaved(); };
  const named = !record || record.kind === 'other';
  const canSave = Boolean(v.due_on) && (!named || Boolean(v.title.trim())) && (!record || f.dirty);
  return (
    <>
      <Dialog open onClose={onClose} title={record ? t('tasks.editOne', { name: taskTitle(record, t) }) : t('tasks.add')}
        footer={<>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="task-form" disabled={f.saving || !canSave}>{f.saving ? t('common.saving') : t('common.save')}</Button>
        </>}>
        <form id="task-form" onSubmit={save}>
          <fieldset disabled={f.saving}>
            <Field label={named ? t('tasks.name') : t('tasks.nameOptional')} error={f.errors.title} hint={named ? undefined : t('tasks.nameHint', { name: taskTitle({ kind: record.kind }, t) })}>
              <TextInput value={v.title} onChange={e => f.set('title', e.target.value)} maxLength={120} />
            </Field>
            <Field label={record?.end_on || record?.kind === 'harvest' ? t('tasks.from') : t('tasks.due')} error={f.errors.due_on}>
              <DateInput value={v.due_on} onChange={e => f.set('due_on', e.target.value)} />
            </Field>
            {(record?.end_on || record?.kind === 'harvest') && (
              <Field label={t('tasks.to')} error={f.errors.end_on}><DateInput value={v.end_on} onChange={e => f.set('end_on', e.target.value)} /></Field>
            )}
            <Field label={t('tasks.notes')} error={f.errors.notes}><TextArea value={v.notes} onChange={e => f.set('notes', e.target.value)} rows={3} maxLength={2000} /></Field>
          </fieldset>
          {record?.auto === 1 && record.edited === 0 && <p className="muted small">{t('tasks.autoNote')}</p>}
          {f.formError && <p className="form-error" role="alert">{f.formError}</p>}
        </form>
      </Dialog>
      <ConflictDialog conflict={f.conflict} onKeepMine={keep} onTakeTheirs={() => { setTarget(s => ({ ...s, version: f.conflict.version })); f.takeTheirs(pick); }} onDismiss={f.dismissConflict} />
    </>
  );
}
