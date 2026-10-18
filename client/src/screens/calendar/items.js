import { starterText } from '../../lib/starter.js';
import { taskTitle } from '../../lib/tasks.js';

// What the calendar shows on each day: tasks (a harvest window on its first day only) and the
// place's frost dates for every year in the range.
export function byDay(tasks, place, from, to, trays = []) {
  const days = new Map();
  const add = (day, item) => {
    if (day < from || day > to) return;
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(item);
  };
  if (place && !place.frost_free) {
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
      if (place.last_frost) add(`${y}-${place.last_frost}`, { kind: 'frost', frost: 'last', key: `last-${y}` });
      if (place.first_frost) add(`${y}-${place.first_frost}`, { kind: 'frost', frost: 'first', key: `first-${y}` });
    }
  }
  for (const task of tasks) add(task.due_on, { kind: 'task', task, key: `task-${task.id}` });
  for (const tray of trays) {
    if (tray.status === 'growing') add(tray.harvest_on, { kind: 'cut', tray, key: `cut-${tray.id}` });
    if (tray.status === 'planned') add(tray.sown_on, { kind: 'sow', tray, key: `plan-${tray.id}` });
    if (tray.next_sow_on) add(tray.next_sow_on, { kind: 'sow', tray, key: `sow-${tray.id}` });
  }
  return new Map([...days].sort(([a], [b]) => a.localeCompare(b)));
}

export function itemName(item, t, tc) {
  if (item.kind === 'cut' || item.kind === 'sow') {
    return t(item.kind === 'cut' ? 'calendar.cut' : 'calendar.sow', { crop: starterText(tc, item.tray.plant, 'name', item.tray.plant.name) });
  }
  if (item.kind === 'frost') return t(item.frost === 'last' ? 'calendar.lastFrost' : 'calendar.firstFrost');
  const { task } = item;
  const what = task.kind === 'harvest' && task.end_on ? t('calendar.harvestOpens') : taskTitle(task, t);
  return `${what} · ${starterText(tc, task.plant, 'name', task.plant.name)}`;
}

export const markClass = item => (item.kind === 'frost' ? 'cal-kind-frost' : item.kind === 'task' ? `cal-kind-task${item.task.done_on ? ' cal-done' : ''}` : 'cal-kind-tray');
