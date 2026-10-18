import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { SettingsProvider } from '../../client/src/components/SettingsProvider.jsx';
import { Today } from '../../client/src/screens/today/Today.jsx';

const json = b => new Response(JSON.stringify(b), { status: 200 });
let taskCalls;
function stub({ places, spaces = [], tasks = [] }) {
  taskCalls = [];
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (url === '/api/settings') return json({ language: 'en', time_zone: 'UTC', units: 'us' });
    if (url === '/api/places') return json(places);
    if (url.startsWith('/api/spaces?place_id=')) return json(spaces);
    if (url.startsWith('/api/tasks?')) { taskCalls.push(url); return json(typeof tasks === 'function' ? tasks(url) : tasks); }
    return json([]);
  }));
}
const HOME = { id: 1, name: 'Home', status: 'current', zone: '8a', hemisphere: 'north', last_frost: '03-20', first_frost: '11-10', frost_free: 0, wet_months: [], time_zone: 'UTC', sort_order: 0 };
const tk = (id, kind, due_on, space, extra = {}) => ({ id, planting_id: 9, kind, title: null, due_on, end_on: null, done_on: null, guide: null, notes: null, version: 1,
  plant: { id: 1, name: 'Tomato', starter_key: null, is_starter: 0 }, variety_name: null, space, planting: { id: 9, status: 'planned' }, ...extra });
const BED = { id: 5, name: 'North bed' };
const POTS = { id: 6, name: 'Patio pots' };
const at = iso => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };
const sectionTasks = name => within(screen.getByRole('region', { name })).getAllByRole('checkbox').map(c => c.closest('li').querySelector('.task-check span').textContent);
function mount() {
  const router = createMemoryRouter([{ path: '/', element: <SettingsProvider><Today /></SettingsProvider> }], { initialEntries: ['/'] });
  render(<RouterProvider router={router} />);
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Today', () => {
  it('welcomes a new gardener with no places', async () => {
    stub({ places: [] });
    mount();
    expect(await screen.findByText("Start by adding the place where you'll garden.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a place' })).toHaveAttribute('href', '/places/new');
  });

  it('asks which place is current when none is', async () => {
    stub({ places: [{ id: 1, name: 'Later', status: 'future', sort_order: 0, frost_free: 0, wet_months: [] }] });
    mount();
    expect(await screen.findByText('Which place are you gardening at now?')).toBeInTheDocument();
  });

  it('shows the current place and counts to the next frost', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-02-25T15:00:00Z'));
    stub({
      places: [{ id: 1, name: 'Home', status: 'current', zone: '8a', hemisphere: 'north', last_frost: '03-20', first_frost: '11-10', frost_free: 0, wet_months: [], time_zone: 'America/Chicago', sort_order: 0 }],
      spaces: [{ id: 5, name: 'Bed 1', kind: 'bed' }, { id: 6, name: 'Pot', kind: 'container' }],
    });
    mount();
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByText('Last spring frost in 23 days, around March 20.')).toBeInTheDocument();
    expect(screen.getByText('Zone 8a')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '2 growing spaces' })).toHaveAttribute('href', '/spaces?place=1');
  });

  it('shows the rainy season for a frost-free place', async () => {
    stub({ places: [{ id: 1, name: 'Valley', status: 'current', frost_free: 1, wet_months: [6, 7, 8, 9, 10], hemisphere: 'north', sort_order: 0 }] });
    mount();
    expect(await screen.findByText('Frost-free. Rainy season: June, July, August, September, October.')).toBeInTheDocument();
  });

  it('reminds about missing frost dates', async () => {
    stub({ places: [{ id: 1, name: 'Home', status: 'current', frost_free: 0, wet_months: [], hemisphere: 'north', sort_order: 0 }] });
    mount();
    expect(await screen.findByText('Add both frost dates so the app can work out planting times.')).toBeInTheDocument();
  });

  it('moves on to the new day when the window is shown again after midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-02-25T15:00:00Z'));
    stub({ places: [{ id: 1, name: 'Home', status: 'current', zone: '8a', hemisphere: 'north', last_frost: '03-20', first_frost: '11-10', frost_free: 0, wet_months: [], time_zone: 'UTC', sort_order: 0 }] });
    mount();
    expect(await screen.findByText('Last spring frost in 23 days, around March 20.')).toBeInTheDocument();
    vi.setSystemTime(new Date('2027-02-26T08:00:00Z'));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(await screen.findByText('Last spring frost in 22 days, around March 20.')).toBeInTheDocument();
  });

  it('overdue tasks come first, then today, then this week, grouped by space', async () => {
    at('2027-03-10T12:00:00Z');
    stub({ places: [HOME], tasks: [
      tk(1, 'pot_up', '2027-03-03', BED), tk(2, 'harden_off', '2027-03-10', POTS), tk(3, 'sow', '2027-03-10', BED), tk(4, 'feed', '2027-03-14', BED),
    ] });
    mount();
    const regions = (await screen.findAllByRole('region')).map(r => r.getAttribute('aria-label') ?? r.querySelector('h2')?.textContent);
    expect(regions.slice(0, 3)).toEqual(['Overdue', 'Today', 'This week']);
    expect(sectionTasks('Overdue')).toEqual(['Pot up · Tomato']);
    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(today).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['North bed', 'Patio pots']);
    expect(sectionTasks('This week')).toEqual(['Feed · Tomato']);
    expect(taskCalls[0]).toBe('/api/tasks?place_id=1&from=2027-03-10&to=2027-03-16&open=1');
  });

  it('a task finished today moves to Done today', async () => {
    at('2027-03-10T12:00:00Z');
    stub({ places: [HOME], tasks: [tk(1, 'pot_up', '2027-03-03', BED, { done_on: '2027-03-10' })] });
    mount();
    await screen.findByRole('region', { name: 'Done today' });
    expect(sectionTasks('Done today')).toEqual(['Pot up · Tomato']);
    expect(screen.queryByRole('region', { name: 'Overdue' })).toBeNull();
  });

  it('harvest windows that include today are listed', async () => {
    at('2027-06-15T12:00:00Z');
    stub({ places: [HOME], tasks: [tk(1, 'harvest', '2027-06-10', BED, { end_on: '2027-07-05' })] });
    mount();
    expect(await screen.findByRole('region', { name: 'Harvest windows open now' })).toBeInTheDocument();
    expect(sectionTasks('Harvest windows open now')).toEqual(['Harvest window · Tomato']);
  });

  it('no tasks shows the empty state with Plan a planting', async () => {
    stub({ places: [HOME], tasks: [] });
    mount();
    expect(await screen.findByText('Nothing to do today.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Plan a planting' })).toHaveAttribute('href', '/plantings/new?place=1');
    expect(screen.getByRole('link', { name: 'Supplies for the next few weeks' })).toHaveAttribute('href', '/supplies?place=1');
  });

  it('the lists roll over at midnight in the place time zone', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2027-03-10T23:59:30Z'));
    stub({ places: [HOME], tasks: [] });
    mount();
    await vi.waitFor(() => expect(taskCalls).toContain('/api/tasks?place_id=1&from=2027-03-10&to=2027-03-16&open=1'));
    await act(async () => { vi.setSystemTime(new Date('2027-03-11T00:00:30Z')); vi.advanceTimersByTime(60000); });
    await vi.waitFor(() => expect(taskCalls).toContain('/api/tasks?place_id=1&from=2027-03-11&to=2027-03-17&open=1'));
  });
});
