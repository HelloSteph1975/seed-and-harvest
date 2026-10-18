import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { App } from '../../client/src/App.jsx';

const json = b => new Response(JSON.stringify(b), { status: 200 });
const RESULT = {
  q: 'pepper',
  groups: {
    plants: { total: 2, items: [{ id: 1, name: 'Sweet pepper', kind: 'vegetable', summary: 'Mild.', starter_key: 'plant.pepper', is_starter: 1 }, { id: 2, name: 'Hot pepper', kind: 'vegetable', summary: null, starter_key: null, is_starter: 0 }] },
    guides: { total: 1, items: [{ id: 7, title: 'Starting peppers', stage: 'start_indoors', plant_id: 1, plant_name: 'Sweet pepper', starter_key: null, is_starter: 0 }] },
    places: { total: 0, items: [] },
    spaces: { total: 0, items: [] },
  },
};
function stub() {
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (url === '/api/settings') return json({ language: 'en', time_zone: 'UTC', units: 'us' });
    if (url === '/api/health') return json({ ok: true, demo: false });
    if (url.startsWith('/api/search?')) return json(RESULT);
    return json([]);
  }));
}
afterEach(() => { vi.unstubAllGlobals(); window.history.pushState({}, '', '/'); });

describe('search', () => {
  it('submitting the box opens the results page', async () => {
    stub();
    render(<App />);
    const search = await screen.findByRole('search');
    fireEvent.change(within(search).getByRole('searchbox', { name: 'Search' }), { target: { value: 'pepper' } });
    fireEvent.submit(search);
    await vi.waitFor(() => expect(window.location.pathname).toBe('/search'));
    expect(window.location.search).toBe('?q=pepper');
  });

  it('shows a section per group with counts and links', async () => {
    stub();
    window.history.pushState({}, '', '/search?q=pepper');
    render(<App />);
    const plants = await screen.findByRole('region', { name: /Plants/ });
    expect(within(plants).getByText('2 found')).toBeInTheDocument();
    expect(within(plants).getByRole('link', { name: /Sweet pepper/ })).toHaveAttribute('href', '/library/plants/1');
    const guides = screen.getByRole('region', { name: /Guides/ });
    expect(within(guides).getByRole('link', { name: /Starting peppers/ })).toHaveAttribute('href', '/library/guides/7');
    expect(screen.queryByRole('region', { name: /Places/ })).not.toBeInTheDocument();
  });

  it('asks for at least two letters', async () => {
    stub();
    window.history.pushState({}, '', '/search?q=a');
    render(<App />);
    expect(await screen.findByText('Type at least two letters to search.')).toBeInTheDocument();
  });
});
