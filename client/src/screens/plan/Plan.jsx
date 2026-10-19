import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { LoadState } from '../../components/LoadState.jsx';
import { Select } from '../../components/Field.jsx';
import { ReorderButtons } from '../../components/ReorderButtons.jsx';
import { useToast } from '../../components/ToastProvider.jsx';
import { useSettings } from '../../components/SettingsProvider.jsx';
import { useResource } from '../../lib/useResource.js';
import { useReorder } from '../../lib/useReorder.js';
import { useToday } from '../../lib/useToday.js';
import { api } from '../../lib/api.js';
import { errorText } from '../../lib/errors.js';
import { starterText } from '../../lib/starter.js';
import { qtyText } from '../../lib/harvests.js';
import { unitLabel } from '../../lib/units.js';
import { useT } from '../../i18n/I18nProvider.jsx';
import { GoalDialog } from './GoalDialog.jsx';
import { ToBuy } from './ToBuy.jsx';

const M_PER_FT = 0.3048;

// A row length to plant: whole feet (rounded up) in US units, half meters in metric. `meters` is what the
// planting form gets, matching the number shown.
export function rowFor(m, units) {
  if (units === 'metric') return { shown: m, meters: m };
  const ft = Math.ceil(m / M_PER_FT - 1e-9);
  return { shown: ft, meters: Math.round(ft * M_PER_FT * 10000) / 10000 };
}

const plantingLink = (g, units) => {
  const s = g.suggestion;
  const q = new URLSearchParams({ plant: String(g.plant_id) });
  if (s?.per === 'plant') q.set('count', String(s.amount));
  if (s?.per === 'meter') q.set('row', String(rowFor(s.amount, units).meters));
  q.set('year', String(g.year));
  return `/plantings/new?${q}`;
};

function yieldText(y, g, units, t) {
  const unit = g.goal_kind === 'raw' && g.unit === 'count' ? 'count' : 'kg';
  const per = y.per === 'meter' ? t('plan.per.meter', { unit: units === 'metric' ? 'm' : 'ft' }) : t('plan.per.plant');
  // A per-meter yield shows per foot in US units.
  const amount = y.per === 'meter' && units !== 'metric' ? y.amount * M_PER_FT : y.amount;
  return { amount: qtyText(amount, unit, units, t), per };
}

// Starter forms often name their jar ("Quart of sauce"), so those read "24 × Quart of sauce".
const preserveText = (g, t) => (g.preserve.form.toLowerCase().startsWith(g.preserve.unit.toLowerCase())
  ? t('plan.goal.preserveNamed', { n: g.amount, form: g.preserve.form })
  : t('plan.goal.preserve', { n: g.amount, unit: g.preserve.unit, form: g.preserve.form }));

function GoalLine({ g, index, count, units, onEdit, onDelete, onMove }) {
  const { t, tc } = useT();
  const name = starterText(tc, g.plant, 'name', g.plant.name);
  const s = g.suggestion;
  const goal = g.goal_kind === 'preserve'
    ? (g.preserve ? preserveText(g, t) : t('plan.goal.missingForm', { n: g.amount }))
    : qtyText(g.amount, g.unit === 'count' ? 'count' : 'kg', units, t);
  let about = null;
  if (s?.per === 'plant') about = t('plan.about.plant', { n: s.amount, count: s.amount });
  if (s?.per === 'meter') about = t('plan.about.meter', { n: rowFor(s.amount, units).shown, unit: unitLabel('length', units) });
  const yields = s?.yields ? ['library', 'last_year'].filter(k => s.yields[k]).map(k => t(`plan.yield.${k}`, yieldText(s.yields[k], g, units, t))) : [];
  return (
    <li>
      <span className="grow">
        <strong>{name}</strong> · <span>{goal}</span>
        <br />
        {about ? <span>{about}</span> : <span className="note">{t(`plan.needs.${s?.needs ?? 'yield'}`)}</span>}
        {yields.length > 0 && <><br /><span className="muted small">{yields.join(' · ')}</span></>}
        {g.notes && <><br /><span className="muted">{g.notes}</span></>}
      </span>
      <Button as={Link} size="sm" variant="ghost" to={plantingLink(g, units)}>{t('plan.planPlantings')}</Button>
      <Button size="sm" variant="ghost" icon={Pencil} aria-label={t('plan.editOne', { name })} onClick={() => onEdit(g)} />
      <Button size="sm" variant="ghost" icon={Trash2} aria-label={t('plan.deleteOne', { name })} onClick={() => onDelete(g)} />
      <ReorderButtons index={index} count={count} onMove={onMove} label={name} />
    </li>
  );
}

function Goals({ year }) {
  const { t } = useT();
  const toast = useToast();
  const { settings } = useSettings();
  const units = settings?.units ?? 'us';
  const goals = useResource(`/api/goals?year=${year}`);
  const extra = useMemo(() => ({ year: Number(year) }), [year]);
  const move = useReorder(goals, '/api/goals', extra);
  const [editing, setEditing] = useState(null);
  const remove = async g => {
    try { await goals.act(() => api.del(`/api/goals/${g.id}`)); toast.show({ message: t('plan.deleted') }); } catch (err) { toast.show({ message: errorText(err, t) }); }
  };
  return (
    <LoadState loading={goals.loading && !goals.data} error={goals.error} keepChildren={Boolean(goals.data)} onRetry={goals.reload}>
      <p className="muted">{t('plan.rough')}</p>
      {goals.data?.length === 0 && <p className="muted">{t('plan.none', { year })}</p>}
      <ul className="list">
        {goals.data?.map((g, i) => <GoalLine key={g.id} g={g} index={i} count={goals.data.length} units={units} onEdit={setEditing} onDelete={remove} onMove={move} />)}
      </ul>
      <Button variant="ghost" icon={Plus} onClick={() => setEditing({})}>{t('plan.addGoal')}</Button>
      {editing && <GoalDialog year={Number(year)} record={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); goals.reload(); }} />}
    </LoadState>
  );
}

// Winter planning: pantry goals for a year and what they mean in plants, plus what to buy.
export function Plan() {
  const { t } = useT();
  const { settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const today = useToday(settings?.time_zone);
  const thisYear = Number(today.slice(0, 4));
  const year = /^\d{4}$/.test(params.get('year') ?? '') ? params.get('year') : String(thisYear + 1);
  const tab = params.get('tab') === 'to-buy' ? 'to-buy' : 'goals';
  const set = (k, v) => { const next = new URLSearchParams(params); next.set(k, v); setParams(next, { replace: true }); };
  const years = [...new Set([thisYear, thisYear + 1, thisYear + 2, Number(year)])].sort().map(String);
  return (
    <>
      <PageHeader title={t('nav.plan')} />
      <div className="tabs" role="tablist" aria-label={t('nav.plan')}>
        {[['goals', 'plan.tab.goals'], ['to-buy', 'plan.tab.toBuy']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' is-active' : ''}`} onClick={() => set('tab', k)}>{t(label)}</button>
        ))}
      </div>
      <div className="filters">
        <label className="inline-field">{t('plan.year')}{' '}
          <Select aria-label={t('plan.year')} value={year} onChange={e => set('year', e.target.value)} options={years.map(y => ({ value: y, label: y }))} />
        </label>
      </div>
      {tab === 'to-buy' ? <ToBuy year={year} /> : <Goals year={year} />}
    </>
  );
}
