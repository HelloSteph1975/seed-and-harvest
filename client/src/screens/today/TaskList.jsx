import { Link } from 'react-router-dom';
import { LoadState } from '../../components/LoadState.jsx';
import { useResource } from '../../lib/useResource.js';
import { addDays } from '../../lib/tasks.js';
import { useT } from '../../i18n/I18nProvider.jsx';
import { TaskLine, useToggleTask } from '../plantings/PlantingPage.jsx';

// Splits the week's tasks into what Today shows. A harvest window open now gets its own list;
// anything not done whose day (or window) ended before today is overdue.
export function sortTasks(tasks, today) {
  const weekEnd = addDays(today, 6);
  const out = { overdue: [], today: [], harvest: [], week: [], done: [] };
  for (const x of tasks) {
    if (x.done_on) { if (x.done_on === today) out.done.push(x); continue; }
    const last = x.end_on ?? x.due_on;
    if (last < today) out.overdue.push(x);
    else if (x.kind === 'harvest' && x.due_on <= today) out.harvest.push(x);
    else if (x.due_on <= today) out.today.push(x);
    else if (x.due_on <= weekEnd) out.week.push(x);
  }
  return out;
}

// Lines grouped under their space, spaces in the owner's order.
function BySpace({ tasks, today, onToggle }) {
  const groups = [];
  for (const x of tasks) {
    const g = groups.find(y => y.space.id === x.space.id);
    if (g) g.rows.push(x); else groups.push({ space: x.space, rows: [x] });
  }
  groups.sort((a, b) => (a.space.sort_order ?? 0) - (b.space.sort_order ?? 0) || a.space.name.localeCompare(b.space.name));
  return groups.map(g => (
    <div key={g.space.id} className="task-space">
      <h3><Link to={`/spaces/${g.space.id}`}>{g.space.name}</Link></h3>
      <ul className="list tasks">{g.rows.map(x => <TaskLine key={x.id} task={x} today={today} onToggle={onToggle} showPlant />)}</ul>
    </div>
  ));
}

const SECTIONS = [['overdue', 'today.overdue'], ['today', 'today.today'], ['harvest', 'today.harvestOpen'], ['week', 'today.thisWeek'], ['done', 'today.doneToday']];

export function TaskList({ place, today }) {
  const { t } = useT();
  const tasks = useResource(`/api/tasks?place_id=${place.id}&from=${today}&to=${addDays(today, 6)}&open=1`);
  const toggle = useToggleTask(tasks.reload);
  const parts = sortTasks(tasks.data ?? [], today);
  const empty = tasks.data && !parts.overdue.length && !parts.today.length && !parts.harvest.length;
  return (
    <LoadState loading={tasks.loading && !tasks.data} error={tasks.error} keepChildren={Boolean(tasks.data)} onRetry={tasks.reload}>
      {empty && (
        <section className="card">
          <p>{t('today.nothing')}</p>
          <p><Link to={`/plantings/new?place=${place.id}`}>{t('plantings.add')}</Link></p>
        </section>
      )}
      {SECTIONS.filter(([k]) => parts[k].length).map(([k, label]) => (
        <section key={k} className={`today-tasks today-${k}`} aria-labelledby={`today-${k}`}>
          <h2 id={`today-${k}`}>{t(label)}</h2>
          <BySpace tasks={parts[k]} today={today} onToggle={(x, done) => toggle(x, done, today)} />
        </section>
      ))}
      {tasks.data && <p><Link to={`/supplies?place=${place.id}`}>{t('today.supplies')}</Link></p>}
    </LoadState>
  );
}
