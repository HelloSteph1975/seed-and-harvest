import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { ToastProvider } from '../../client/src/components/ToastProvider.jsx';
import { ConfirmProvider } from '../../client/src/components/ConfirmProvider.jsx';
import { LeaveGuardProvider } from '../../client/src/components/LeaveGuardProvider.jsx';
import { SettingsProvider } from '../../client/src/components/SettingsProvider.jsx';
import { Library } from '../../client/src/screens/library/Library.jsx';
import { PlantPageRoute } from '../../client/src/screens/library/PlantPage.jsx';

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
const PLACES = [
  { id: 1, name: 'Home', status: 'current', hemisphere: 'north', zone: '7b', last_frost: '03-20', first_frost: null, frost_free: 0, wet_months: [], time_zone: 'UTC', sort_order: 0 },
  { id: 2, name: 'Valley', status: 'future', hemisphere: 'north', zone: '10a', frost_free: 1, wet_months: [], time_zone: 'UTC', sort_order: 10 },
];
const LIST = [
  { id: 1, name: 'Tomato', kind: 'vegetable', summary: 'Sauce fruit.', container_ok: 1, perennial: 0, zone_min: null, zone_max: null, starter_key: 'plant.tomato', is_starter: 1 },
  { id: 2, name: 'Basil', kind: 'herb', summary: 'Pesto.', container_ok: 1, perennial: 0, starter_key: 'plant.basil', is_starter: 0 },
  { id: 3, name: 'Fig', kind: 'fruit_tree', summary: 'Sweet.', container_ok: 0, perennial: 1, zone_min: 8, zone_max: 10, starter_key: null, is_starter: 0 },
];
const TOMATO = {
  ...LIST[0], latin_name: 'Solanum lycopersicum', family: 'Nightshade', sun: 'full', water: 'medium', spacing_cm: 60, container_liters: 37.85,
  start_indoors_min: 6, start_indoors_max: 8, transplant_min: 1, transplant_max: 2, fall_sow_min: 10, fall_sow_max: 12, frost_free_months: [2, 3],
  days_min: 60, days_max: 85, yield_kg: 4.5359237, yield_per: 'plant', companions: ['plant.basil', 'Marigold'], avoid: [], problems: 'Blight in wet years.',
  preserves: [{ form: 'Quart of sauce', unit: 'quart', raw_kg: 4.5359237 }], version: 3,
  varieties: [{ id: 11, plant_id: 1, name: 'Roma', days: 75, notes: 'Paste', version: 1 }],
  guides: [{ id: 22, title: 'Harvesting tomatoes', stage: 'harvest', starter_key: null, is_starter: 0 }, { id: 21, title: 'Starting tomatoes', stage: 'start_indoors', starter_key: null, is_starter: 0 }],
};
const BASE = { companions: [], avoid: [], preserves: [], varieties: [], guides: [], frost_free_months: [], version: 1 };
const PEA_SHOOTS = { ...BASE, id: 4, name: 'Pea shoots', kind: 'microgreen', summary: 'Sweet shoots.', days_min: 10, days_max: 14,
  soak_hours: 8, seed_g_per_tray: 250, safety_goats: 'safe', safety_chickens: 'safe', starter_key: 'plant.micro-pea', is_starter: 1 };
const FIG = { ...BASE, ...LIST[2], spacing_cm: 300, transplant_min: -4, transplant_max: 2, years_min: 1, years_max: 3 };
const EDITED = { ...TOMATO, id: 5, is_starter: 0 };
const NO_FROST = { ...BASE, id: 6, name: 'Bean', kind: 'vegetable', sow_min: 1, sow_max: 4, starter_key: null, is_starter: 0 };
const DETAILS = { '/api/plants/1': TOMATO, '/api/plants/3': FIG, '/api/plants/4': PEA_SHOOTS, '/api/plants/5': EDITED, '/api/plants/6': NO_FROST };
let calls;
let pack;
function stub() {
  calls = [];
  pack = null;
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const m = opts.method ?? 'GET';
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ url, m, body });
    if (url === '/api/settings') return json({ language: pack ? 'es' : 'en', time_zone: 'UTC', units: 'us' });
    if (url.startsWith('/api/locales/')) return json(url.endsWith('/content') ? pack : {});
    if (url === '/api/places') return json(PLACES);
    if (url.startsWith('/api/plants?') || url === '/api/plants') return json(LIST);
    if (url === '/api/guides') return json([{ id: 30, title: 'Starting seeds indoors', summary: 'Head start.', stage: 'start_indoors', starter_key: 'guide.basics.start', is_starter: 1 }]);
    if (DETAILS[url]) return json(DETAILS[url]);
    if (url.startsWith('/api/photos?')) return json([]);
    if (url === '/api/plants/1/varieties' && m === 'POST') return json({ id: 12, plant_id: 1, version: 1, ...body }, 201);
    return json({}, 404);
  }));
}
function mount(path) {
  const router = createMemoryRouter([{
    element: <SettingsProvider><ToastProvider><ConfirmProvider><LeaveGuardProvider><Outlet /></LeaveGuardProvider></ConfirmProvider></ToastProvider></SettingsProvider>,
    children: [
      { path: '/library', element: <Library /> },
      { path: '/library/plants/:id', element: <PlantPageRoute /> },
    ],
  }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const names = () => screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);

describe('library list', () => {
  it('filters by kind', async () => {
    stub();
    mount('/library');
    await screen.findByRole('heading', { name: 'Tomato', level: 3 });
    expect(names()).toEqual(['Basil', 'Fig', 'Tomato']);
    await userEvent.click(screen.getByRole('button', { name: 'Herb' }));
    expect(names()).toEqual(['Basil']);
  });

  it('Good in a pot hides plants that are not', async () => {
    stub();
    mount('/library');
    await screen.findByRole('heading', { name: 'Fig', level: 3 });
    await userEvent.click(screen.getByLabelText('Good in a pot'));
    expect(names()).toEqual(['Basil', 'Tomato']);
  });

  it('Fits the place hides perennials outside its zone', async () => {
    stub();
    mount('/library');
    await screen.findByRole('heading', { name: 'Fig', level: 3 });
    await userEvent.click(screen.getByLabelText(/Survives the winters at/));
    expect(names()).toEqual(['Basil', 'Tomato']);
  });

  it('shows Spanish names for starter plants when the pack has them, and the owner text for edited ones', async () => {
    stub();
    pack = { 'plant.tomato.name': 'Jitomate', 'plant.basil.name': 'Albahaca' };
    mount('/library');
    expect(await screen.findByRole('heading', { name: 'Jitomate', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Basil', level: 3 })).toBeInTheDocument();
  });

  it('sorts by the name shown on screen', async () => {
    stub();
    pack = { 'plant.tomato.name': 'Calabaza' };
    mount('/library');
    await screen.findByRole('heading', { name: 'Calabaza', level: 3 });
    expect(names()).toEqual(['Basil', 'Calabaza', 'Fig']);
  });

  it('lists basics guides on the Guides tab', async () => {
    stub();
    mount('/library?tab=guides');
    expect(await screen.findByRole('link', { name: /Starting seeds indoors/ })).toHaveAttribute('href', '/library/guides/30');
  });
});

describe('plant page', () => {
  it('shows the planting windows for the current place', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-10T12:00:00Z'));
    stub();
    mount('/library/plants/1');
    const box = await screen.findByRole('region', { name: /When to plant/ });
    expect(await within(box).findByText('Start seeds indoors')).toBeInTheDocument();
    expect(within(box).getByText('Jan 23 to Feb 6')).toBeInTheDocument();
    expect(within(box).getByText('Move outside')).toBeInTheDocument();
    expect(within(box).getByText('Mar 27 to Apr 3')).toBeInTheDocument();
  });

  it('lists the soonest window first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-01T12:00:00Z'));
    stub();
    mount('/library/plants/1');
    const box = await screen.findByRole('region', { name: /When to plant/ });
    await within(box).findByText('Move outside');
    expect(within(box).getAllByRole('term').map(d => d.textContent)).toEqual(['Move outside', 'Start seeds indoors']);
  });

  it('says which frost date is missing', async () => {
    stub();
    mount('/library/plants/1');
    const box = await screen.findByRole('region', { name: /When to plant/ });
    expect(await within(box).findByText(/Add the first fall frost date/)).toBeInTheDocument();
  });

  it('uses planting months for a frost-free place', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-10T12:00:00Z'));
    stub();
    mount('/library/plants/1');
    const box = await screen.findByRole('region', { name: /When to plant/ });
    await userEvent.selectOptions(await within(box).findByLabelText('Place'), '2');
    expect(within(box).getByText('Plant')).toBeInTheDocument();
    expect(within(box).getByText('Feb 1 to Mar 31')).toBeInTheDocument();
  });

  it('shows sizes and yield in US units with a rule-of-thumb note', async () => {
    stub();
    mount('/library/plants/1');
    expect(await screen.findByText('24 in')).toBeInTheDocument();
    expect(screen.getByText('10 gal')).toBeInTheDocument();
    expect(screen.getByText('About 10 lb per plant')).toBeInTheDocument();
    expect(screen.getByText(/rules of thumb/i)).toBeInTheDocument();
  });

  it('lists guides in stage order and links companions', async () => {
    stub();
    mount('/library/plants/1');
    const guides = await screen.findByRole('region', { name: 'Guides' });
    expect(within(within(guides).getByRole('list')).getAllByRole('link').map(a => a.textContent)).toEqual(['Starting tomatoes', 'Harvesting tomatoes']);
    expect(screen.getByRole('link', { name: 'Basil' })).toHaveAttribute('href', '/library/plants/2');
    expect(screen.getByText('Marigold')).toBeInTheDocument();
  });

  it('adds a variety', async () => {
    stub();
    mount('/library/plants/1');
    await userEvent.click(await screen.findByRole('button', { name: 'Add a variety' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'San Marzano');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.find(c => c.url === '/api/plants/1/varieties' && c.m === 'POST')).toBeDefined());
    expect(calls.find(c => c.m === 'POST').body).toMatchObject({ name: 'San Marzano' });
  });

  it('a microgreen says it grows indoors any time and shows its days', async () => {
    stub();
    mount('/library/plants/4');
    const box = await screen.findByRole('region', { name: /When to plant/ });
    expect(await within(box).findByText('Grow indoors any time of year. Ready in 10 to 14 days.')).toBeInTheDocument();
    expect(within(box).queryByText(/No planting dates/)).toBeNull();
  });

  it('a fruit plant planting window reads Plant, not Move outside', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-10T12:00:00Z'));
    stub();
    mount('/library/plants/3');
    const box = await screen.findByRole('region', { name: /When to plant/ });
    expect(await within(box).findByText('Plant')).toBeInTheDocument();
    expect(within(box).queryByText('Move outside')).toBeNull();
  });

  it('wide spacing shows in feet, not a pile of inches', async () => {
    stub();
    mount('/library/plants/3');
    expect(await screen.findByText('9.8 ft')).toBeInTheDocument();
  });

  it('the rule-of-thumb note leaves once the owner edits the plant', async () => {
    stub();
    mount('/library/plants/5');
    await screen.findByText('24 in');
    expect(screen.queryByText(/rules of thumb/i)).toBeNull();
  });

  it('with no dates worked out, asks for the last frost without saying "the rest"', async () => {
    stub();
    PLACES[0].last_frost = null;
    try {
      mount('/library/plants/6');
      const box = await screen.findByRole('region', { name: /When to plant/ });
      expect(await within(box).findByText(/Add the last spring frost date to see the planting dates/)).toBeInTheDocument();
    } finally { PLACES[0].last_frost = '03-20'; }
  });
});
