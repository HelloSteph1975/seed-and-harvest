import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet, Link } from 'react-router-dom';
import { ToastProvider } from '../../client/src/components/ToastProvider.jsx';
import { ConfirmProvider } from '../../client/src/components/ConfirmProvider.jsx';
import { LeaveGuardProvider } from '../../client/src/components/LeaveGuardProvider.jsx';
import { PhotoGallery } from '../../client/src/components/PhotoGallery.jsx';

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
let photo;
let patches;
let conflictOnce;
function stub() {
  photo = { id: 3, owner_type: 'space', owner_id: 5, filename: '1-abcdef12.png', caption: null, is_cover: 0, version: 1 };
  patches = [];
  conflictOnce = null;
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const m = opts.method ?? 'GET';
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    if (url.startsWith('/api/photos?')) return json([photo]);
    if (url === '/api/photos/3' && m === 'PATCH') {
      patches.push(body);
      if (conflictOnce) { const current = { ...photo, ...conflictOnce, version: photo.version + 1 }; photo = current; conflictOnce = null; return json({ error: 'changed', code: 'conflict', current }, 409); }
      if (body.version !== photo.version) return json({ error: 'changed', code: 'conflict', current: photo }, 409);
      const { version, is_cover, ...rest } = body;
      photo = { ...photo, ...rest, ...(is_cover ? { is_cover: 1 } : {}), version: photo.version + 1 };
      return json(photo);
    }
    return json({}, 404);
  }));
}
function mount() {
  const router = createMemoryRouter([{
    element: <ToastProvider><ConfirmProvider><LeaveGuardProvider><Outlet /></LeaveGuardProvider></ConfirmProvider></ToastProvider>,
    children: [
      { path: '/', element: <><Link to="/away">Away</Link><PhotoGallery ownerType="space" ownerId={5} /></> },
      { path: '/away', element: <p>Somewhere else</p> },
    ],
  }], { initialEntries: ['/'] });
  render(<RouterProvider router={router} />);
}
afterEach(() => vi.unstubAllGlobals());

describe('PhotoGallery', () => {
  it('a caption and then the cover save one after the other, each with the latest version', async () => {
    stub();
    mount();
    const caption = await screen.findByLabelText('Caption for photo 1');
    await userEvent.type(caption, 'Spring');
    await userEvent.click(screen.getByRole('button', { name: 'Make this the cover photo' }));
    await vi.waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[0]).toMatchObject({ caption: 'Spring', version: 1 });
    expect(patches[1]).toMatchObject({ is_cover: true, version: 2 });
    expect(screen.queryByText(/changed somewhere else/i)).not.toBeInTheDocument();
  });

  it('a caption still being typed asks before leaving', async () => {
    stub();
    mount();
    const caption = await screen.findByLabelText('Caption for photo 1');
    fireEvent.change(caption, { target: { value: 'Half typed' } });
    await userEvent.click(screen.getByRole('link', { name: 'Away' }));
    expect(await screen.findByText('Leave without saving?')).toBeInTheDocument();
  });

  it('after a caption conflict, leaving the field does not save over the other window; Keep mine does', async () => {
    stub();
    conflictOnce = { caption: 'From the other window' };
    mount();
    const caption = await screen.findByLabelText('Caption for photo 1');
    await userEvent.type(caption, 'Mine');
    fireEvent.blur(caption);
    expect(await screen.findByText(/changed in another window/i)).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByLabelText('Caption for photo 1')).toHaveValue('From the other window'));
    fireEvent.focus(screen.getByLabelText('Caption for photo 1'));
    fireEvent.blur(screen.getByLabelText('Caption for photo 1'));
    expect(patches).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    await vi.waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toMatchObject({ caption: 'Mine', version: 2 });
  });
});
