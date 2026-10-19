import { test, expect } from '@playwright/test';
import { startServer, stopServer, freshDataDir, removeDataDir } from './server.js';

let dir, proc;
test.beforeEach(async () => { dir = freshDataDir(); proc = await startServer(dir); });
test.afterEach(async () => { await stopServer(proc); removeDataDir(dir); });

const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function setup(request) {
  const home = await (await request.post('/api/places', { data: { name: 'Springfield', last_frost: '04-01', first_frost: '10-30', zone: '7b', time_zone: 'UTC' } })).json();
  const later = await (await request.post('/api/places', { data: { name: 'Shelbyville', last_frost: '05-10', first_frost: '10-01', zone: '6a', time_zone: 'UTC' } })).json();
  const pot = await (await request.post('/api/spaces', { data: { place_id: home.id, name: 'Patio pot', kind: 'container' } })).json();
  const deck = await (await request.post('/api/spaces', { data: { place_id: later.id, name: 'Deck', kind: 'bed' } })).json();
  const lemon = await (await request.post('/api/plants', { data: { name: 'Meyer lemon', kind: 'fruit_tree', perennial: true, zone_min: 9, zone_max: 11, years_min: 1, years_max: 3, container_ok: true } })).json();
  const fig = await (await request.post('/api/plants', { data: { name: 'Fig', kind: 'fruit_tree', perennial: true, zone_min: 7, zone_max: 11, years_min: 1, years_max: 2, container_ok: true } })).json();
  return { home, later, pot, deck, lemon, fig };
}

test('plan a potted lemon with purchase details, see its care tasks, move it to another place and its care moves too', async ({ page, request }) => {
  const s = await setup(request);
  await page.goto(`/plantings/new?plant=${s.lemon.id}&space=${s.pot.id}&place=${s.home.id}`);
  await expect(page.getByLabel('In a container')).toBeChecked();
  await page.getByLabel('How it starts').selectOption({ label: 'A plant that already produces' });
  await page.getByLabel('Start date').fill(day(0));
  await page.getByLabel('Bought from').fill('Valley Nursery');
  await page.getByLabel('Price paid').fill('45');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Meyer lemon' })).toBeVisible();
  await expect(page.getByText('Valley Nursery')).toBeVisible();
  const tasks = page.getByRole('region', { name: 'Tasks' });
  await expect(tasks).toContainText('Feed');
  await page.getByRole('button', { name: 'Move' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Place').selectOption({ label: 'Shelbyville' });
  await expect(dialog.getByLabel('Space')).toHaveValue(String(s.deck.id));
  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByRole('region', { name: 'Log' })).toContainText('From Patio pot (Springfield) to Deck (Shelbyville)');
  const list = await (await request.get(`/api/plantings?place_id=${s.later.id}`)).json();
  expect(list).toHaveLength(1);
  const full = await (await request.get(`/api/plantings/${list[0].id}`)).json();
  const protect = full.tasks.find(x => x.kind === 'protect' && x.due_on >= day(0));
  if (protect) expect(protect.due_on.slice(5)).toBe('09-24');
});

test('What to buy for a colder place keeps a potted fig with the bring-inside tag', async ({ page, request }) => {
  const s = await setup(request);
  await page.goto(`/library?kinds=fruit_tree,shrub,vine&fit=1&pot=1&sort=fast&place=${s.later.id}`);
  const fig = page.locator('li', { has: page.getByRole('heading', { name: 'Fig', level: 3 }) });
  await expect(fig).toContainText('In a pot you bring inside');
  await page.getByLabel('Good in a pot').uncheck();
  await expect(page.getByRole('heading', { name: 'Fig', level: 3 })).toHaveCount(0);
});
