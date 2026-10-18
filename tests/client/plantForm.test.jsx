import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { ToastProvider } from '../../client/src/components/ToastProvider.jsx';
import { ConfirmProvider } from '../../client/src/components/ConfirmProvider.jsx';
import { LeaveGuardProvider } from '../../client/src/components/LeaveGuardProvider.jsx';
import { SettingsProvider } from '../../client/src/components/SettingsProvider.jsx';
import { PlantFormRoute } from '../../client/src/screens/library/PlantForm.jsx';

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
let plant;
let calls;
function stub() {
  plant = { id: 1, name: 'Tomato', kind: 'vegetable', spacing_cm: 46, container_liters: null, start_indoors_min: 6, start_indoors_max: 8,
    frost_free_months: [], companions: [], avoid: [], preserves: [], varieties: [], guides: [], container_ok: 0, perennial: 0, version: 2,
    starter_key: null, is_starter: 0 };
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const m = opts.method ?? 'GET';
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ url, m, body });
    if (url === '/api/settings') return json({ language: 'en', time_zone: 'UTC', units: 'us' });
    if (url === '/api/plants') return json([]);
    if (url === '/api/plants/1' && m === 'GET') return json(plant);
    if (url === '/api/plants/1' && m === 'PATCH') {
      if (body.start_indoors_min > body.start_indoors_max) return json({ error: 'fix', code: 'invalid', details: { start_indoors_max: 'x' }, detailCodes: { start_indoors_max: { code: 'range_order' } } }, 400);
      plant = { ...plant, ...body, version: plant.version + 1 };
      return json(plant);
    }
    if (url === '/api/plants' && m === 'POST') return json({ ...body, id: 9, version: 1 }, 201);
    return json({}, 404);
  }));
}
function mount(path) {
  const router = createMemoryRouter([{
    element: <SettingsProvider><ToastProvider><ConfirmProvider><LeaveGuardProvider><Outlet /></LeaveGuardProvider></ConfirmProvider></ToastProvider></SettingsProvider>,
    children: [
      { path: '/library/plants/new', element: <PlantFormRoute /> },
      { path: '/library/plants/:id/edit', element: <PlantFormRoute /> },
      { path: '/library/plants/:id', element: <p>Plant page</p> },
    ],
  }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}
afterEach(() => vi.unstubAllGlobals());

describe('plant form', () => {
  it('shows microgreen fields only for microgreens', async () => {
    stub();
    mount('/library/plants/new');
    await screen.findByLabelText('Name');
    expect(screen.queryByLabelText('Soak (hours)')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'microgreen');
    expect(screen.getByLabelText('Soak (hours)')).toBeInTheDocument();
    expect(screen.getByLabelText('Seed per tray (oz)')).toBeInTheDocument();
    expect(screen.getByLabelText('Safe for goats?')).toBeInTheDocument();
  });

  it('an untouched spacing saves back exactly', async () => {
    stub();
    mount('/library/plants/1/edit');
    expect(await screen.findByLabelText('Spacing (in)')).toHaveValue('18');
    await userEvent.type(screen.getByLabelText('Summary'), 'Red fruit');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.find(c => c.m === 'PATCH')).toBeDefined());
    expect(calls.find(c => c.m === 'PATCH').body).toMatchObject({ version: 2, spacing_cm: 46, summary: 'Red fruit' });
  });

  it('refuses min after max with the field message', async () => {
    stub();
    mount('/library/plants/1/edit');
    const min = await screen.findByLabelText('Start seeds indoors: from (weeks before the last frost)');
    await userEvent.clear(min);
    await userEvent.type(min, '9');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The second number must not be smaller than the first')).toBeInTheDocument();
  });

  it('saves planting months for frost-free places', async () => {
    stub();
    mount('/library/plants/new');
    await userEvent.type(await screen.findByLabelText('Name'), 'Chard');
    await userEvent.click(screen.getByRole('button', { name: 'Mar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Oct' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.find(c => c.m === 'POST')).toBeDefined());
    expect(calls.find(c => c.m === 'POST').body).toMatchObject({ name: 'Chard', kind: 'vegetable', frost_free_months: [3, 10] });
  });

describe('preserving amounts', () => {
  it('adds one, in pounds, and an untouched one saves back exactly', async () => {
    stub();
    plant.preserves = [{ form: 'Quart of sauce', unit: 'quart', raw_kg: 2.3 }];
    mount('/library/plants/1/edit');
    expect(await screen.findByDisplayValue('Quart of sauce')).toBeInTheDocument();
    expect(screen.getByLabelText('Fresh weight 1 (lb)')).toHaveValue('5.1');
    await userEvent.click(screen.getByRole('button', { name: 'Add a preserving amount' }));
    await userEvent.type(screen.getByLabelText('Preserve 2'), 'Pint of salsa');
    await userEvent.type(screen.getByLabelText('Unit 2'), 'pint');
    await userEvent.type(screen.getByLabelText('Fresh weight 2 (lb)'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.find(c => c.m === 'PATCH')).toBeDefined());
    const sent = calls.find(c => c.m === 'PATCH').body.preserves;
    expect(sent[0]).toEqual({ form: 'Quart of sauce', unit: 'quart', raw_kg: 2.3 });
    expect(sent[1].form).toBe('Pint of salsa');
    expect(sent[1].raw_kg).toBeCloseTo(0.90718474, 6);
  });
});
});
