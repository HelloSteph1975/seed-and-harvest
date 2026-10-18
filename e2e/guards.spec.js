import { test, expect } from '@playwright/test';
import { startServer, stopServer, freshDataDir, removeDataDir } from './server.js';

let dir, proc;
test.beforeEach(async () => { dir = freshDataDir(); proc = await startServer(dir); });
test.afterEach(async () => { await stopServer(proc); removeDataDir(dir); });

test('two windows: the second save gets the conflict dialog, and Keep mine wins', async ({ browser, request }) => {
  const place = await (await request.post('/api/places', { data: { name: 'Home' } })).json();
  const a = await browser.newPage();
  const b = await browser.newPage();
  for (const p of [a, b]) await p.goto(`/places/${place.id}/edit`);
  await a.getByLabel('Notes').fill('From window A');
  await a.getByRole('button', { name: 'Save' }).click();
  await expect(a.getByText('From window A')).toBeVisible();

  await b.getByLabel('Notes').fill('From window B');
  await b.getByRole('button', { name: 'Save' }).click();
  await expect(b.getByText('This was changed somewhere else')).toBeVisible();
  await b.getByRole('button', { name: 'Keep mine and save over it' }).click();
  await expect(b.getByText('From window B')).toBeVisible();
  await a.reload();
  await expect(a.getByText('From window B')).toBeVisible();
});

test('an unsaved change asks before leaving', async ({ page }) => {
  await page.goto('/places/new');
  await page.getByLabel('Name').fill('Half typed');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Today' }).click();
  await expect(page.getByText('Leave without saving?')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/places\/new$/);
  await expect(page.getByLabel('Name')).toHaveValue('Half typed');
});

test("a late reply for the place you left doesn't show in the place you picked", async ({ page, request }) => {
  const home = await (await request.post('/api/places', { data: { name: 'Home' } })).json();
  const later = await (await request.post('/api/places', { data: { name: 'Later' } })).json();
  await request.post('/api/spaces', { data: { place_id: home.id, name: 'Home bed', kind: 'bed' } });
  await request.post('/api/spaces', { data: { place_id: later.id, name: 'Later bed', kind: 'bed' } });
  let delayed = false;
  await page.route(`**/api/spaces?place_id=${home.id}`, async route => {
    delayed = true;
    const res = await route.fetch();
    await new Promise(r => setTimeout(r, 2500)); // Home's list lands after Later was picked
    return route.fulfill({ response: res });
  });
  await page.goto('/spaces');
  await page.getByLabel('Place').selectOption(String(later.id));
  await expect(page.getByRole('link', { name: 'Later bed' })).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(page.getByRole('link', { name: 'Later bed' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Home bed' })).toHaveCount(0);
  expect(delayed).toBe(true);
});

test('when the server is closed, loads say so and Try again works once it is back', async ({ page }) => {
  await page.goto('/places');
  await expect(page.getByRole('heading', { name: 'Places' })).toBeVisible();
  await stopServer(proc);
  await page.getByRole('link', { name: 'Trash' }).click();
  await expect(page.getByText(/Can't reach Seed & Harvest/)).toBeVisible();
  proc = await startServer(dir);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('The Trash is empty.')).toBeVisible();
});

test('when the server is closed, a save keeps the form filled in', async ({ page }) => {
  await page.goto('/places/new');
  await page.getByLabel('Name').fill('Not lost');
  await stopServer(proc);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toContainText("Can't reach Seed & Harvest");
  await expect(page.getByLabel('Name')).toHaveValue('Not lost');
  proc = await startServer(dir);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Not lost' })).toBeVisible();
});
