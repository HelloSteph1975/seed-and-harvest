import { test, expect } from '@playwright/test';
import { startServer, stopServer, freshDataDir, removeDataDir } from './server.js';

let dir, proc;
test.beforeEach(async () => { dir = freshDataDir(); proc = await startServer(dir); });
test.afterEach(async () => { await stopServer(proc); removeDataDir(dir); });

// A 1x1 PNG.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082', 'hex');
const fulfill = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('look up a town, pick it, save, and Today shows the frost countdown', async ({ page }) => {
  await page.route('**/api/climate/search**', route => fulfill(route, [
    { label: 'Springfield, Ohio, United States', latitude: 39.92, longitude: -83.81, time_zone: 'America/New_York', country_code: 'US' },
    { label: 'Springfield, Illinois, United States', latitude: 39.8, longitude: -89.64, time_zone: 'America/Chicago', country_code: 'US' },
  ]));
  // Frost dates far from any real day, so the countdown always has something to count to.
  await page.route('**/api/climate/estimate**', route => fulfill(route,
    { hemisphere: 'north', zone: '6a', last_frost: '04-20', first_frost: '10-20', frost_free: false, coldest_f: -7.4, years: 30, source: 'Open-Meteo' }));
  await page.goto('/');
  await page.getByRole('link', { name: 'Add a place' }).click();
  await page.getByLabel('Name').fill('Home');
  await page.getByLabel('Town or city').fill('Springfield');
  await page.getByRole('button', { name: 'Look up' }).click();
  await page.getByRole('button', { name: 'Springfield, Ohio, United States' }).click();
  await expect(page.getByLabel('Hardiness zone')).toHaveValue('6a');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Today' }).click();
  await expect(page.getByText(/(Last spring|First fall) frost (in \d+ days|tomorrow)|frost is around today/)).toBeVisible();
  await expect(page.getByText('Zone 6a')).toBeVisible();
});

test('a failed lookup keeps the form and lets you type the dates', async ({ page }) => {
  await page.route('**/api/climate/search**', route => fulfill(route,
    { error: "Couldn't reach the weather service. You can type the zone and frost dates yourself.", code: 'lookup_failed' }, 502));
  await page.goto('/places/new');
  await page.getByLabel('Name').fill('Home');
  await page.getByLabel('Town or city').fill('Springfield');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByText(/Couldn't reach the weather service/)).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue('Home');
  await page.getByLabel('Hardiness zone').fill('7b');
  await page.getByLabel('Last spring frost').fill('03-25');
  await page.getByLabel('First fall frost').fill('11-05');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('March 25')).toBeVisible();
});

test('a photo added to a space is still there after a restart', async ({ page, request }) => {
  const place = await (await request.post('/api/places', { data: { name: 'Home' } })).json();
  const space = await (await request.post('/api/spaces', { data: { place_id: place.id, name: 'Bed 1', kind: 'bed' } })).json();
  await page.goto(`/spaces/${space.id}`);
  await page.locator('input[type=file]').setInputFiles({ name: 'bed.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.gallery-item img')).toHaveCount(1);
  await stopServer(proc);
  proc = await startServer(dir);
  await page.reload();
  await expect(page.locator('.gallery-item img')).toHaveCount(1);
  const loaded = await page.locator('.gallery-item img').evaluate(img => img.complete && img.naturalWidth > 0);
  expect(loaded).toBe(true);
});
