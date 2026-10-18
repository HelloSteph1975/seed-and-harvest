import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';
import { ToastProvider } from '../../client/src/components/ToastProvider.jsx';
import { ConfirmProvider } from '../../client/src/components/ConfirmProvider.jsx';
import { LeaveGuardProvider } from '../../client/src/components/LeaveGuardProvider.jsx';
import { Places } from '../../client/src/screens/places/Places.jsx';
import { PlaceFormRoute } from '../../client/src/screens/places/PlaceForm.jsx';
import { PlacePageRoute } from '../../client/src/screens/places/PlacePage.jsx';

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
const OHIO = { label: 'Springfield, Ohio, United States', latitude: 39.92, longitude: -83.81, time_zone: 'America/New_York', country_code: 'US' };
const ILLINOIS = { label: 'Springfield, Illinois, United States', latitude: 39.80, longitude: -89.64, time_zone: 'America/Chicago', country_code: 'US' };
const ESTIMATE = { hemisphere: 'north', zone: '8a', last_frost: '03-18', first_frost: '11-12', frost_free: false, coldest_f: 12.3, years: 30, source: 'Open-Meteo' };

let rows;
let spaces;
let calls;
let override;
function stub() {
  rows = {
    1: { id: 1, name: 'Home', status: 'current', zone: '8a', last_frost: '03-18', first_frost: '11-12', frost_free: 0, wet_months: [], hemisphere: 'north', location: 'Springfield, Ohio, United States', time_zone: 'America/New_York', latitude: 39.92, longitude: -83.81, notes: null, sort_order: 0, version: 2 },
    2: { id: 2, name: 'Highlands', status: 'future', zone: null, last_frost: null, first_frost: null, frost_free: 1, wet_months: [6, 7, 8, 9, 10], hemisphere: 'north', location: null, time_zone: null, latitude: null, longitude: null, notes: null, sort_order: 10, version: 1 },
  };
  spaces = { 1: [{ id: 7, name: 'Bed 1', kind: 'bed' }, { id: 8, name: 'Big pot', kind: 'container' }], 2: [] };
  calls = [];
  override = null;
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const m = opts.method ?? 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, m, body });
    const hit = override?.(url, m, body);
    if (hit) return hit;
    if (url.startsWith('/api/climate/search')) return json([OHIO, ILLINOIS]);
    if (url.startsWith('/api/climate/estimate')) return json(ESTIMATE);
    if (url.startsWith('/api/spaces?place_id=')) return json(spaces[Number(url.split('=')[1])] ?? []);
    if (url === '/api/places' && m === 'GET') return json(Object.values(rows).filter(r => !r.deleted));
    if (url === '/api/places' && m === 'POST') {
      const r = { id: 20, version: 1, wet_months: [], frost_free: 0, ...body, frost_free: body.frost_free ? 1 : 0 };
      rows[20] = r;
      return json(r, 201);
    }
    const r = rows[Number(url.split('/')[3])];
    if (!r || r.deleted) return json({ error: 'Not found', code: 'not_found' }, 404);
    if (m === 'GET') return json(r);
    if (m === 'PATCH') {
      if (body.version !== r.version) return json({ error: 'changed', code: 'conflict', current: r }, 409);
      const { version, ...rest } = body;
      Object.assign(r, rest, { frost_free: rest.frost_free ? 1 : 0, version: r.version + 1 });
      return json(r);
    }
    if (m === 'DELETE') { r.deleted = true; return json({ ok: true }); }
    return json({}, 404);
  }));
}
let router;
function mount(path) {
  router = createMemoryRouter([{
    element: <ToastProvider><ConfirmProvider><LeaveGuardProvider><Outlet /></LeaveGuardProvider></ConfirmProvider></ToastProvider>,
    children: [
      { path: '/places', element: <Places /> },
      { path: '/places/new', element: <PlaceFormRoute /> },
      { path: '/places/:id', element: <PlacePageRoute /> },
      { path: '/places/:id/edit', element: <PlaceFormRoute /> },
    ],
  }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}
afterEach(() => vi.unstubAllGlobals());

async function lookUp() {
  await userEvent.type(await screen.findByLabelText('Town or city'), 'Springfield');
  await userEvent.click(screen.getByRole('button', { name: 'Look up' }));
}

describe('places list', () => {
  it('shows the current place first with its zone and frost dates', async () => {
    stub();
    mount('/places');
    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Home');
    expect(items[0]).toHaveTextContent('Current');
    expect(items[0]).toHaveTextContent('Zone 8a');
    expect(items[1]).toHaveTextContent('Frost-free');
  });
});

describe('places reorder', () => {
  it('moves only within its group: the first later place cannot jump above the current one', async () => {
    stub();
    rows[3] = { id: 3, name: 'Somewhere', status: 'future', frost_free: 0, wet_months: [], hemisphere: 'north', sort_order: 20, version: 1 };
    mount('/places');
    await screen.findByText('Somewhere');
    expect(screen.getByRole('button', { name: /up.*Highlands|Highlands.*up/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /down.*Home|Home.*down/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /up.*Somewhere|Somewhere.*up/i }));
    await vi.waitFor(() => expect(calls.find(c => c.url === '/api/places/reorder')).toBeDefined());
    expect(calls.find(c => c.url === '/api/places/reorder').body.items.map(i => i.id)).toEqual([1, 3, 2]);
  });
});

describe('place form', () => {
  it('look up fills the fields after picking a result', async () => {
    stub();
    mount('/places/new');
    await userEvent.type(await screen.findByLabelText('Name'), 'Farm');
    await lookUp();
    await userEvent.click(await screen.findByRole('button', { name: 'Springfield, Ohio, United States' }));
    expect(await screen.findByLabelText('Hardiness zone')).toHaveValue('8a');
    expect(screen.getByLabelText('Last spring frost')).toHaveValue('03-18');
    expect(screen.getByLabelText('First fall frost')).toHaveValue('11-12');
    expect(screen.getByLabelText('Location')).toHaveValue('Springfield, Ohio, United States');
    expect(screen.getByText(/Estimated from 30 years of weather records/)).toBeInTheDocument();
    expect(calls.some(c => c.url === '/api/climate/estimate?latitude=39.92&longitude=-83.81')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(rows[20]).toBeDefined());
    expect(rows[20]).toMatchObject({ name: 'Farm', zone: '8a', last_frost: '03-18', time_zone: 'America/New_York', latitude: 39.92, hemisphere: 'north' });
  });

  it('several results are listed with region and country', async () => {
    stub();
    mount('/places/new');
    await lookUp();
    expect(await screen.findByRole('button', { name: 'Springfield, Ohio, United States' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Springfield, Illinois, United States' })).toBeInTheDocument();
  });

  it('no results says so', async () => {
    stub();
    override = url => (url.startsWith('/api/climate/search') ? json([]) : null);
    mount('/places/new');
    await lookUp();
    expect(await screen.findByText('No places found by that name.')).toBeInTheDocument();
  });

  it('a failed lookup keeps what was typed and shows the weather-service message', async () => {
    stub();
    override = url => (url.startsWith('/api/climate/search')
      ? json({ error: "Couldn't reach the weather service. You can type the zone and frost dates yourself.", code: 'lookup_failed' }, 502) : null);
    mount('/places/new');
    await userEvent.type(await screen.findByLabelText('Name'), 'Farm');
    await userEvent.type(screen.getByLabelText('Hardiness zone'), '7b');
    await lookUp();
    expect(await screen.findByText(/Couldn't reach the weather service/)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Farm');
    expect(screen.getByLabelText('Hardiness zone')).toHaveValue('7b');
  });

  it('wet months show only for frost-free places', async () => {
    stub();
    mount('/places/new');
    await screen.findByLabelText('Name');
    expect(screen.queryByRole('group', { name: 'Rainy season months' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/frost-free/i));
    expect(screen.getByRole('group', { name: 'Rainy season months' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Last spring frost')).not.toBeInTheDocument();
  });

  it('missing frost date shows the reminder', async () => {
    stub();
    mount('/places/new');
    expect(await screen.findByText('Add both frost dates so the app can work out planting times.')).toBeInTheDocument();
  });

  it('saving sends the version and shows the saved place', async () => {
    stub();
    mount('/places/1/edit');
    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Home farm');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/places/1'));
    const patch = calls.find(c => c.m === 'PATCH');
    expect(patch.body).toMatchObject({ version: 2, name: 'Home farm' });
    expect(await screen.findByRole('heading', { name: 'Home farm' })).toBeInTheDocument();
  });
});

describe('place page', () => {
  it('the delete confirm counts the spaces', async () => {
    stub();
    mount('/places/1');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/2 spaces go to the Trash with it/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/places'));
    expect(rows[1].deleted).toBe(true);
  });

  it('lists its spaces', async () => {
    stub();
    mount('/places/1');
    expect(await screen.findByRole('link', { name: 'Bed 1' })).toHaveAttribute('href', '/spaces/7');
  });
});
