import { test, expect } from '@playwright/test';
import { startServer, stopServer, freshDataDir, removeDataDir } from './server.js';

let dir, proc;
test.beforeEach(async () => { dir = freshDataDir(); proc = await startServer(dir); });
test.afterEach(async () => { await stopServer(proc); removeDataDir(dir); });

const restart = async () => { await stopServer(proc); proc = await startServer(dir); };

test('a new place and an edit survive a restart', async ({ page }) => {
  await page.goto('/places/new');
  await page.getByLabel('Name').fill('Back forty');
  await page.getByLabel('Hardiness zone').fill('7a');
  await page.getByLabel('Last spring frost').fill('04-05');
  await page.getByLabel('First fall frost').fill('10-25');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Back forty' })).toBeVisible();

  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Notes').fill('Sandy soil by the creek');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Sandy soil by the creek')).toBeVisible();

  await restart();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Back forty' })).toBeVisible();
  await expect(page.getByText('Sandy soil by the creek')).toBeVisible();
  await expect(page.getByText('April 5')).toBeVisible();
});

test('a space with a US-units size survives a restart unchanged', async ({ page, request }) => {
  await request.put('/api/settings', { data: { units: 'us' } });
  const place = await (await request.post('/api/places', { data: { name: 'Home' } })).json();
  await page.goto(`/spaces/new?place=${place.id}`);
  await page.getByLabel('Name').fill('Bed 1');
  await page.getByLabel('Length (ft)').fill('10');
  await page.getByLabel('Width (ft)').fill('4');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('10 × 4 ft')).toBeVisible();
  // Open and save again without touching the size: the stored metres stay exactly the same.
  const before = await (await request.get(`/api/spaces?place_id=${place.id}`)).json();
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Notes').fill('Tomatoes go here');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Tomatoes go here')).toBeVisible();
  await restart();
  const after = await (await request.get(`/api/spaces?place_id=${place.id}`)).json();
  expect(after[0].length_m).toBe(before[0].length_m);
  expect(after[0].width_m).toBe(before[0].width_m);
  await page.reload();
  await expect(page.getByText('10 × 4 ft')).toBeVisible();
});

test('delete a place, restore it from the Trash, and its spaces come back after a restart', async ({ page, request }) => {
  const place = await (await request.post('/api/places', { data: { name: 'Home' } })).json();
  await request.post('/api/spaces', { data: { place_id: place.id, name: 'Bed 1', kind: 'bed' } });
  await request.post('/api/spaces', { data: { place_id: place.id, name: 'Big pot', kind: 'container' } });
  await page.goto(`/places/${place.id}`);
  await expect(page.getByRole('link', { name: 'Bed 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toContainText('Its 2 spaces go to the Trash with it.');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Home is in the Trash.')).toBeVisible();
  await page.getByRole('link', { name: 'Trash' }).click();
  const row = page.locator('li', { hasText: 'Home' });
  await expect(row).toContainText('with 2 things inside');
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('The Trash is empty.')).toBeVisible();
  await restart();
  await page.goto(`/places/${place.id}`);
  await expect(page.getByRole('link', { name: 'Bed 1' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Big pot' })).toBeVisible();
});

test('back up, change something, restore, and the change is gone', async ({ page, request }) => {
  await request.post('/api/places', { data: { name: 'Before the backup' } });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText(/Backup made/)).toBeVisible();
  await request.post('/api/places', { data: { name: 'After the backup' } });
  await page.locator('li', { hasText: /^garden-/ }).first().getByRole('button', { name: 'Restore' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('li', { hasText: /^pre-restore-/ }).first()).toBeVisible();
  await page.goto('/places');
  await expect(page.getByText('Before the backup')).toBeVisible();
  await expect(page.getByText('After the backup')).toHaveCount(0);
});
