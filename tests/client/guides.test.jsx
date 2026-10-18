import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { ToastProvider } from '../../client/src/components/ToastProvider.jsx';
import { ConfirmProvider } from '../../client/src/components/ConfirmProvider.jsx';
import { LeaveGuardProvider } from '../../client/src/components/LeaveGuardProvider.jsx';
import { SettingsProvider } from '../../client/src/components/SettingsProvider.jsx';
import { GuidePageRoute } from '../../client/src/screens/library/GuidePage.jsx';
import { GuideFormRoute } from '../../client/src/screens/library/GuideForm.jsx';

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
let guides;
let calls;
function stub() {
  guides = {
    5: { id: 5, title: 'Starting tomatoes', summary: 'Six to eight weeks early.', stage: 'start_indoors', plant_id: 1, basics_id: 9, version: 2,
      steps: ['Sow 6 mm deep.', 'Keep at 24 °C until they sprout.'], supplies: [{ name: 'Seed trays', amount: '1' }, { name: 'Heat mat', amount: null }],
      plant: { id: 1, name: 'Tomato' }, basics: { id: 9, title: 'Starting seeds indoors', live: true }, starter_key: null, is_starter: 0 },
    9: { id: 9, title: 'Starting seeds indoors', summary: null, stage: 'start_indoors', plant_id: null, basics_id: null, version: 1,
      steps: ['Fill trays.'], supplies: [], plant: null, basics: null, starter_key: null, is_starter: 0 },
  };
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const m = opts.method ?? 'GET';
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ url, m, body });
    if (url === '/api/settings') return json({ language: 'en', time_zone: 'UTC', units: 'us' });
    if (url === '/api/guides') return json([{ id: 9, title: 'Starting seeds indoors', stage: 'start_indoors' }]);
    if (url === '/api/plants') return json([{ id: 1, name: 'Tomato', kind: 'vegetable' }]);
    if (url === '/api/guides' && m === 'POST') return json({ ...body, id: 40, version: 1 }, 201);
    const g = guides[Number(url.split('/')[3])];
    if (!g) return json({ error: 'Not found', code: 'not_found' }, 404);
    if (m === 'GET') return json(g);
    if (m === 'PATCH') { Object.assign(g, body, { version: g.version + 1 }); return json(g); }
    return json({}, 404);
  }));
}
function mount(path) {
  const router = createMemoryRouter([{
    element: <SettingsProvider><ToastProvider><ConfirmProvider><LeaveGuardProvider><Outlet /></LeaveGuardProvider></ConfirmProvider></ToastProvider></SettingsProvider>,
    children: [
      { path: '/library/guides/new', element: <GuideFormRoute /> },
      { path: '/library/guides/:id', element: <GuidePageRoute /> },
      { path: '/library/guides/:id/edit', element: <GuideFormRoute /> },
    ],
  }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}
afterEach(() => vi.unstubAllGlobals());

describe('guide page', () => {
  it('shows numbered steps and supplies', async () => {
    stub();
    mount('/library/guides/5');
    const steps = await screen.findByRole('list', { name: 'Steps' });
    expect(within(steps).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Sow 6 mm deep.', 'Keep at 24 °C until they sprout.']);
    const supplies = screen.getByRole('list', { name: "You'll need" });
    expect(within(supplies).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Seed trays: 1', 'Heat mat']);
  });

  it('a plant guide links to its basics guide and its plant', async () => {
    stub();
    mount('/library/guides/5');
    expect(await screen.findByRole('link', { name: /Starting seeds indoors/ })).toHaveAttribute('href', '/library/guides/9');
    expect(screen.getByRole('link', { name: 'Tomato' })).toHaveAttribute('href', '/library/plants/1');
  });

  it('a basics guide in the Trash shows as unavailable', async () => {
    stub();
    guides[5].basics.live = false;
    mount('/library/guides/5');
    expect(await screen.findByText(/is in the Trash/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Starting seeds indoors/ })).not.toBeInTheDocument();
  });
});

describe('guide form', () => {
  it('saves steps in the order shown after a move', async () => {
    stub();
    mount('/library/guides/5/edit');
    await screen.findByDisplayValue('Sow 6 mm deep.');
    await userEvent.click(screen.getByRole('button', { name: 'Move Step 2 up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.find(c => c.m === 'PATCH')).toBeDefined());
    expect(calls.find(c => c.m === 'PATCH').body.steps).toEqual(['Keep at 24 °C until they sprout.', 'Sow 6 mm deep.']);
    expect(calls.find(c => c.m === 'PATCH').body.supplies).toEqual([{ name: 'Seed trays', amount: '1' }, { name: 'Heat mat', amount: '' }]);
  });

  it('the basics link shows only for plant guides', async () => {
    stub();
    mount('/library/guides/new');
    await screen.findByLabelText('Title');
    expect(screen.queryByLabelText('Builds on the basics guide')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Plant'), '1');
    expect(screen.getByLabelText('Builds on the basics guide')).toBeInTheDocument();
  });

  it('a new guide opened from a plant starts with that plant', async () => {
    stub();
    mount('/library/guides/new?plant=1');
    expect(await screen.findByLabelText('Plant')).toHaveValue('1');
  });
});

describe('guide page in Spanish', () => {
  it('shows the starter plant name from the pack', async () => {
    stub();
    guides[5].plant = { id: 1, name: 'Tomato', starter_key: 'plant.tomato', is_starter: 1 };
    const ok = fetch.getMockImplementation();
    fetch.mockImplementation(async (url, opts) => {
      if (url === '/api/settings') return json({ language: 'es', time_zone: 'UTC', units: 'us' });
      if (url === '/api/locales/es/content') return json({ 'plant.tomato.name': 'Jitomate' });
      if (url === '/api/locales/es/ui') return json({});
      return ok(url, opts);
    });
    mount('/library/guides/5');
    expect(await screen.findByRole('link', { name: 'Jitomate' })).toHaveAttribute('href', '/library/plants/1');
  });
});

describe('guide conflict', () => {
  it('Use theirs keeps the steps and supplies from the other window', async () => {
    stub();
    const ok = fetch.getMockImplementation();
    fetch.mockImplementation(async (url, opts = {}) => {
      if (url === '/api/guides/5' && opts.method === 'PATCH') {
        return json({ error: 'changed', code: 'conflict', current: { ...guides[5], version: 9, steps: ['Their step.'], supplies: [{ name: 'Their tray', amount: null }] } }, 409);
      }
      return ok(url, opts);
    });
    mount('/library/guides/5/edit');
    await userEvent.type(await screen.findByLabelText('Title'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reload the latest' }));
    expect(await screen.findByDisplayValue('Their step.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Their tray')).toBeInTheDocument();
  });
});
