import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../client/src/App.jsx';

let saved;
let tested;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
function stub({ locales = [{ code: 'en', name: 'English' }, { code: 'es', name: 'Español' }] } = {}) {
  saved = { language: 'en', time_zone: 'UTC', units: 'us', larder_link: false, larder_url: 'http://127.0.0.1:4193' };
  tested = 0;
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    if (url === '/api/settings' && opts.method === 'PUT') { saved = { ...saved, ...JSON.parse(opts.body) }; return json(saved); }
    if (url === '/api/settings') return json(saved);
    if (url === '/api/locales') return json(locales);
    if (url.startsWith('/api/locales/')) return json({});
    if (url === '/api/settings/larder-test') { tested += 1; return json(tested === 1 ? { ok: true } : { ok: false, error: 'Hearth & Larder is not answering' }); }
    if (url === '/api/data-folder/open') return json({ error: 'Could not open the folder.' }, 500);
    if (url === '/api/health') return json({ ok: true, demo: false });
    if (url === '/api/data-folder') return json({ path: 'C:\\Data' });
    return json([]);
  }));
}
afterEach(() => { vi.unstubAllGlobals(); window.history.pushState({}, '', '/'); });

describe('Settings', () => {
  it('lists the language packs it finds', async () => {
    stub();
    window.history.pushState({}, '', '/settings');
    render(<App />);
    expect(await screen.findByRole('option', { name: 'Español' })).toBeInTheDocument();
  });
  it('hides the language picker when only English is available', async () => {
    stub({ locales: [{ code: 'en', name: 'English' }] });
    window.history.pushState({}, '', '/settings');
    render(<App />);
    expect(await screen.findByLabelText('Time zone')).toBeInTheDocument();
    expect(screen.queryByLabelText('Language')).not.toBeInTheDocument();
  });
  it('still shows the language picker when the saved language is not English', async () => {
    stub({ locales: [{ code: 'en', name: 'English' }] });
    saved.language = 'es';
    window.history.pushState({}, '', '/settings');
    render(<App />);
    expect(await screen.findByLabelText('Language')).toHaveValue('es');
  });
  it('says so when the data folder will not open', async () => {
    stub();
    window.history.pushState({}, '', '/settings');
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open folder' }));
    expect(await screen.findByText('Could not open the folder.')).toBeInTheDocument();
  });
  it('asks before leaving with an unsaved change', async () => {
    stub();
    window.history.pushState({}, '', '/settings');
    render(<App />);
    await userEvent.selectOptions(await screen.findByLabelText('Time zone'), 'Europe/Lisbon');
    await userEvent.click(screen.getAllByRole('link', { name: 'Today' })[0]);
    expect(await screen.findByText('Leave without saving?')).toBeInTheDocument();
  });
  it('keeps the draft on screen when a save fails and the reload fails too', async () => {
    stub();
    window.history.pushState({}, '', '/settings');
    render(<App />);
    await userEvent.selectOptions(await screen.findByLabelText('Time zone'), 'Europe/Lisbon');
    const ok = fetch.getMockImplementation();
    fetch.mockImplementation(async (url, opts) => {
      if (url === '/api/settings') throw new TypeError('Failed to fetch');
      return ok(url, opts);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(screen.getAllByText(/Can't reach Seed & Harvest/)).toHaveLength(2));
    expect(screen.getByLabelText('Time zone')).toHaveValue('Europe/Lisbon');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    fetch.mockImplementation(ok);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument());
    expect(screen.getByLabelText('Time zone')).toHaveValue('Europe/Lisbon');
  });
  it('shows a saved time zone that is not in the list, and sends only what changed', async () => {
    stub();
    saved.time_zone = 'Mars/Base';
    window.history.pushState({}, '', '/settings');
    render(<App />);
    expect(await screen.findByLabelText('Time zone')).toHaveValue('Mars/Base');
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'es');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(saved.language).toBe('es'));
    const put = fetch.mock.calls.find(([, o]) => o?.method === 'PUT');
    expect(JSON.parse(put[1].body)).toEqual({ language: 'es' });
  });
  it('switches units between US and metric', async () => {
    stub();
    window.history.pushState({}, '', '/settings');
    render(<App />);
    await userEvent.click(await screen.findByRole('radio', { name: /Metric/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(saved.units).toBe('metric'));
    const put = fetch.mock.calls.find(([, o]) => o?.method === 'PUT');
    expect(JSON.parse(put[1].body)).toEqual({ units: 'metric' });
  });
  it('the settings block saves the switch and address and shows the test result', async () => {
    stub();
    window.history.pushState({}, '', '/settings');
    render(<App />);
    const box = await screen.findByRole('checkbox', { name: 'Send the larder part of each harvest to Hearth & Larder' });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    const address = screen.getByLabelText('Hearth & Larder address');
    await userEvent.clear(address);
    await userEvent.type(address, 'http://localhost:4300');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(saved).toMatchObject({ larder_link: true, larder_url: 'http://localhost:4300' }));
    await userEvent.click(screen.getByRole('button', { name: 'Test the link' }));
    expect(await screen.findByText('Hearth & Larder answered.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Test the link' }));
    expect(await screen.findByText('Hearth & Larder is not answering')).toBeInTheDocument();
  });
});
