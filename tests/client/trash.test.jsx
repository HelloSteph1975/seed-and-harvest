import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { SettingsProvider } from '../../client/src/components/SettingsProvider.jsx';
import { ToastProvider } from '../../client/src/components/ToastProvider.jsx';
import { ConfirmProvider } from '../../client/src/components/ConfirmProvider.jsx';
import { Trash } from '../../client/src/screens/Trash.jsx';

const json = b => new Response(JSON.stringify(b), { status: 200 });
afterEach(() => vi.unstubAllGlobals());

describe('Trash', () => {
  it('shows translated names for starter plants and titles for starter guides', async () => {
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (url === '/api/settings') return json({ language: 'es', time_zone: 'UTC', units: 'us' });
      if (url === '/api/locales/es/content') return json({ 'plant.tomato.name': 'Jitomate', 'guide.basics.start-indoors.title': 'Sembrar semillas adentro' });
      if (url === '/api/locales/es/ui') return json({});
      if (url === '/api/trash') return json([
        { type: 'plant', id: 1, title: 'Tomato', deleted_at: '2027-01-01T00:00:00Z', starter_key: 'plant.tomato' },
        { type: 'guide', id: 2, title: 'Starting seeds indoors', deleted_at: '2027-01-01T00:00:00Z', starter_key: 'guide.basics.start-indoors' },
      ]);
      return json([]);
    }));
    const router = createMemoryRouter([{ path: '/', element: <SettingsProvider><ToastProvider><ConfirmProvider><Trash /></ConfirmProvider></ToastProvider></SettingsProvider> }]);
    render(<RouterProvider router={router} />);
    expect(await screen.findByText('Jitomate')).toBeInTheDocument();
    expect(screen.getByText('Sembrar semillas adentro')).toBeInTheDocument();
  });
});
