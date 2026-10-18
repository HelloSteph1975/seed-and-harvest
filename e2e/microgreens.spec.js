import { test, expect } from '@playwright/test';
import { startServer, stopServer, freshDataDir, removeDataDir } from './server.js';

let dir, proc;
test.beforeEach(async () => { dir = freshDataDir(); proc = await startServer(dir); });
test.afterEach(async () => { await stopServer(proc); removeDataDir(dir); });

const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function setup(request) {
  const place = await (await request.post('/api/places', { data: { name: 'Springfield', last_frost: '04-01', time_zone: 'UTC' } })).json();
  const rack = await (await request.post('/api/spaces', { data: { place_id: place.id, name: 'Pantry rack', kind: 'microgreen_rack', tray_count: 6 } })).json();
  const mustard = await (await request.post('/api/plants', { data: { name: 'Mustard greens', kind: 'microgreen', days_min: 8, days_max: 12, seed_g_per_tray: 20, safety_goats: 'avoid' } })).json();
  const pea = await (await request.post('/api/plants', { data: { name: 'Pea shoots', kind: 'microgreen', days_min: 10, days_max: 14, seed_g_per_tray: 280, safety_goats: 'safe' } })).json();
  const goats = await (await request.post('/api/animals', { data: { name: 'The goats', kind: 'goat' } })).json();
  return { place, rack, mustard, pea, goats };
}

test('sow a tray for the goats, see the warning for an avoid crop, sow again and the next sowing moves', async ({ page, request }) => {
  const s = await setup(request);
  await page.goto('/microgreens/trays/new');
  await page.getByLabel('Crop').selectOption({ label: 'Mustard greens' });
  await page.getByLabel('For').selectOption({ label: 'The goats' });
  await expect(page.getByText(/Not safe for The goats/)).toBeVisible();
  await page.getByLabel('Crop').selectOption({ label: 'Pea shoots' });
  await expect(page.getByText(/Not safe for The goats/)).toHaveCount(0);
  await page.getByLabel('Repeat every (days)').fill('5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Pea shoots' })).toBeVisible();
  await expect(page.getByText(new RegExp(`next sowing`))).toBeVisible();
  await page.getByRole('button', { name: 'Sow again' }).click();
  await expect(page).toHaveURL(/\/microgreens\/trays\/\d+$/);
  const trays = await (await request.get(`/api/trays?place_id=${s.place.id}`)).json();
  expect(trays).toHaveLength(2);
  expect(trays.filter(x => x.next_sow_on).map(x => x.next_sow_on)).toEqual([day(5)]);
});

test('Today shows a tray ready to cut and Cut today moves it out', async ({ page, request }) => {
  const s = await setup(request);
  await request.post('/api/trays', { data: { plant_id: s.pea.id, space_id: s.rack.id, sown_on: day(-10), animal_id: s.goats.id } });
  await page.goto('/');
  const box = page.getByRole('region', { name: 'Microgreens' });
  await expect(box).toContainText('Pea shoots');
  await box.getByRole('button', { name: 'Cut today' }).click();
  await expect(page.getByRole('region', { name: 'Microgreens' })).toHaveCount(0);
});

test('deleting a rack takes its trays to the Trash and restore brings them back', async ({ page, request }) => {
  const s = await setup(request);
  const tray = await (await request.post('/api/trays', { data: { plant_id: s.pea.id, space_id: s.rack.id, sown_on: day(-2) } })).json();
  await page.goto(`/spaces/${s.rack.id}`);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(/Pantry rack is in the Trash/)).toBeVisible();
  await page.getByRole('link', { name: 'Trash' }).click();
  await page.locator('li', { hasText: 'Pantry rack' }).getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('The Trash is empty.')).toBeVisible();
  await page.goto(`/microgreens/trays/${tray.id}`);
  await expect(page.getByRole('heading', { name: 'Pea shoots' })).toBeVisible();
});
