import { test, expect } from '@playwright/test';
import { startServer, stopServer, freshDataDir, removeDataDir } from './server.js';

let dir, proc;
test.beforeEach(async () => { dir = freshDataDir(); proc = await startServer(dir); });
test.afterEach(async () => { await stopServer(proc); removeDataDir(dir); });

const restart = async () => { await stopServer(proc); proc = await startServer(dir); };
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function setup(request) {
  const place = await (await request.post('/api/places', { data: { name: 'Springfield', last_frost: '04-01', first_frost: '10-30', time_zone: 'UTC' } })).json();
  const space = await (await request.post('/api/spaces', { data: { place_id: place.id, name: 'North bed', kind: 'bed' } })).json();
  const tomato = (await (await request.get('/api/plants?q=test tomato')).json())[0];
  return { place, space, tomato };
}

test('plan a planting from a plant page, see its tasks, tick one done, and it shows in the log after a restart', async ({ page, request }) => {
  const { tomato } = await setup(request);
  await page.goto(`/library/plants/${tomato.id}`);
  await page.getByRole('link', { name: 'Plan a planting' }).click();
  await page.getByLabel('Start date').fill(day(1));
  await expect(page.getByRole('region', { name: 'Tasks it will make' })).toContainText('Start seeds');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Test tomato' })).toBeVisible();
  await page.getByRole('checkbox', { name: /Start seeds/ }).check();
  await expect(page.getByRole('region', { name: 'Log' })).toContainText('Sowed');
  await restart();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Log' })).toContainText('Sowed');
  await expect(page.getByRole('checkbox', { name: /Start seeds/ })).toBeChecked();
});

test('Today lists an overdue task and the calendar shows it on its day', async ({ page, request }) => {
  const { space, tomato } = await setup(request);
  const start = day(-10);
  await request.post('/api/plantings', { data: { space_id: space.id, plant_id: tomato.id, how_started: 'seed_indoors', start_on: start } });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Overdue' })).toContainText('Start seeds');
  await page.goto(`/calendar?month=${start.slice(0, 7)}`);
  const date = new Date(`${start}T12:00:00Z`).toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  await expect(page.getByRole('button', { name: new RegExp(date) })).toContainText('Start seeds · Test tomato');
});

test('changing a planting\'s start date moves its untouched tasks', async ({ page, request }) => {
  const { space, tomato } = await setup(request);
  const p = await (await request.post('/api/plantings', { data: { space_id: space.id, plant_id: tomato.id, how_started: 'seed_indoors', start_on: '2030-02-10' } })).json();
  await page.goto(`/plantings/${p.id}`);
  await expect(page.locator('li', { hasText: 'Move outside' })).toContainText('Apr 11, 2030');
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Start date').fill('2030-02-17');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('li', { hasText: 'Move outside' })).toContainText('Apr 18, 2030');
});

test('deleting a space takes its plantings to the Trash and restore brings them back', async ({ page, request }) => {
  const { space, tomato } = await setup(request);
  const p = await (await request.post('/api/plantings', { data: { space_id: space.id, plant_id: tomato.id, how_started: 'start', start_on: '2030-04-10' } })).json();
  await page.goto(`/spaces/${space.id}`);
  await expect(page.getByRole('link', { name: 'Test tomato' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('link', { name: 'Trash' }).click();
  await page.locator('li', { hasText: 'North bed' }).getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('The Trash is empty.')).toBeVisible();
  await page.goto(`/plantings/${p.id}`);
  await expect(page.getByRole('heading', { name: 'Test tomato' })).toBeVisible();
});
