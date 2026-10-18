import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Dialog } from '../../components/Dialog.jsx';
import { Field, TextInput, TextArea, Select } from '../../components/Field.jsx';
import { ConflictDialog } from '../../components/ConflictDialog.jsx';
import { useToast } from '../../components/ToastProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { useRecordForm } from '../../lib/useRecordForm.js';
import { api } from '../../lib/api.js';
import { errorText } from '../../lib/errors.js';
import { useT } from '../../i18n/I18nProvider.jsx';

const KINDS = ['goat', 'chicken', 'other'];

export function Animals() {
  const { t } = useT();
  const toast = useToast();
  const list = useResource('/api/animals');
  const [editing, setEditing] = useState(null);
  const remove = async a => {
    try {
      await list.act(() => api.del(`/api/animals/${a.id}`));
      toast.show({ message: t('animals.deleted', { name: a.name }), duration: 8000,
        action: { label: t('common.undo'), onClick: () => list.act(() => api.post(`/api/animals/${a.id}/restore`)).catch(err => toast.show({ message: errorText(err, t) })) } });
    } catch (err) { toast.show({ message: errorText(err, t) }); }
  };
  return (
    <>
      <PageHeader title={t('animals.title')}>
        <Button icon={Plus} onClick={() => setEditing({})}>{t('animals.add')}</Button>
      </PageHeader>
      <p className="muted">{t('animals.intro')}</p>
      <LoadState loading={list.loading && !list.data} error={list.error} keepChildren={Boolean(list.data)} onRetry={list.reload}>
        {list.data?.length === 0 && <p className="muted">{t('animals.none')}</p>}
        <ul className="list">
          {list.data?.map(a => (
            <li key={a.id}>
              <span className="grow"><strong>{a.name}</strong> <span className="muted">{t(`animals.kind.${a.kind}`)}</span>
                {a.notes && <><br /><span className="muted">{a.notes}</span></>}</span>
              <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('animals.editOne', { name: a.name })} onClick={() => setEditing(a)} />
              <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('animals.deleteOne', { name: a.name })} onClick={() => remove(a)} />
            </li>
          ))}
        </ul>
      </LoadState>
      <p><Link to="/microgreens">{t('trays.back')}</Link></p>
      {editing && <AnimalDialog record={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </>
  );
}

const pick = a => ({ name: a?.name ?? '', kind: a?.kind ?? 'goat', notes: a?.notes ?? '' });

function AnimalDialog({ record, onClose, onSaved }) {
  const { t } = useT();
  const [target, setTarget] = useState(record ? { id: record.id, version: record.version } : null);
  const [initial] = useState(() => pick(record));
  const submit = useCallback(async (v, { version: forced }) => {
    const out = target
      ? await api.patch(`/api/animals/${target.id}`, { ...v, version: forced ?? target.version })
      : await api.post('/api/animals', v);
    setTarget({ id: out.id, version: out.version });
    return out;
  }, [target]);
  const f = useRecordForm({ initial, submit });
  const save = async e => { if (await f.onSubmit(e)) onSaved(); };
  const keep = async () => { if (await f.keepMine()) onSaved(); };
  return (
    <>
      <Dialog open onClose={onClose} title={record ? t('animals.editOne', { name: record.name }) : t('animals.add')}
        footer={<>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="animal-form" disabled={f.saving || !f.values.name.trim() || (record && !f.dirty)}>{f.saving ? t('common.saving') : t('common.save')}</Button>
        </>}>
        <form id="animal-form" onSubmit={save}>
          <fieldset disabled={f.saving}>
            <Field label={t('animals.name')} error={f.errors.name}><TextInput value={f.values.name} onChange={e => f.set('name', e.target.value)} maxLength={60} /></Field>
            <Field label={t('animals.kindLabel')} error={f.errors.kind} hint={t(`animals.kindHint.${f.values.kind}`)}>
              <Select value={f.values.kind} onChange={e => f.set('kind', e.target.value)} options={KINDS.map(k => ({ value: k, label: t(`animals.kind.${k}`) }))} />
            </Field>
            <Field label={t('animals.notes')} error={f.errors.notes}><TextArea value={f.values.notes} onChange={e => f.set('notes', e.target.value)} rows={3} maxLength={2000} /></Field>
          </fieldset>
          {f.formError && <p className="form-error" role="alert">{f.formError}</p>}
        </form>
      </Dialog>
      <ConflictDialog conflict={f.conflict} onKeepMine={keep} onTakeTheirs={() => { setTarget(s => ({ ...s, version: f.conflict.version })); f.takeTheirs(pick); }} onDismiss={f.dismissConflict} />
    </>
  );
}
