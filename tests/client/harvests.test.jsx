import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { ToastProvider } from '../../client/src/components/ToastProvider.jsx';
import { ConfirmProvider } from '../../client/src/components/ConfirmProvider.jsx';
import { LeaveGuardProvider } from '../../client/src/components/LeaveGuardProvider.jsx';
import { SettingsProvider } from '../../client/src/components/SettingsProvider.jsx';
import { PlantingPageRoute } from '../../client/src/screens/plantings/PlantingPage.jsx';
import { Harvests } from '../../client/src/screens/harvests/Harvests.jsx';

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
const PLACES = [{ id: 1, name: 'Home', status: 'current', hemisphere: 'north', zone: '7b', last_frost: '04-01', first_frost: '10-30', frost_free: 0, wet_months: [], time_zone: 'UTC', sort_order: 0 }];
const HARVEST = {
  id: 70, planting_id: 9, tray_id: null, harvested_on: '2027-07-01', quantity: 2.26796185, unit: 'kg', larder_qty: 0.90718474, animals_qty: 0, animal_id: null,
  given_qty: 0, given_to: null, sold_qty: 0.45359237, sold_price: 6, sold_to: 'Market', notes: null, larder_state: 'failed', larder_error: 'Hearth & Larder is not answering', version: 1,
  kept_qty: 0.90718474, crop: { plant_id: 1, name: 'Tomato', starter_key: 'plant.tomato', is_starter: 1 }, variety_name: null, space: { id: 5, name: 'North bed' }, place_id: 1,
  source: { kind: 'planting', id: 9 },
};
let calls;
let pack;
let units;
function stub() {
  calls = [];
  pack = null;
  units = 'us';
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const m = opts.method ?? 'GET';
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ url, m, body });
    if (url === '/api/settings') return json({ language: pack ? 'es' : 'en', time_zone: 'UTC', units, larder_link: true });
    if (url.startsWith('/api/locales/')) return json(url.endsWith('/content') ? pack.content : pack.ui);
    if (url === '/api/places') return json(PLACES);
    if (url === '/api/animals') return json([{ id: 11, name: 'The goats', kind: 'goat' }]);
    if (url === '/api/plantings/9') {
      return json({ id: 9, space_id: 5, plant_id: 1, variety_id: null, count: 4, how_started: 'start', start_on: '2027-04-10', status: 'growing', notes: null, version: 3, in_container: 0,
        plant: { id: 1, name: 'Tomato', kind: 'vegetable', starter_key: 'plant.tomato', is_starter: 1 }, variety: null, space: { id: 5, name: 'North bed', kind: 'bed', place_id: 1 }, tasks: [], log: [] });
    }
    if (url.startsWith('/api/summary?')) return json(url.includes('year=2026') ? { year: 2026, by_crop: [], by_place: [], totals: { kg: 0, count: 0, bunch: 0, income: 0 } } : {
      year: 2027,
      by_crop: [{ plant_id: 1, name: 'Tomato', starter_key: 'plant.tomato', is_starter: 1, totals: { kg: 4.5359237, count: 0, bunch: 0 }, larder: { kg: 2.26796185, count: 0, bunch: 0 },
        animals: { kg: 0, count: 0, bunch: 0 }, given: { kg: 0, count: 0, bunch: 0 }, sold: { kg: 0.45359237, count: 0, bunch: 0 }, kept: { kg: 1.81436948, count: 0, bunch: 0 }, income: 12 }],
      by_place: [{ place_id: 1, name: 'Home', kg: 4.5359237, count: 0, bunch: 0, income: 12 }],
      totals: { kg: 4.5359237, count: 0, bunch: 0, income: 12 } });
    if (url.startsWith('/api/harvests?')) return json([HARVEST]);
    if (url === '/api/harvests' && m === 'POST') return json({ ...HARVEST, ...body, id: 71 }, 201);
    if (url === '/api/harvests/70' && m === 'PATCH') return json({ ...HARVEST, ...body, version: 2 });
    if (url.startsWith('/api/photos?')) return json([]);
    return json({}, 404);
  }));
}
function mount(path) {
  const router = createMemoryRouter([{
    element: <SettingsProvider><ToastProvider><ConfirmProvider><LeaveGuardProvider><Outlet /></LeaveGuardProvider></ConfirmProvider></ToastProvider></SettingsProvider>,
    children: [{ path: '/plantings/:id', element: <PlantingPageRoute /> }, { path: '/harvests', element: <Harvests /> }],
  }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const at = iso => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${iso}T12:00:00Z`)); };

async function openNew() {
  const box = await screen.findByRole('region', { name: 'Harvests' });
  await userEvent.click(within(box).getByRole('button', { name: 'Record a harvest' }));
  return screen.findByRole('dialog');
}

describe('harvest dialog', () => {
  it('the dialog works out kept fresh live and refuses parts that add up to too much', async () => {
    at('2027-07-04');
    stub();
    mount('/plantings/9');
    const dialog = await openNew();
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2027-07-04');
    await userEvent.type(within(dialog).getByLabelText('Amount'), '5');
    await userEvent.type(within(dialog).getByLabelText('To the larder'), '2');
    await userEvent.type(within(dialog).getByLabelText('Sold'), '1');
    expect(within(dialog).getByText('Kept fresh: 2 lb')).toBeInTheDocument();
    expect(within(dialog).getByText(/This part goes to Hearth & Larder/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Given away'), '3');
    expect(within(dialog).getByText(/add up to more than the harvest/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('animals need an animal picked, and the harvest saves in kilograms', async () => {
    stub();
    mount('/plantings/9');
    const dialog = await openNew();
    await userEvent.type(within(dialog).getByLabelText('Amount'), '2');
    await userEvent.type(within(dialog).getByLabelText('For animals'), '1');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText('Which animals'), '11');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.find(c => c.url === '/api/harvests' && c.m === 'POST')).toBeDefined());
    const body = calls.find(c => c.url === '/api/harvests' && c.m === 'POST').body;
    expect(body).toMatchObject({ planting_id: 9, unit: 'kg', animal_id: 11 });
    expect(body.quantity).toBeCloseTo(0.90718474, 6);
    expect(body.animals_qty).toBeCloseTo(0.45359237, 6);
  });

  it('weights show in pounds and an untouched amount saves back exactly', async () => {
    stub();
    mount('/plantings/9');
    const box = await screen.findByRole('region', { name: 'Harvests' });
    await userEvent.click(await within(box).findByRole('button', { name: /Edit the harvest/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Amount')).toHaveValue('5');
    await userEvent.type(within(dialog).getByLabelText('Notes'), 'Sweet');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.find(c => c.url === '/api/harvests/70')).toBeDefined());
    const body = calls.find(c => c.url === '/api/harvests/70').body;
    expect(body.quantity).toBe(2.26796185);
    expect(body.larder_qty).toBe(0.90718474);
  });
});

describe('harvest lists', () => {
  it('the planting page lists its harvests', async () => {
    stub();
    mount('/plantings/9');
    const box = await screen.findByRole('region', { name: 'Harvests' });
    expect(await within(box).findByText(/5 lb/)).toBeInTheDocument();
  });

  it('the harvests list shows the split and the larder status', async () => {
    at('2027-07-04');
    stub();
    mount('/harvests');
    const row = (await screen.findByRole('link', { name: /Tomato/ })).closest('li');
    expect(within(row).getByText(/2 lb to the larder/)).toBeInTheDocument();
    expect(within(row).getByText(/1 lb sold/)).toBeInTheDocument();
    expect(within(row).getByText('Not sent')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Send again' })).toBeInTheDocument();
  });

  it('Spanish: crop names come from the pack', async () => {
    stub();
    pack = { content: { 'plant.tomato.name': 'Jitomate' }, ui: {} };
    mount('/harvests');
    expect(await screen.findByRole('link', { name: /Jitomate/ })).toBeInTheDocument();
  });

  it('the summary screen shows crops and places in the chosen units', async () => {
    at('2027-07-04');
    stub();
    mount('/harvests?tab=summary&year=2027');
    const crops = await screen.findByRole('table', { name: 'By crop' });
    const row = within(crops).getByRole('row', { name: /Jitomate|Tomato/ });
    expect(within(row).getByText('10 lb')).toBeInTheDocument();
    expect(within(row).getByText('5 lb')).toBeInTheDocument();
    expect(within(row).getByText('12')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'By place' })).toHaveTextContent('Home');
  });

  it('an empty year says so', async () => {
    at('2027-07-04');
    stub();
    mount('/harvests?tab=summary&year=2026');
    expect(await screen.findByText('Nothing harvested in 2026 yet.')).toBeInTheDocument();
  });

  it('sending all of a weight shown rounded is not refused', async () => {
    stub();
    units = 'metric';
    mount('/plantings/9');
    const box = await screen.findByRole('region', { name: 'Harvests' });
    // HARVEST is 2.26796185 kg, shown as 2.3. Typing 2.3 for the larder means all of it.
    await userEvent.click(await within(box).findByRole('button', { name: /Edit the harvest/ }));
    const dialog = await screen.findByRole('dialog');
    const larder = within(dialog).getByLabelText('To the larder');
    await userEvent.clear(larder);
    await userEvent.clear(within(dialog).getByLabelText('Sold'));
    await userEvent.type(larder, '2.3');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.find(c => c.url === '/api/harvests/70')).toBeDefined());
    const body = calls.find(c => c.url === '/api/harvests/70').body;
    expect(body.larder_qty + body.sold_qty + body.given_qty + body.animals_qty).toBeLessThanOrEqual(body.quantity + 1e-9);
    expect(body.larder_qty).toBe(2.26796185);
  });
});
