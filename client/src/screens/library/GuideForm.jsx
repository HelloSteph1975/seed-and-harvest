import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Field, TextInput, TextArea, Select } from '../../components/Field.jsx';
import { ListEditor, withKeys } from '../../components/ListEditor.jsx';
import { ConflictDialog } from '../../components/ConflictDialog.jsx';
import { useResource } from '../../lib/useResource.js';
import { useRecordForm } from '../../lib/useRecordForm.js';
import { api } from '../../lib/api.js';
import { starterText } from '../../lib/starter.js';
import { useT } from '../../i18n/I18nProvider.jsx';
import { STAGE_ORDER } from './PlantPage.jsx';

const MAX_STEPS = 40;
const MAX_SUPPLIES = 30;

const pickWith = presetPlant => g => ({
  title: g?.title ?? '',
  summary: g?.summary ?? '',
  stage: g?.stage ?? 'general',
  plant_id: g ? (g.plant_id == null ? '' : String(g.plant_id)) : (presetPlant ?? ''),
  basics_id: g?.basics_id == null ? '' : String(g.basics_id),
  steps: withKeys((g?.steps ?? ['']).map(text => ({ text }))),
  supplies: withKeys((g?.supplies ?? []).map(s => ({ name: s.name, amount: s.amount ?? '' }))),
});

const toBody = v => ({
  title: v.title, summary: v.summary, stage: v.stage,
  plant_id: v.plant_id ? Number(v.plant_id) : null,
  basics_id: v.plant_id && v.basics_id ? Number(v.basics_id) : null,
  steps: v.steps.map(s => s.text),
  supplies: v.supplies.map(s => ({ name: s.name, amount: s.amount })),
});

export function GuideFormRoute() {
  const { id } = useParams();
  return <GuideFormLoader key={id ?? 'new'} id={id} />;
}

function GuideFormLoader({ id }) {
  const { t, ready } = useT();
  const [params] = useSearchParams();
  const guide = useResource(id ? `/api/guides/${id}` : null);
  const plants = useResource('/api/plants');
  const basics = useResource('/api/guides');
  const ok = (!id || guide.data) && plants.data && basics.data && ready;
  const error = guide.error ?? plants.error ?? basics.error;
  const [created, setCreated] = useState(false);
  return (
    <>
      <PageHeader title={id || created ? t('guides.edit') : t('guides.new')} />
      <LoadState loading={!ok} error={ok ? null : error} onRetry={() => { if (id) guide.reload(); plants.reload(); basics.reload(); }}>
        {ok && <GuideForm record={id ? guide.data : null} plants={plants.data} basics={basics.data.filter(b => String(b.id) !== id)}
          presetPlant={params.get('plant')} onCreated={setCreated} />}
      </LoadState>
      {!ok && error && <p><Link to="/library?tab=guides">{t('guides.backToGuides')}</Link></p>}
    </>
  );
}

function GuideForm({ record, plants, basics, presetPlant, onCreated }) {
  const { t, tc } = useT();
  const navigate = useNavigate();
  const [pick] = useState(() => pickWith(plants.some(p => String(p.id) === presetPlant) ? presetPlant : null));
  const [initial] = useState(() => pick(record));
  const [target, setTarget] = useState(record ? { id: record.id, version: record.version } : null);
  const submit = useCallback(async (v, { version: forced }) => {
    const body = toBody(v);
    const out = target
      ? await api.patch(`/api/guides/${target.id}`, { ...body, version: forced ?? target.version })
      : await api.post('/api/guides', body);
    if (!target) onCreated(true);
    setTarget({ id: out.id, version: out.version });
    return out;
  }, [target, onCreated]);
  const f = useRecordForm({ initial, submit });
  const v = f.values;
  const done = out => { if (out && !f.isDirtyNow()) navigate(`/library/guides/${out.id}`); };
  const save = async e => done(await f.onSubmit(e));
  const keep = async () => done(await f.keepMine());
  const takeTheirs = () => { setTarget(s => ({ ...s, version: f.conflict.version })); f.takeTheirs(pick); };
  const cancel = () => navigate(target ? `/library/guides/${target.id}` : (v.plant_id ? `/library/plants/${v.plant_id}` : '/library?tab=guides'));
  const canSave = Boolean(v.title.trim()) && v.steps.some(s => s.text.trim()) && (!record || f.dirty);
  const stepLabel = (item, i) => t('guides.step', { n: i + 1 });
  const supplyLabel = (item, i) => item.name || t('guides.supply', { n: i + 1 });

  return (
    <>
      <form className="entry-form guide-form" onSubmit={save}>
        <fieldset disabled={f.saving}>
          <Field label={t('guides.title')} error={f.errors.title}><TextInput value={v.title} onChange={e => f.set('title', e.target.value)} maxLength={120} /></Field>
          <Field label={t('guides.summary')} error={f.errors.summary}><TextArea value={v.summary} onChange={e => f.set('summary', e.target.value)} rows={2} maxLength={600} /></Field>
          <Field label={t('guides.stageLabel')} error={f.errors.stage}>
            <Select value={v.stage} onChange={e => f.set('stage', e.target.value)} options={STAGE_ORDER.map(s => ({ value: s, label: t(`guides.stage.${s}`) }))} />
          </Field>
          <Field label={t('guides.plant')} error={f.errors.plant_id} hint={t('guides.plantHint')}>
            <Select value={v.plant_id} onChange={e => f.set('plant_id', e.target.value)} placeholder={t('guides.noPlant')}
              options={plants.map(p => ({ value: String(p.id), label: starterText(tc, p, 'name', p.name) }))} />
          </Field>
          {v.plant_id && (
            <Field label={t('guides.basicsLink')} error={f.errors.basics_id}>
              <Select value={v.basics_id} onChange={e => f.set('basics_id', e.target.value)} placeholder={t('guides.noBasics')}
                options={basics.map(b => ({ value: String(b.id), label: starterText(tc, b, 'title', b.title) }))} />
            </Field>
          )}
          <fieldset className="field field-group">
            <legend>{t('guides.supplies')}</legend>
            <ListEditor items={v.supplies} onChange={list => f.set('supplies', list)} blank={() => ({ name: '', amount: '' })} max={MAX_SUPPLIES}
              addLabel={t('guides.addSupply')} itemLabel={supplyLabel}
              renderItem={(item, i, update) => (
                <>
                  <Field label={t('guides.supplyName', { n: i + 1 })} className="supply-name"><TextInput value={item.name} onChange={e => update({ name: e.target.value })} maxLength={120} /></Field>
                  <Field label={t('guides.supplyAmount', { n: i + 1 })} className="supply-amount"><TextInput value={item.amount} onChange={e => update({ amount: e.target.value })} maxLength={80} /></Field>
                </>
              )} />
            {f.errors.supplies && <small className="field-error" role="alert">{f.errors.supplies}</small>}
          </fieldset>
          <fieldset className="field field-group">
            <legend>{t('guides.steps')}</legend>
            <ListEditor items={v.steps} onChange={list => f.set('steps', list)} blank={() => ({ text: '' })} max={MAX_STEPS}
              addLabel={t('guides.addStep')} itemLabel={stepLabel}
              renderItem={(item, i, update) => (
                <Field label={stepLabel(item, i)} className="guide-step"><TextArea value={item.text} onChange={e => update({ text: e.target.value })} rows={2} maxLength={1000} /></Field>
              )} />
            {f.errors.steps && <small className="field-error" role="alert">{f.errors.steps}</small>}
          </fieldset>
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
