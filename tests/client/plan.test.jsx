import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { ToastProvider } from '../../client/src/components/ToastProvider.jsx';
import { ConfirmProvider } from '../../client/src/components/ConfirmProvider.jsx';
import { LeaveGuardProvider } from '../../client/src/components/LeaveGuardProvider.jsx';
import { SettingsProvider } from '../../client/src/components/SettingsProvider.jsx';
import { Plan } from '../../client/src/screens/plan/Plan.jsx';
import { PlantingFormRoute } from '../../client/src/screens/plantings/PlantingForm.jsx';

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
const PLACES = [{ id: 1, name: 'Home', status: 'current', hemisphere: 'north', zone: '7b', last_frost: '03-20', first_frost: '11-10', frost_free: 0, wet_months: [], time_zone: 'UTC', sort_order: 0 }];
const BASE = { companions: [], avoid: [], varieties: [], guides: [], frost_free_months: [], version: 1, perennial: 0, starter_key: null, is_starter: 0 };
const TOMATO = { ...BASE, id: 1, name: 'Paste tomato', kind: 'vegetable', start_indoors_min: 6, start_indoors_max: 8, transplant_min: 1, transplant_max: 2,
  yield_kg: 4.5, yield_per: 'plant', preserves: [{ form: 'Sauce', unit: 'quart', raw_kg: 4.5 }] };
const BEAN = { ...BASE, id: 2, name: 'Bush bean', kind: 'vegetable', yield_kg: 1.5, yield_per: 'meter', preserves: [] };
const plant = p => ({ id: p.id, name: p.name, starter_key: null, is_starter: 0 });
const GOALS = [
  { id: 1, year: 2027, plant_id: 1, goal_kind: 'preserve', amount: 24, unit: null, preserve_position: 1, notes: null, sort_order: 10, version: 1,
    plant: plant(TOMATO), preserve: TOMATO.preserves[0],
    suggestion: { per: 'plant', amount: 24, source: 'library', need: { kg: 108 }, yields: { library: { per: 'plant', amount: 4.5 }, last_year: null } } },
  { id: 2, year: 2027, plant_id: 2, goal_kind: 'raw', amount: 3.75, unit: 'kg', preserve_position: null, notes: null, sort_order: 20, version: 1,
    plant: plant(BEAN), preserve: null,
    suggestion: { per: 'meter', amount: 2.5, source: 'last_year', need: { kg: 3.75 }, yields: { library: { per: 'meter', amount: 1.5 }, last_year: { per: 'meter', amount: 1.6 } } } },
];
let calls;
function stub() {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const m = opts.method ?? 'GET';
    calls.push({ url, m });
    if (url === '/api/settings') return json({ language: 'en', time_zone: 'UTC', units: 'us' });
    if (url === '/api/places') return json(PLACES);
    if (url.startsWith('/api/spaces?')) return json([{ id: 5, place_id: 1, name: 'North bed', kind: 'bed' }]);
    if (url === '/api/plants') return json([TOMATO, BEAN]);
    if (url === '/api/plants/1') return json(TOMATO);
    if (url === '/api/plants/2') return json(BEAN);
    if (url.startsWith('/api/goals?year=2027')) return json(GOALS);
    if (url.startsWith('/api/goals?')) return json([]);
    if (url === '/api/plantings/preview') return json({ tasks: [] });
    if (url.startsWith('/api/plan/to-buy?year=2027&place_id=1')) return json({ year: 2027,
      seeds: [{ plant: plant(TOMATO), variety: { id: 4, name: 'Roma' }, count: 10, row_m: null, spaces: ['Box', 'North bed'] }],
      plants: [{ plant: plant(BEAN), variety: null, count: null, row_m: 3.048, spaces: ['North bed'] }],
      supplies: [{ name: 'Row cover', starter_key: null, index: 0, items: [{ task_id: 1, task_kind: 'sow', task_title: null, due_on: '2027-04-01', amount: '1 roll', plant: plant(TOMATO) }] }] });
    return json({}, 404);
  }));
}
function mount(path) {
  const router = createMemoryRouter([{
    element: <SettingsProvider><ToastProvider><ConfirmProvider><LeaveGuardProvider><Outlet /></LeaveGuardProvider></ConfirmProvider></ToastProvider></SettingsProvider>,
    children: [{ path: '/plan', element: <Plan /> }, { path: '/plantings/new', element: <PlantingFormRoute /> }],
  }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const at = iso => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${iso}T12:00:00Z`)); };

describe('Plan', () => {
  it('Plan plantings opens the planting form filled in for next year', async () => {
    at('2026-02-01');
    stub();
    const router = mount('/plan');
    const row = (await screen.findByText('Paste tomato')).closest('li');
    expect(within(row).getByText(/about 24 plants/)).toBeInTheDocument();
    expect(within(row).getByText('24 quart of Sauce')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('link', { name: 'Plan plantings' }));
    expect(router.state.location.search).toBe('?plant=1&count=24&year=2027');
    expect(await screen.findByLabelText('How many plants')).toHaveValue('24');
    await userEvent.click(await screen.findByRole('button', { name: 'Use this date' }));
    expect(screen.getByLabelText('Start date')).toHaveValue('2027-01-23');
  });

  it('the plan shows feet in US units and labels numbers as rough guides', async () => {
    at('2026-11-01');
    stub();
    mount('/plan');
    const row = (await screen.findByText('Bush bean')).closest('li');
    expect(within(row).getByText(/about 9 ft of row/)).toBeInTheDocument();
    expect(within(row).getByText(/last year/i)).toBeInTheDocument();
    expect(screen.getByText(/rough guides/)).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('link', { name: 'Plan plantings' }));
    expect(await screen.findByLabelText('Row length (ft)')).toHaveValue('9');
  });

  it('the To buy tab lists seeds, plants and supplies', async () => {
    at('2026-11-01');
    stub();
    mount('/plan?tab=to-buy');
    const seeds = await screen.findByRole('region', { name: 'Seeds' });
    expect(within(seeds).getByText(/Paste tomato/)).toHaveTextContent('Paste tomato (Roma)');
    expect(within(seeds).getByText(/10 plants/)).toBeInTheDocument();
    expect(within(seeds).getByText(/Box, North bed/)).toBeInTheDocument();
    const plants = screen.getByRole('region', { name: 'Plants to buy' });
    expect(within(plants).getByText(/10 ft of row/)).toBeInTheDocument();
    const supplies = screen.getByRole('region', { name: 'Supplies' });
    expect(within(supplies).getByText('Row cover')).toBeInTheDocument();
  });
});
