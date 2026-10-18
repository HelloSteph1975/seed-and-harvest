import { test, expect } from '@playwright/test';
import { startServer, stopServer, freshDataDir, removeDataDir } from './server.js';

let dir, proc;
test.beforeEach(async () => { dir = freshDataDir(); proc = await startServer(dir); });
test.afterEach(async () => { await stopServer(proc); removeDataDir(dir); });

const restart = async () => { await stopServer(proc); proc = await startServer(dir); };
const tomatoId = async request => (await (await request.get('/api/plants?q=test tomato')).json())[0].id;

test('a plant shows its planting dates for the current place and they change with the place picker', async ({ page, request }) => {
  await request.post('/api/places', { data: { name: 'Home', last_frost: '03-20', first_frost: '11-10' } });
  await request.post('/api/places', { data: { name: 'Warm valley', frost_free: true } });
  await page.goto(`/library/plants/${await tomatoId(request)}`);
  const box = page.getByRole('region', { name: /When to plant/ });
  await expect(box).toContainText('Start seeds indoors');
  await expect(box).toContainText('Move outside');
  await box.getByLabel('Place').selectOption({ label: 'Warm valley' });
  await expect(box).toContainText('Plant');
  await expect(box).not.toContainText('Start seeds indoors');
});

test('edit a starter plant, restart, the edit stays and the Starter tag is gone', async ({ page, request }) => {
  const id = await tomatoId(request);
  await page.goto(`/library/plants/${id}`);
  await expect(page.getByText('Starter', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Notes', { exact: true }).fill('Grows best by the south fence.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Grows best by the south fence.')).toBeVisible();
  await restart();
  await page.reload();
  await expect(page.getByText('Grows best by the south fence.')).toBeVisible();
  await expect(page.getByText('Starter', { exact: true })).toHaveCount(0);
});

test('delete a plant, restore it from the Trash with its guides', async ({ page, request }) => {
  const id = await tomatoId(request);
  await page.goto(`/library/plants/${id}`);
  await expect(page.getByRole('link', { name: 'Fixture: starting tomatoes' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Test tomato is in the Trash.')).toBeVisible();
  await page.getByRole('link', { name: 'Trash' }).click();
  await page.locator('li', { hasText: 'Test tomato' }).getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('The Trash is empty.')).toBeVisible();
  await page.goto(`/library/plants/${id}`);
  await expect(page.getByRole('link', { name: 'Fixture: starting tomatoes' })).toBeVisible();
});

test('search finds a plant and a guide', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search' }).fill('tomato');
  await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
  await expect(page.getByRole('region', { name: /Plants/ }).getByRole('link', { name: /Test tomato/ })).toBeVisible();
  await expect(page.getByRole('region', { name: /Guides/ }).getByRole('link', { name: /Fixture: starting tomatoes/ })).toBeVisible();
});

test('a new guide with reordered steps survives a restart', async ({ page }) => {
  await page.goto('/library?tab=guides');
  await page.getByRole('link', { name: 'Add a guide' }).click();
  await page.getByLabel('Title').fill('Mulching beds');
  await page.getByLabel('Step 1', { exact: true }).fill('Water the bed well.');
  await page.getByRole('button', { name: 'Add a step' }).click();
  await page.getByLabel('Step 2', { exact: true }).fill('Pull any weeds first.');
  await page.getByRole('button', { name: 'Move Step 2 up' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Mulching beds' })).toBeVisible();
  await restart();
  await page.reload();
  const steps = page.getByRole('list', { name: 'Steps' }).getByRole('listitem');
  await expect(steps).toHaveText(['Pull any weeds first.', 'Water the bed well.']);
});
