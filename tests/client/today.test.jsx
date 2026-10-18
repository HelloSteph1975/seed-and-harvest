import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { SettingsProvider } from '../../client/src/components/SettingsProvider.jsx';
import { Today } from '../../client/src/screens/today/Today.jsx';

const json = b => new Response(JSON.stringify(b), { status: 200 });
function stub({ places, spaces = [] }) {
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (url === '/api/settings') return json({ language: 'en', time_zone: 'UTC', units: 'us' });
    if (url === '/api/places') return json(places);
    if (url.startsWith('/api/spaces?place_id=')) return json(spaces);
    return json([]);
  }));
}
function mount() {
  const router = createMemoryRouter([{ path: '/', element: <SettingsProvider><Today /></SettingsProvider> }], { initialEntries: ['/'] });
  render(<RouterProvider router={router} />);
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Today', () => {
  it('welcomes a new gardener with no places', async () => {
    stub({ places: [] });
    mount();
    expect(await screen.findByText("Start by adding the place where you'll garden.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a place' })).toHaveAttribute('href', '/places/new');
  });

  it('asks which place is current when none is', async () => {
    stub({ places: [{ id: 1, name: 'Later', status: 'future', sort_order: 0, frost_free: 0, wet_months: [] }] });
    mount();
    expect(await screen.findByText('Which place are you gardening at now?')).toBeInTheDocument();
  });

  it('shows the current place and counts to the next frost', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-02-25T15:00:00Z'));
    stub({
      places: [{ id: 1, name: 'Home', status: 'current', zone: '8a', hemisphere: 'north', last_frost: '03-20', first_frost: '11-10', frost_free: 0, wet_months: [], time_zone: 'America/Chicago', sort_order: 0 }],
      spaces: [{ id: 5, name: 'Bed 1', kind: 'bed' }, { id: 6, name: 'Pot', kind: 'container' }],
    });
    mount();
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByText('Last spring frost in 23 days, around March 20.')).toBeInTheDocument();
    expect(screen.getByText('Zone 8a')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '2 growing spaces' })).toHaveAttribute('href', '/spaces?place=1');
  });

  it('shows the rainy season for a frost-free place', async () => {
    stub({ places: [{ id: 1, name: 'Valley', status: 'current', frost_free: 1, wet_months: [6, 7, 8, 9, 10], hemisphere: 'north', sort_order: 0 }] });
    mount();
    expect(await screen.findByText('Frost-free. Rainy season: June, July, August, September, October.')).toBeInTheDocument();
  });

  it('reminds about missing frost dates', async () => {
    stub({ places: [{ id: 1, name: 'Home', status: 'current', frost_free: 0, wet_months: [], hemisphere: 'north', sort_order: 0 }] });
    mount();
    expect(await screen.findByText('Add both frost dates so the app can work out planting times.')).toBeInTheDocument();
  });
});
