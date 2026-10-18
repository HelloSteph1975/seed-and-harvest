import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { ToastProvider } from '../../client/src/components/ToastProvider.jsx';
import { ConfirmProvider } from '../../client/src/components/ConfirmProvider.jsx';
import { LeaveGuardProvider } from '../../client/src/components/LeaveGuardProvider.jsx';
import { SettingsProvider } from '../../client/src/components/SettingsProvider.jsx';
import { Spaces } from '../../client/src/screens/spaces/Spaces.jsx';
import { SpaceFormRoute } from '../../client/src/screens/spaces/SpaceForm.jsx';
import { SpacePageRoute } from '../../client/src/screens/spaces/SpacePage.jsx';

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
const PLACES = [
  { id: 1, name: 'Later place', status: 'future', sort_order: 0, version: 1 },
  { id: 2, name: 'Home', status: 'current', sort_order: 10, version: 1 },
];
let spaces;
let calls;
let units;
function stub() {
  units = 'us';
  spaces = {
    5: { id: 5, place_id: 2, name: 'Bed 1', kind: 'bed', length_m: 3.048, width_m: 1.2192, pot_liters: null, tray_count: null, heated: 0, sun: 'full', notes: null, sort_order: 0, version: 4 },
    6: { id: 6, place_id: 2, name: 'Big pot', kind: 'container', length_m: null, width_m: null, pot_liters: 18.927, tray_count: null, heated: 0, sun: null, notes: null, sort_order: 10, version: 1 },
    9: { id: 9, place_id: 1, name: 'Far bed', kind: 'bed', sort_order: 0, version: 1 },
  };
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const m = opts.method ?? 'GET';
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ url, m, body });
    if (url === '/api/settings') return json({ language: 'en', time_zone: 'UTC', units });
    if (url === '/api/places') return json(PLACES);
    if (url.startsWith('/api/photos?')) return json([]);
    if (url.startsWith('/api/spaces?place_id=')) {
      const pid = Number(url.split('=')[1]);
      return json(Object.values(spaces).filter(s => s.place_id === pid));
    }
    if (url === '/api/spaces' && m === 'POST') { const r = { id: 30, version: 1, ...body }; spaces[30] = r; return json(r, 201); }
    const r = spaces[Number(url.split('/')[3])];
    if (!r) return json({ error: 'Not found', code: 'not_found' }, 404);
    if (m === 'GET') return json(r);
    if (m === 'PATCH') {
      const { version, ...rest } = body;
      Object.assign(r, rest, { version: r.version + 1 });
      return json(r);
    }
    return json({}, 404);
  }));
}
let router;
function mount(path) {
  router = createMemoryRouter([{
    element: <SettingsProvider><ToastProvider><ConfirmProvider><LeaveGuardProvider><Outlet /></LeaveGuardProvider></ConfirmProvider></ToastProvider></SettingsProvider>,
    children: [
      { path: '/spaces', element: <Spaces /> },
      { path: '/spaces/new', element: <SpaceFormRoute /> },
      { path: '/spaces/:id', element: <SpacePageRoute /> },
      { path: '/spaces/:id/edit', element: <SpaceFormRoute /> },
    ],
  }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

describe('spaces list', () => {
  it('the place picker defaults to the current place', async () => {
    stub();
    mount('/spaces');
    expect(await screen.findByRole('link', { name: 'Bed 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('Place')).toHaveValue('2');
    expect(screen.queryByRole('link', { name: 'Far bed' })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Place'), '1');
    expect(await screen.findByRole('link', { name: 'Far bed' })).toBeInTheDocument();
  });

  it("localStorage throwing doesn't break the list", async () => {
    stub();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    mount('/spaces');
    expect(await screen.findByRole('link', { name: 'Bed 1' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Place'), '1');
    expect(await screen.findByRole('link', { name: 'Far bed' })).toBeInTheDocument();
  });

  it('remembers the last place chosen', async () => {
    stub();
    localStorage.setItem('seed-harvest.spaces.place', '1');
    mount('/spaces');
    expect(await screen.findByRole('link', { name: 'Far bed' })).toBeInTheDocument();
  });
});

describe('spaces reorder', () => {
  it('moves only within its kind, and saves the order shown', async () => {
    stub();
    spaces = {
      1: { id: 1, place_id: 2, name: 'Bed A', kind: 'bed', sort_order: 0, version: 1 },
      2: { id: 2, place_id: 2, name: 'Pot C', kind: 'container', sort_order: 10, version: 1 },
      3: { id: 3, place_id: 2, name: 'Bed B', kind: 'bed', sort_order: 20, version: 1 },
    };
    mount('/spaces');
    await screen.findByRole('link', { name: 'Bed A' });
    expect(screen.getByRole('button', { name: /up.*Bed A|Bed A.*up/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /down.*Bed B|Bed B.*down/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /up.*Pot C|Pot C.*up/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /down.*Bed A|Bed A.*down/i }));
    await vi.waitFor(() => expect(calls.find(c => c.url === '/api/spaces/reorder')).toBeDefined());
    const sent = calls.find(c => c.url === '/api/spaces/reorder').body;
    expect(sent.place_id).toBe(2);
    expect(sent.items.map(i => i.id)).toEqual([3, 1, 2]);
  });

  it('opens the place named in the link, and the menu still changes place', async () => {
    stub();
    mount('/spaces?place=1');
    expect(await screen.findByRole('link', { name: 'Far bed' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Place'), '2');
    expect(await screen.findByRole('link', { name: 'Bed 1' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Far bed' })).not.toBeInTheDocument();
  });
});

describe('space form', () => {
  it('only the fields for the chosen kind show', async () => {
    stub();
    mount('/spaces/new?place=2');
    await userEvent.selectOptions(await screen.findByLabelText('Kind'), 'container');
    expect(screen.getByLabelText('Pot size (gal)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Length (ft)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Number of trays')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'microgreen_rack');
    expect(screen.getByLabelText('Number of trays')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'greenhouse');
    expect(screen.getByLabelText('Length (ft)')).toBeInTheDocument();
    expect(screen.getByLabelText('Heated')).toBeInTheDocument();
  });

  it("switching kind hides the old kind's field", async () => {
    stub();
    mount('/spaces/6/edit');
    expect(await screen.findByLabelText('Pot size (gal)')).toHaveValue('5');
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'bed');
    expect(screen.queryByLabelText('Pot size (gal)')).not.toBeInTheDocument();
  });

  it('in US units a 3.048 m bed shows 10 ft and an untouched save sends 3.048', async () => {
    stub();
    mount('/spaces/5/edit');
    expect(await screen.findByLabelText('Length (ft)')).toHaveValue('10');
    expect(screen.getByLabelText('Width (ft)')).toHaveValue('4');
    await userEvent.type(screen.getByLabelText('Name'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.find(c => c.m === 'PATCH')).toBeDefined());
    expect(calls.find(c => c.m === 'PATCH').body).toMatchObject({ version: 4, name: 'Bed 1!', length_m: 3.048, width_m: 1.2192 });
  });

  it('a typed size of 12 ft is sent as metres', async () => {
    stub();
    mount('/spaces/5/edit');
    const length = await screen.findByLabelText('Length (ft)');
    await userEvent.clear(length);
    await userEvent.type(length, '12');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(calls.find(c => c.m === 'PATCH')).toBeDefined());
    expect(calls.find(c => c.m === 'PATCH').body.length_m).toBeCloseTo(3.6576, 6);
  });

  it('metric units show metres', async () => {
    stub();
    units = 'metric';
    mount('/spaces/5/edit');
    expect(await screen.findByLabelText('Length (m)')).toHaveValue('3');
  });

  it('a size that is not a number is caught before saving', async () => {
    stub();
    mount('/spaces/5/edit');
    const length = await screen.findByLabelText('Length (ft)');
    await userEvent.clear(length);
    await userEvent.type(length, 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Type a number, like 12 or 3.5')).toBeInTheDocument();
    expect(calls.some(c => c.m === 'PATCH')).toBe(false);
  });

  it('a new space starts in the place from the link', async () => {
    stub();
    mount('/spaces/new?place=1');
    expect(await screen.findByLabelText('Place')).toHaveValue('1');
  });
});

describe('space page', () => {
  it('shows the size in the chosen units and its photos area', async () => {
    stub();
    mount('/spaces/5');
    expect(await screen.findByRole('heading', { name: 'Bed 1' })).toBeInTheDocument();
    expect(screen.getByText('10 × 4 ft')).toBeInTheDocument();
    expect(await screen.findByText(/Drop photos here/)).toBeInTheDocument();
  });
});
