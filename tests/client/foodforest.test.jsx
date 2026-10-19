import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet, useLocation } from 'react-router-dom';
import { ToastProvider } from '../../client/src/components/ToastProvider.jsx';
import { ConfirmProvider } from '../../client/src/components/ConfirmProvider.jsx';
import { LeaveGuardProvider } from '../../client/src/components/LeaveGuardProvider.jsx';
import { SettingsProvider } from '../../client/src/components/SettingsProvider.jsx';
import { PlantingFormRoute } from '../../client/src/screens/plantings/PlantingForm.jsx';
import { PlantingPageRoute } from '../../client/src/screens/plantings/PlantingPage.jsx';
import { FoodForest } from '../../client/src/screens/foodforest/FoodForest.jsx';
import { Library } from '../../client/src/screens/library/Library.jsx';

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
const PLACES = [
  { id: 1, name: 'Home', status: 'current', hemisphere: 'north', zone: '7b', last_frost: '04-01', first_frost: '10-30', frost_free: 0, wet_months: [], time_zone: 'UTC', sort_order: 0 },
  { id: 2, name: 'Mountain', status: 'future', hemisphere: 'north', zone: '6a', last_frost: '05-10', first_frost: '10-01', frost_free: 0, wet_months: [], time_zone: 'UTC', sort_order: 1 },
];
const SPACES = { 1: [{ id: 5, place_id: 1, name: 'Orchard', kind: 'food_forest' }, { id: 6, place_id: 1, name: 'Patio pot', kind: 'container' }], 2: [{ id: 7, place_id: 2, name: 'Deck', kind: 'bed' }] };
const BASE = { companions: [], avoid: [], preserves: [], varieties: [], guides: [], frost_free_months: [], animal_safety: [], version: 1 };
const LIST = [
  { id: 1, name: 'Fig', kind: 'fruit_tree', perennial: 1, container_ok: 1, zone_min: 7, zone_max: 11, years_min: 1, days_min: null, starter_key: null, is_starter: 0 },
  { id: 2, name: 'Meyer lemon', kind: 'fruit_tree', perennial: 1, container_ok: 1, zone_min: 9, zone_max: 11, years_min: 1, days_min: null, starter_key: null, is_starter: 0 },
  { id: 3, name: 'Apple', kind: 'fruit_tree', perennial: 1, container_ok: 1, zone_min: 4, zone_max: 8, years_min: 2, days_min: null, starter_key: null, is_starter: 0 },
  { id: 4, name: 'Avocado', kind: 'fruit_tree', perennial: 1, container_ok: 0, zone_min: 9, zone_max: 11, years_min: 3, days_min: null, starter_key: null, is_starter: 0 },
  { id: 5, name: 'Tomato', kind: 'vegetable', perennial: 0, container_ok: 1, zone_min: null, zone_max: null, years_min: null, days_min: 60, starter_key: null, is_starter: 0 },
];
const FIG = { ...BASE, ...LIST[0], transplant_min: 0, transplant_max: 4, years_max: 2 };
const LEMON = { ...BASE, ...LIST[1], transplant_min: 2, transplant_max: 6, years_max: 3 };
const task = (id, kind, due_on, extra = {}) => ({ id, planting_id: 9, kind, title: null, due_on, end_on: null, done_on: null, guide_id: null, guide: null, notes: null, auto: 1, edited: 0, version: 1, ...extra });
let planting;
let calls;
let moveConflict;
let pack;
function stub() {
  calls = [];
  moveConflict = false;
  pack = null;
  planting = {
    id: 9, space_id: 6, plant_id: 2, variety_id: null, count: 1, how_started: 'mature', start_on: '2027-03-15', status: 'growing', notes: null, version: 3,
    in_container: 1, bought_from: 'Valley Nursery', bought_on: '2027-03-10', price: 45, size_when_bought: '3 years, 15 gal', bears_on: '2027-09-01',
    plant: { id: 2, name: 'Meyer lemon', kind: 'fruit_tree', starter_key: null, is_starter: 0 }, variety: null,
    space: { id: 6, name: 'Patio pot', kind: 'container', place_id: 1 },
    tasks: [task(21, 'prune', '2027-03-04'), task(22, 'protect', '2027-10-23')], log: [],
    next_task: { id: 22, kind: 'protect', title: null, due_on: '2027-10-23' }, cover: null,
  };
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const m = opts.method ?? 'GET';
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ url, m, body });
    if (url === '/api/settings') return json({ language: pack ? 'es' : 'en', time_zone: 'UTC', units: 'us' });
    if (url.startsWith('/api/locales/')) return json(url.endsWith('/content') ? pack.content : pack.ui);
    if (url === '/api/places') return json(PLACES);
    if (url.startsWith('/api/spaces?place_id=')) return json(SPACES[url.split('=')[1]] ?? []);
    if (url === '/api/plants' || url.startsWith('/api/plants?')) return json(LIST);
    if (url === '/api/plants/1') return json(FIG);
    if (url === '/api/plants/2') return json(LEMON);
    if (url === '/api/animals') return json([]);
    if (url === '/api/plantings/preview') return json({ tasks: [] });
    if (url === '/api/plantings' && m === 'POST') return json({ ...planting, ...body, id: 9 }, 201);
    if (url.startsWith('/api/plantings?')) return json([planting]);
    if (url === '/api/plantings/9/move' && moveConflict) {
      moveConflict = false;
      planting = { ...planting, version: 8, notes: 'Changed elsewhere' };
      return json({ error: 'conflict', code: 'conflict', current: planting }, 409);
    }
    if (url === '/api/plantings/9/move') {
      planting = { ...planting, version: 4, space_id: body.space_id, space: { id: 7, name: 'Deck', kind: 'bed', place_id: 2 },
        log: [{ id: 50, planting_id: 9, on_date: body.moved_on, kind: 'moved', note: 'From Patio pot (Home) to Deck (Mountain)', task_id: null, version: 1 }] };
      return json(planting);
    }
    if (url === '/api/plantings/9') return json(planting);
    if (url.startsWith('/api/photos?')) return json([]);
    if (url === '/api/guides') return json([]);
    return json({}, 404);
  }));
}
let where;
function Spy() { where = useLocation(); return null; }
function mount(path) {
  const router = createMemoryRouter([{
    element: <SettingsProvider><ToastProvider><ConfirmProvider><LeaveGuardProvider><Outlet /><Spy /></LeaveGuardProvider></ConfirmProvider></ToastProvider></SettingsProvider>,
    children: [
      { path: '/plantings/new', element: <PlantingFormRoute /> },
      { path: '/plantings/:id', element: <PlantingPageRoute /> },
      { path: '/food-forest', element: <FoodForest /> },
      { path: '/library', element: <Library /> },
    ],
  }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const at = iso => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${iso}T12:00:00Z`)); };

describe('planting form for perennials', () => {
  it('the form marks a pot planting as in a container and asks for purchase details for a perennial', async () => {
    stub();
    mount('/plantings/new?plant=1&space=6&place=1');
    const box = await screen.findByLabelText('In a container');
    await vi.waitFor(() => expect(box).toBeChecked());
    expect(screen.getByRole('group', { name: 'Purchase' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Bought from'), 'Valley Nursery');
    await userEvent.type(screen.getByLabelText('Price paid'), '45');
    await userEvent.type(screen.getByLabelText('Start date'), '2027-03-15');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.find(c => c.url === '/api/plantings' && c.m === 'POST')).toBeDefined());
    expect(calls.find(c => c.url === '/api/plantings' && c.m === 'POST').body).toMatchObject({ in_container: true, bought_from: 'Valley Nursery', price: 45 });
  });

  it('Use the library’s estimate fills the bearing date', async () => {
    stub();
    mount('/plantings/new?plant=1&space=5&place=1');
    await userEvent.type(await screen.findByLabelText('Start date'), '2027-03-15');
    await userEvent.click(screen.getByRole('button', { name: /Use the library/ }));
    expect(screen.getByLabelText('Should start bearing')).toHaveValue('2028-03-15');
  });

  it('a tender plant in a pot gets the bring-it-inside note instead of the too-cold warning', async () => {
    stub();
    mount('/plantings/new?plant=2&space=6&place=1');
    expect(await screen.findByText(/In a pot you can bring inside/)).toBeInTheDocument();
    expect(screen.queryByText(/probably too cold/)).toBeNull();
    await userEvent.click(screen.getByLabelText('In a container'));
    expect(await screen.findByText(/probably too cold/)).toBeInTheDocument();
  });
});

describe('planting page', () => {
  it('shows the purchase and bearing time', async () => {
    at('2027-06-01');
    stub();
    mount('/plantings/9');
    expect(await screen.findByText('Valley Nursery')).toBeInTheDocument();
    expect(screen.getByText('3 years, 15 gal')).toBeInTheDocument();
    expect(screen.getByText(/Starts bearing in about 3 months/)).toBeInTheDocument();
  });

  it('the move dialog sends the space and date and shows the move in the log', async () => {
    at('2027-06-01');
    stub();
    mount('/plantings/9');
    await userEvent.click(await screen.findByRole('button', { name: 'Move' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Place'), '2');
    await vi.waitFor(() => expect(within(dialog).getByLabelText('Space')).toHaveValue('7'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await vi.waitFor(() => expect(calls.find(c => c.url === '/api/plantings/9/move')).toBeDefined());
    expect(calls.find(c => c.url === '/api/plantings/9/move').body).toEqual({ version: 3, space_id: 7, moved_on: '2027-06-01' });
    expect(await screen.findByText(/From Patio pot \(Home\) to Deck \(Mountain\)/)).toBeInTheDocument();
  });
});

describe('food forest and what to buy', () => {
  it('Food Forest lists perennials by space with bearing time and next care', async () => {
    at('2027-06-01');
    stub();
    mount('/food-forest');
    const group = await screen.findByRole('region', { name: 'Patio pot' });
    expect(within(group).getByRole('link', { name: /Meyer lemon/ })).toHaveAttribute('href', '/plantings/9');
    expect(within(group).getByText('Pot')).toBeInTheDocument();
    expect(within(group).getByText(/Starts bearing in about 3 months/)).toBeInTheDocument();
    expect(within(group).getByText(/Protect from frost/)).toBeInTheDocument();
    expect(calls.some(c => c.url === '/api/plantings?place_id=1&perennial=1')).toBe(true);
    expect(screen.getByRole('link', { name: 'What to buy' })).toHaveAttribute('href', '/library?kinds=fruit_tree,shrub,vine&fit=1&sort=fast&place=1');
  });

  it('What to buy opens the library filtered and sorted fastest first', async () => {
    stub();
    mount('/library?kinds=fruit_tree,shrub,vine&fit=1&sort=fast&place=2');
    await screen.findByRole('heading', { name: 'Apple', level: 3 });
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Apple']);
    expect(screen.getByLabelText('Sort by')).toHaveValue('fast');
  });

  it('a tender pot plant stays in the fit list with the bring-inside tag', async () => {
    stub();
    mount('/library?kinds=fruit_tree,shrub,vine&fit=1&pot=1&sort=fast&place=2');
    await screen.findByRole('heading', { name: 'Apple', level: 3 });
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Fig', 'Meyer lemon', 'Apple']);
    const lemon = screen.getByRole('heading', { name: 'Meyer lemon', level: 3 }).closest('li');
    expect(within(lemon).getByText('In a pot you bring inside')).toBeInTheDocument();
  });

  it('Spanish: care task names come from the pack', async () => {
    at('2027-06-01');
    stub();
    pack = { content: {}, ui: { 'tasks.kind.protect': 'Proteger de la helada' } };
    mount('/food-forest');
    expect(await screen.findByText(/Proteger de la helada/)).toBeInTheDocument();
  });

  it('a move that meets a newer version reloads, and trying again sends the new version', async () => {
    at('2027-06-01');
    stub();
    moveConflict = true;
    mount('/plantings/9');
    await userEvent.click(await screen.findByRole('button', { name: 'Move' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Place'), '2');
    await vi.waitFor(() => expect(within(dialog).getByLabelText('Space')).toHaveValue('7'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByText('Changed elsewhere')).toBeInTheDocument());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await vi.waitFor(() => expect(calls.filter(c => c.url === '/api/plantings/9/move')).toHaveLength(2));
    expect(calls.filter(c => c.url === '/api/plantings/9/move')[1].body.version).toBe(8);
  });

  it('fastest to produce puts perennials first by years, then annuals by days', async () => {
    stub();
    mount('/library?sort=fast');
    await screen.findByRole('heading', { name: 'Apple', level: 3 });
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Fig', 'Meyer lemon', 'Apple', 'Avocado', 'Tomato']);
  });

  it('a range like 1 to 1 years reads as 1 year', async () => {
    stub();
    mount('/library?sort=fast');
    const fig = (await screen.findByRole('heading', { name: 'Fig', level: 3 })).closest('li');
    expect(within(fig).getByText(/· 1 year$/)).toBeInTheDocument();
    expect(within(fig).queryByText(/1 to 1 years/)).toBeNull();
  });
});
