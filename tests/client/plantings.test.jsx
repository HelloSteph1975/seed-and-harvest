import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { ToastProvider } from '../../client/src/components/ToastProvider.jsx';
import { ConfirmProvider } from '../../client/src/components/ConfirmProvider.jsx';
import { LeaveGuardProvider } from '../../client/src/components/LeaveGuardProvider.jsx';
import { SettingsProvider } from '../../client/src/components/SettingsProvider.jsx';
import { Plantings } from '../../client/src/screens/plantings/Plantings.jsx';
import { PlantingFormRoute } from '../../client/src/screens/plantings/PlantingForm.jsx';
import { PlantingPageRoute } from '../../client/src/screens/plantings/PlantingPage.jsx';

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
let PLACES;
const PLANTS = [
  { id: 1, name: 'Tomato', kind: 'vegetable', perennial: 0, starter_key: 'plant.tomato', is_starter: 1 },
  { id: 3, name: 'Fig', kind: 'fruit_tree', perennial: 1, starter_key: null, is_starter: 0 },
];
const BASE = { companions: [], avoid: [], preserves: [], varieties: [], guides: [], frost_free_months: [], version: 1 };
const TOMATO = { ...BASE, ...PLANTS[0], start_indoors_min: 6, start_indoors_max: 8, transplant_min: 1, transplant_max: 2, days_min: 60, days_max: 85,
  varieties: [{ id: 11, name: 'Roma' }] };
const FIG = { ...BASE, ...PLANTS[1], transplant_min: 0, transplant_max: 4, zone_min: 8, zone_max: 11 };
const SPACES = [{ id: 5, place_id: 1, name: 'North bed', kind: 'bed' }];
const task = (id, kind, due_on, extra = {}) => ({ id, planting_id: 9, kind, title: null, due_on, end_on: null, done_on: null, guide_id: null, guide: null, notes: null, auto: 1, edited: 0, version: 1, ...extra });
let planting;
const freshPlanting = () => ({
  id: 9, space_id: 5, plant_id: 1, variety_id: 11, count: 4, row_m: null, how_started: 'seed_indoors', start_on: '2027-01-23', status: 'planned', notes: null, version: 1,
  plant: { id: 1, name: 'Tomato', kind: 'vegetable', starter_key: 'plant.tomato', is_starter: 1 }, variety: { id: 11, name: 'Roma' },
  space: { id: 5, name: 'North bed', kind: 'bed', place_id: 1 },
  tasks: [task(21, 'start_seeds', '2027-01-23', { guide_id: 30, guide: { id: 30, title: 'Starting tomatoes', starter_key: null, is_starter: 0 } }), task(22, 'harvest', '2027-06-01', { end_on: '2027-06-26' })],
  log: [],
});
let calls;
let pack;
let taskConflict;
function stub() {
  calls = [];
  pack = null;
  taskConflict = false;
  planting = freshPlanting();
  PLACES = [
    { id: 1, name: 'Home', status: 'current', hemisphere: 'north', zone: '7b', last_frost: '03-20', first_frost: '11-10', frost_free: 0, wet_months: [], time_zone: 'UTC', sort_order: 0 },
  ];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const m = opts.method ?? 'GET';
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ url, m, body });
    if (url === '/api/settings') return json({ language: pack ? 'es' : 'en', time_zone: 'UTC', units: 'us' });
    if (url.startsWith('/api/locales/')) return json(url.endsWith('/content') ? pack.content : pack.ui);
    if (url === '/api/places') return json(PLACES);
    if (url === '/api/spaces?place_id=2') return new Promise(() => {});
    if (url.startsWith('/api/spaces?')) return json(SPACES);
    if (url === '/api/plants') return json(PLANTS);
    if (url === '/api/plants/1') return json(TOMATO);
    if (url === '/api/plants/3') return json(FIG);
    if (url === '/api/plantings/preview') return json({ tasks: [{ kind: 'start_seeds', due_on: body.start_on, end_on: null, guide: { id: 30, title: 'Starting tomatoes' }, supplies: [] }, { kind: 'transplant', due_on: '2027-03-30', end_on: null, guide: null, supplies: [] }] });
    if (url.startsWith('/api/plantings?')) return json([{ ...planting, next_task: { id: 21, kind: 'start_seeds', title: null, due_on: '2027-01-23' }, cover: null }]);
    if (url === '/api/plantings' && m === 'POST') return json({ ...planting, ...body, id: 9 }, 201);
    if (url === '/api/plantings/9') return json(planting);
    if (url === '/api/tasks/21' && m === 'PATCH') {
      planting.tasks[0] = { ...planting.tasks[0], done_on: body.done_on, version: 2 };
      planting.log = [{ id: 40, planting_id: 9, on_date: body.done_on, kind: 'sowed', note: null, task_id: 21, version: 1 }];
      return json(planting.tasks[0]);
    }
    if (url === '/api/tasks/22' && m === 'PATCH') {
      if (taskConflict) return json({ error: 'conflict', code: 'conflict', current: { ...planting.tasks[1], notes: 'Theirs', version: 3 } }, 409);
      return json({ ...planting.tasks[1], ...body, version: 2 });
    }
    if (url.startsWith('/api/photos?')) return json([]);
    if (url.startsWith('/api/guides/')) return json({ id: 30, title: 'Starting tomatoes', steps: [], supplies: [{ name: 'Seed trays', amount: null }] });
    return json({}, 404);
  }));
}
function mount(path) {
  const router = createMemoryRouter([{
    element: <SettingsProvider><ToastProvider><ConfirmProvider><LeaveGuardProvider><Outlet /></LeaveGuardProvider></ConfirmProvider></ToastProvider></SettingsProvider>,
    children: [
      { path: '/plantings', element: <Plantings /> },
      { path: '/plantings/new', element: <PlantingFormRoute /> },
      { path: '/plantings/:id', element: <PlantingPageRoute /> },
      { path: '/plantings/:id/edit', element: <PlantingFormRoute /> },
    ],
  }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const at = iso => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${iso}T12:00:00Z`)); };

describe('plan a planting', () => {
  it('the form suggests the start-seeds window date and Use this date fills it', async () => {
    at('2027-01-10');
    stub();
    mount('/plantings/new?plant=1');
    expect(await screen.findByText(/Start seeds indoors: Jan 23 to Feb 6/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use this date' }));
    expect(screen.getByLabelText('Start date')).toHaveValue('2027-01-23');
  });

  it('with no last frost, the form asks for it and still accepts a typed date', async () => {
    at('2027-01-10');
    stub();
    PLACES[0].last_frost = null;
    mount('/plantings/new?plant=1');
    expect(await screen.findByText(/Add the last spring frost date/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Start date'), '2027-02-01');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.find(c => c.url === '/api/plantings' && c.m === 'POST')).toBeDefined());
    expect(calls.find(c => c.url === '/api/plantings' && c.m === 'POST').body).toMatchObject({ plant_id: 1, space_id: 5, how_started: 'seed_indoors', start_on: '2027-02-01' });
  });

  it('changing the place clears the space at once, so nothing saves under the old place while spaces load', async () => {
    stub();
    PLACES.push({ id: 2, name: 'Valley', status: 'future', hemisphere: 'north', frost_free: 1, wet_months: [], time_zone: 'UTC', sort_order: 10 });
    mount('/plantings/new?plant=1');
    await userEvent.type(await screen.findByLabelText('Start date'), '2027-02-01');
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    await userEvent.selectOptions(screen.getByLabelText('Place'), '2');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('how started offers Mature plant only for perennials', async () => {
    stub();
    mount('/plantings/new?plant=1');
    const how = await screen.findByLabelText('How it starts');
    expect(within(how).queryByRole('option', { name: 'A plant that already produces' })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Plant'), '3');
    await vi.waitFor(() => expect(within(screen.getByLabelText('How it starts')).getByRole('option', { name: 'A plant that already produces' })).toBeInTheDocument());
  });

  it('the preview lists the tasks the planting will make', async () => {
    stub();
    mount('/plantings/new?plant=1');
    await userEvent.type(await screen.findByLabelText('Start date'), '2027-02-01');
    const preview = await screen.findByRole('region', { name: 'Tasks it will make' });
    expect(await within(preview).findByText('Start seeds')).toBeInTheDocument();
    expect(within(preview).getByText('Move outside')).toBeInTheDocument();
  });
});

describe('planting page', () => {
  it('ticking a task done sends the place\'s today and shows it in the log', async () => {
    at('2027-01-24');
    stub();
    mount('/plantings/9');
    const box = await screen.findByRole('checkbox', { name: /Start seeds/ });
    await userEvent.click(box);
    await vi.waitFor(() => expect(calls.find(c => c.url === '/api/tasks/21')).toBeDefined());
    expect(calls.find(c => c.url === '/api/tasks/21').body).toEqual({ version: 1, done_on: '2027-01-24' });
    const log = await screen.findByRole('region', { name: 'Log' });
    expect(await within(log).findByText('Sowed')).toBeInTheDocument();
  });

  it('a stale task edit shows the conflict choice', async () => {
    stub();
    taskConflict = true;
    mount('/plantings/9');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Harvest window' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Notes'), 'Mine');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This was changed somewhere else')).toBeInTheDocument();
  });

  it('the guide link and supplies open from a task', async () => {
    stub();
    mount('/plantings/9');
    expect(await screen.findByRole('link', { name: 'Starting tomatoes' })).toHaveAttribute('href', '/library/guides/30');
  });
});

describe('plantings list', () => {
  it('the list groups plantings by space with their next task', async () => {
    stub();
    mount('/plantings');
    const group = await screen.findByRole('region', { name: 'North bed' });
    expect(within(group).getByRole('link', { name: /Tomato/ })).toHaveAttribute('href', '/plantings/9');
    expect(within(group).getByText(/Start seeds/)).toBeInTheDocument();
  });

  it('Spanish: plant names and task names come from the packs', async () => {
    stub();
    pack = { content: { 'plant.tomato.name': 'Jitomate' }, ui: { 'tasks.kind.start_seeds': 'Sembrar adentro' } };
    mount('/plantings');
    expect(await screen.findByRole('link', { name: /Jitomate/ })).toBeInTheDocument();
    expect(screen.getByText(/Sembrar adentro/)).toBeInTheDocument();
  });
});
