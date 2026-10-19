import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet, useLocation } from 'react-router-dom';
import { ToastProvider } from '../../client/src/components/ToastProvider.jsx';
import { ConfirmProvider } from '../../client/src/components/ConfirmProvider.jsx';
import { LeaveGuardProvider } from '../../client/src/components/LeaveGuardProvider.jsx';
import { SettingsProvider } from '../../client/src/components/SettingsProvider.jsx';
import { Microgreens } from '../../client/src/screens/microgreens/Microgreens.jsx';
import { TrayFormRoute } from '../../client/src/screens/microgreens/TrayForm.jsx';
import { TrayPageRoute } from '../../client/src/screens/microgreens/TrayPage.jsx';
import { PlantFormRoute } from '../../client/src/screens/library/PlantForm.jsx';

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
const HOME = { id: 1, name: 'Home', status: 'current', hemisphere: 'north', zone: '7b', last_frost: '03-20', first_frost: '11-10', frost_free: 0, wet_months: [], time_zone: 'UTC', sort_order: 0 };
const SPACES = [{ id: 5, place_id: 1, name: 'Bed', kind: 'bed' }, { id: 6, place_id: 1, name: 'Rack', kind: 'microgreen_rack', tray_count: 2 }];
const PLANTS = [
  { id: 1, name: 'Pea shoots', kind: 'microgreen', starter_key: 'plant.micro-pea', is_starter: 1 },
  { id: 2, name: 'Mustard microgreens', kind: 'microgreen', starter_key: null, is_starter: 0 },
  { id: 3, name: 'Tomato', kind: 'vegetable', starter_key: null, is_starter: 0 },
];
const BASE = { companions: [], avoid: [], preserves: [], varieties: [], guides: [], frost_free_months: [], animal_safety: [], version: 1 };
const PEA = { ...BASE, ...PLANTS[0], days_min: 10, days_max: 14, seed_g_per_tray: 280, soak_hours: 10, safety_goats: 'safe', safety_chickens: 'safe' };
const MUSTARD = { ...BASE, ...PLANTS[1], days_min: 8, days_max: 12, seed_g_per_tray: 20, safety_goats: 'avoid', safety_chickens: 'avoid', animal_safety: [{ animal_id: 13, safety: 'small' }] };
const ANIMALS = [{ id: 11, name: 'The goats', kind: 'goat', version: 1 }, { id: 12, name: 'Ducks', kind: 'other', version: 1 }, { id: 13, name: 'Rabbits', kind: 'other', version: 1 }];
const trayRow = (id, extra = {}) => ({ id, plant_id: 1, space_id: 6, animal_id: 11, tray_count: 1, seed_g: 280, sown_on: '2027-03-01', harvest_on: '2027-03-11',
  status: 'growing', harvested_on: null, series_id: id, repeat_days: 5, notes: null, version: 1,
  plant: { id: 1, name: 'Pea shoots', starter_key: 'plant.micro-pea', is_starter: 1, days_min: 10, days_max: 14, seed_g_per_tray: 280, soak_hours: 10 },
  space: { id: 6, name: 'Rack', tray_count: 2, place_id: 1 }, animal: { id: 11, name: 'The goats', kind: 'goat', deleted: false }, safety: 'safe', next_sow_on: '2027-03-06', ...extra });
let calls;
let pack;
let trays;
let trayConflict;
let harvestsDown;
let places;
function stub() {
  harvestsDown = false;
  trayConflict = false;
  places = [HOME];
  calls = [];
  pack = null;
  trays = [trayRow(40), trayRow(41, { harvest_on: '2027-03-20', next_sow_on: null, repeat_days: null, series_id: 41 })];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const m = opts.method ?? 'GET';
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ url, m, body });
    if (url === '/api/settings') return json({ language: pack ? 'es' : 'en', time_zone: 'UTC', units: 'metric' });
    if (url.startsWith('/api/locales/')) return json(url.endsWith('/content') ? pack.content : pack.ui);
    if (url === '/api/places') return json(places);
    if (url.startsWith('/api/spaces?')) return json(SPACES);
    if (url === '/api/plants' || url.startsWith('/api/plants?')) return json(PLANTS);
    if (url === '/api/plants/1') return json(PEA);
    if (url === '/api/plants/2' && m === 'GET') return json(MUSTARD);
    if (url === '/api/plants/2' && m === 'PATCH') return json({ ...MUSTARD, ...body, version: 2 });
    if (url === '/api/animals') return json(ANIMALS);
    if (url.startsWith('/api/trays?')) return json(trays);
    if (url.startsWith('/api/trays/due?')) return json({ ready: [], sow: [] });
    if (url === '/api/trays' && m === 'POST') return json({ id: 50, ...body, version: 1 }, 201);
    if (url === '/api/trays/40' && m === 'PATCH') {
      if (trayConflict) { trayConflict = false; return json({ error: 'conflict', code: 'conflict', current: { ...trays[0], status: 'harvested', harvested_on: '2027-03-11', version: 5 } }, 409); }
      return json({ ...trays[0], ...body, version: (body.version ?? 1) + 1 });
    }
    if (url === '/api/trays/40') return json(trays[0]);
    if (url === '/api/trays/45') return json(trayRow(45, { plant_id: 2, animal_id: 14, animal: { id: 14, name: 'Old goat', kind: 'goat', deleted: true }, safety: 'avoid',
      plant: { id: 2, name: 'Mustard microgreens', starter_key: null, is_starter: 0, days_min: 8, seed_g_per_tray: 20 } }));
    if (url === '/api/trays/40/sow-again') return json({ ...trays[0], id: 51, sown_on: body.sown_on }, 201);
    if (url === '/api/trays/51') return json({ ...trays[0], id: 51 });
    if (url === '/api/harvests?tray_id=40' && harvestsDown) return json({ error: 'Something went wrong.' }, 500);
    if (url === '/api/harvests?tray_id=40') return json([{ id: 80, planting_id: null, tray_id: 40, harvested_on: '2027-03-11', quantity: 0.05, unit: 'kg', larder_qty: 0,
      animals_qty: 0.05, animal_id: 11, given_qty: 0, sold_qty: 0, kept_qty: 0, larder_state: 'off', version: 1, crop: { plant_id: 1, name: 'Pea shoots' },
      variety_name: null, space: { id: 6, name: 'Rack' }, place_id: 1, source: { kind: 'tray', id: 40 } }]);
    if (url.startsWith('/api/harvests?')) return json([]);
    if (url.startsWith('/api/photos?')) return json([]);
    if (url.startsWith('/api/guides')) return json([]);
    return json({}, 404);
  }));
}
let where;
function Spy() { where = useLocation(); return null; }
function mount(path) {
  const router = createMemoryRouter([{
    element: <SettingsProvider><ToastProvider><ConfirmProvider><LeaveGuardProvider><Outlet /><Spy /></LeaveGuardProvider></ConfirmProvider></ToastProvider></SettingsProvider>,
    children: [
      { path: '/microgreens', element: <Microgreens /> },
      { path: '/microgreens/trays/new', element: <TrayFormRoute /> },
      { path: '/microgreens/trays/:id', element: <TrayPageRoute /> },
      { path: '/microgreens/trays/:id/edit', element: <TrayFormRoute /> },
      { path: '/library/plants/:id/edit', element: <PlantFormRoute /> },
    ],
  }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const at = iso => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${iso}T12:00:00Z`)); };

describe('tray form', () => {
  it('the form fills harvest date and seed from the crop and keeps an owner\'s change', async () => {
    at('2027-03-01');
    stub();
    mount('/microgreens/trays/new?plant=1');
    const harvest = await screen.findByLabelText('Ready to cut');
    await vi.waitFor(() => expect(harvest).toHaveValue('2027-03-11'));
    expect(screen.getByLabelText('Seed (g)')).toHaveValue('280');
    expect(screen.getByText(/Soak for 10 hours/)).toBeInTheDocument();
    await userEvent.clear(harvest);
    await userEvent.type(harvest, '2027-03-09');
    await userEvent.clear(screen.getByLabelText('Sown'));
    await userEvent.type(screen.getByLabelText('Sown'), '2027-03-02');
    expect(harvest).toHaveValue('2027-03-09');
  });

  it('choosing goats for mustard warns it isn\'t safe', async () => {
    stub();
    mount('/microgreens/trays/new?plant=2');
    await userEvent.selectOptions(await screen.findByLabelText('For'), '11');
    expect(await screen.findByText(/Not safe for The goats/)).toBeInTheDocument();
    expect(screen.getByText(/Check with your vet/)).toBeInTheDocument();
  });

  it('an animal with no rating says to ask a vet first', async () => {
    stub();
    mount('/microgreens/trays/new?plant=2');
    await userEvent.selectOptions(await screen.findByLabelText('For'), '12');
    expect(await screen.findByText(/Not rated for Ducks yet/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('For'), '13');
    expect(await screen.findByText(/Only small amounts for Rabbits/)).toBeInTheDocument();
  });

  it('a full rack warns but still saves', async () => {
    at('2027-03-01');
    stub();
    mount('/microgreens/trays/new?plant=1');
    expect(await screen.findByText('Rack holds 2 trays and would have 3.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.find(c => c.url === '/api/trays' && c.m === 'POST')).toBeDefined());
    expect(calls.find(c => c.url === '/api/trays' && c.m === 'POST').body).toMatchObject({ plant_id: 1, space_id: 6, sown_on: '2027-03-01', harvest_on: '2027-03-11', seed_g: 280, status: 'growing' });
  });
});

describe('tray page and list', () => {
  it('the tray page lists its harvests', async () => {
    stub();
    mount('/microgreens/trays/40');
    const box = await screen.findByRole('region', { name: 'Harvests' });
    expect(await within(box).findByText('0.05 kg')).toBeInTheDocument();
    expect(within(box).getByText('0.05 kg for animals')).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: /Edit the harvest/ })).toBeInTheDocument();
  });

  it('the tray page says so when its harvests will not load, and Try again loads them', async () => {
    stub();
    harvestsDown = true;
    mount('/microgreens/trays/40');
    const box = await screen.findByRole('region', { name: 'Harvests' });
    expect(await within(box).findByRole('alert')).toBeInTheDocument();
    harvestsDown = false;
    await userEvent.click(within(box).getByRole('button', { name: 'Try again' }));
    expect(await within(box).findByText('0.05 kg')).toBeInTheDocument();
  });

  it('sow again from the tray page posts today\'s date and opens the new tray', async () => {
    at('2027-03-06');
    stub();
    mount('/microgreens/trays/40');
    await userEvent.click(await screen.findByRole('button', { name: 'Sow again' }));
    await vi.waitFor(() => expect(calls.find(c => c.url === '/api/trays/40/sow-again')).toBeDefined());
    expect(calls.find(c => c.url === '/api/trays/40/sow-again').body).toEqual({ sown_on: '2027-03-06' });
    await vi.waitFor(() => expect(where.pathname).toBe('/microgreens/trays/51'));
  });

  it('the list shows Ready to cut and the sow-next line', async () => {
    at('2027-03-11');
    stub();
    mount('/microgreens');
    const rack = await screen.findByRole('region', { name: 'Rack' });
    expect(within(rack).getByText('Ready to cut')).toBeInTheDocument();
    expect(within(rack).getByText('9 days to go')).toBeInTheDocument();
    const next = screen.getByRole('region', { name: 'Sow next' });
    expect(within(next).getByText(/Pea shoots/)).toBeInTheDocument();
  });

  it('Spanish: crop names and rating words come from the packs', async () => {
    at('2027-03-11');
    stub();
    pack = { content: { 'plant.micro-pea.name': 'Brotes de chícharo' }, ui: { 'trays.ready': 'Listo para cortar' } };
    mount('/microgreens');
    expect(await screen.findAllByText(/Brotes de chícharo/)).not.toHaveLength(0);
    expect(screen.getByText('Listo para cortar')).toBeInTheDocument();
  });
});

describe('plant form', () => {
  it('the plant form saves a rating for another animal', async () => {
    stub();
    mount('/library/plants/2/edit');
    const ducks = await screen.findByLabelText('Safe for Ducks?');
    await userEvent.selectOptions(ducks, 'avoid');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.find(c => c.url === '/api/plants/2' && c.m === 'PATCH')).toBeDefined());
    expect(calls.find(c => c.url === '/api/plants/2' && c.m === 'PATCH').body.animal_safety).toEqual([{ animal_id: 12, safety: 'avoid' }, { animal_id: 13, safety: 'small' }]);
  });
});

describe('review fixes', () => {
  it('a tray whose animal is in the Trash keeps it in the form, with its warning', async () => {
    stub();
    mount('/microgreens/trays/45/edit');
    const select = await screen.findByLabelText('For');
    await vi.waitFor(() => expect(select).toHaveValue('14'));
    expect(within(select).getByRole('option', { name: 'Old goat (in the Trash)' })).toBeInTheDocument();
    expect(await screen.findByText(/Not safe for Old goat/)).toBeInTheDocument();
  });

  it('a double click on Sow again sows one tray', async () => {
    at('2027-03-06');
    stub();
    mount('/microgreens/trays/40');
    const button = await screen.findByRole('button', { name: 'Sow again' });
    await userEvent.dblClick(button);
    await vi.waitFor(() => expect(where.pathname).toBe('/microgreens/trays/51'));
    expect(calls.filter(c => c.url === '/api/trays/40/sow-again')).toHaveLength(1);
  });

  it('after taking the newer record from a conflict, saving does not undo its cut', async () => {
    stub();
    trayConflict = true;
    mount('/microgreens/trays/40/edit');
    await userEvent.type(await screen.findByLabelText('Notes'), 'mine');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reload the latest' }));
    await userEvent.type(screen.getByLabelText('Notes'), 'again');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.filter(c => c.url === '/api/trays/40' && c.m === 'PATCH')).toHaveLength(2));
    const last = calls.filter(c => c.url === '/api/trays/40' && c.m === 'PATCH')[1].body;
    expect(last.version).toBe(5);
    expect(last).not.toHaveProperty('status');
  });

  it('the sown date is judged against the chosen place own today', async () => {
    at('2027-03-01');
    stub();
    places = [HOME, { ...HOME, id: 2, name: 'Far east', status: 'future', time_zone: 'Pacific/Kiritimati', sort_order: 5 }];
    mount('/microgreens/trays/new?plant=1');
    await screen.findByLabelText('Ready to cut');
    await userEvent.selectOptions(screen.getByLabelText('Place'), '2');
    const sown = screen.getByLabelText('Sown');
    await userEvent.clear(sown);
    await userEvent.type(sown, '2027-03-02');
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.find(c => c.url === '/api/trays' && c.m === 'POST')).toBeDefined());
    expect(calls.find(c => c.url === '/api/trays' && c.m === 'POST').body.status).toBe('growing');
  });
});
