import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet, useLocation } from 'react-router-dom';
import { ToastProvider } from '../../client/src/components/ToastProvider.jsx';
import { SettingsProvider } from '../../client/src/components/SettingsProvider.jsx';
import { Calendar } from '../../client/src/screens/calendar/Calendar.jsx';
import { Supplies } from '../../client/src/screens/supplies/Supplies.jsx';

const json = b => new Response(JSON.stringify(b), { status: 200 });
const HOME = { id: 1, name: 'Home', status: 'current', zone: '8a', hemisphere: 'north', last_frost: '03-20', first_frost: '11-10', frost_free: 0, wet_months: [], time_zone: 'UTC', sort_order: 0 };
const tk = (id, kind, due_on, extra = {}) => ({ id, planting_id: 9, kind, title: null, due_on, end_on: null, done_on: null, notes: null, version: 1,
  guide: { id: 30, title: 'Starting tomatoes', starter_key: null, is_starter: 0 }, plant: { id: 1, name: 'Tomato', starter_key: null, is_starter: 0 },
  variety_name: null, space: { id: 5, name: 'North bed', sort_order: 0 }, planting: { id: 9, status: 'planned' }, ...extra });
let urls;
const SUPPLIES = [
  { name: 'Seed trays', starter_key: null, index: 1, items: [{ task_id: 1, task_kind: 'start_seeds', task_title: null, due_on: '2027-03-12', amount: null, plant: { name: 'Tomato', starter_key: null, is_starter: 0 } },
    { task_id: 2, task_kind: 'start_seeds', task_title: null, due_on: '2027-03-15', amount: '2 trays', plant: { name: 'Pepper', starter_key: null, is_starter: 0 } }] },
];
function stub() {
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async url => {
    urls.push(url);
    if (url === '/api/settings') return json({ language: 'en', time_zone: 'UTC', units: 'us' });
    if (url === '/api/places') return json([HOME]);
    if (url.startsWith('/api/tasks?')) return json([tk(1, 'start_seeds', '2027-03-12'), tk(2, 'harvest', '2027-03-25', { end_on: '2027-04-20' })]);
    if (url.startsWith('/api/supplies?')) return json(SUPPLIES);
    return json([]);
  }));
}
let where;
function Spy() { where = useLocation(); return null; }
function mount(path) {
  const router = createMemoryRouter([{
    element: <SettingsProvider><ToastProvider><Outlet /><Spy /></ToastProvider></SettingsProvider>,
    children: [{ path: '/calendar', element: <Calendar /> }, { path: '/supplies', element: <Supplies /> }],
  }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const at = iso => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${iso}T12:00:00Z`)); };

describe('calendar', () => {
  it('the month shows tasks on their days and frost dates marked', async () => {
    at('2027-03-05');
    stub();
    mount('/calendar');
    expect(await screen.findByRole('heading', { name: 'March 2027' })).toBeInTheDocument();
    const day12 = await screen.findByRole('button', { name: /Friday, March 12, 2027/ });
    expect(within(day12).getByText('Start seeds · Tomato')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Saturday, March 20, 2027/ })).getByText('Last spring frost')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Thursday, March 25, 2027/ })).getByText('Harvest window opens · Tomato')).toBeInTheDocument();
    expect(urls).toContain('/api/tasks?place_id=1&from=2027-03-01&to=2027-04-04');
  });

  it('a day panel lists that day\'s tasks with guide links', async () => {
    at('2027-03-05');
    stub();
    mount('/calendar');
    await userEvent.click(await screen.findByRole('button', { name: /Friday, March 12, 2027/ }));
    const panel = screen.getByRole('region', { name: 'Friday, March 12, 2027' });
    expect(within(panel).getByRole('link', { name: 'Starting tomatoes' })).toHaveAttribute('href', '/library/guides/30');
    expect(within(panel).getByRole('link', { name: /Tomato/ })).toHaveAttribute('href', '/plantings/9');
  });

  it('next and previous month keep the view in the address', async () => {
    at('2027-03-05');
    stub();
    mount('/calendar?view=list');
    await screen.findByRole('heading', { name: 'March 2027' });
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByRole('heading', { name: 'April 2027' })).toBeInTheDocument();
    expect(where.search).toContain('view=list');
    expect(where.search).toContain('month=2027-04');
  });

  it('the list view groups by day', async () => {
    at('2027-03-05');
    stub();
    mount('/calendar?view=list');
    expect(await screen.findByRole('heading', { name: 'Friday, March 12' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Saturday, March 20' })).toBeInTheDocument();
  });
});

describe('supplies', () => {
  it('supplies show each name once with its tasks', async () => {
    at('2027-03-10');
    stub();
    mount('/supplies');
    expect(await screen.findByText('Seed trays')).toBeInTheDocument();
    expect(screen.getByText(/Pepper/)).toBeInTheDocument();
    expect(screen.getByText(/2 trays/)).toBeInTheDocument();
    expect(urls).toContain('/api/supplies?place_id=1&from=2027-03-10&to=2027-04-06');
  });

  it('changing weeks reloads the list', async () => {
    at('2027-03-10');
    stub();
    mount('/supplies');
    await screen.findByText('Seed trays');
    await userEvent.selectOptions(screen.getByLabelText('How far ahead'), '2');
    await vi.waitFor(() => expect(urls).toContain('/api/supplies?place_id=1&from=2027-03-10&to=2027-03-23'));
    expect(where.search).toContain('weeks=2');
  });
});
