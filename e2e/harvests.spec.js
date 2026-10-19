import http from 'node:http';
import { test, expect } from '@playwright/test';
import { startServer, stopServer, freshDataDir, removeDataDir } from './server.js';

let dir, proc;
test.beforeEach(async () => { dir = freshDataDir(); proc = await startServer(dir); });
test.afterEach(async () => { await stopServer(proc); removeDataDir(dir); });

const thisYear = new Date().getUTCFullYear();
async function setup(request) {
  await request.put('/api/settings', { data: { units: 'us', time_zone: 'UTC' } });
  const home = await (await request.post('/api/places', { data: { name: 'Springfield', last_frost: '04-01', first_frost: '10-30', zone: '7b', time_zone: 'UTC' } })).json();
  const bed = await (await request.post('/api/spaces', { data: { place_id: home.id, name: 'North bed', kind: 'bed' } })).json();
  const tomato = await (await request.post('/api/plants', { data: { name: 'Paste tomato', kind: 'vegetable', yield_kg: 4.5, yield_per: 'plant',
    preserves: [{ form: 'Sauce', unit: 'quart', raw_kg: 4.5 }] } })).json();
  const planting = await (await request.post('/api/plantings', { data: { space_id: bed.id, plant_id: tomato.id, how_started: 'start', start_on: `${thisYear}-01-02`, count: 4 } })).json();
  return { home, bed, tomato, planting };
}

async function recordHarvest(page, planting, { amount, larder = '', sold = '', price = '' }) {
  await page.goto(`/plantings/${planting.id}`);
  await page.getByRole('region', { name: 'Harvests' }).getByRole('button', { name: 'Record a harvest' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount').fill(amount);
  if (larder) await dialog.getByLabel('To the larder').fill(larder);
  if (sold) await dialog.getByLabel('Sold').fill(sold);
  if (price) await dialog.getByLabel('Price').fill(price);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
}

// A pretend Hearth & Larder on its own port, recording what it is sent.
function fakeLarder(port = 0) {
  const got = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      got.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, got, port: server.address().port })));
}
const close = server => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); });

test('record a harvest with a split, see it in the summary', async ({ page, request }) => {
  const s = await setup(request);
  await recordHarvest(page, s.planting, { amount: '10', larder: '4', sold: '2', price: '12' });
  const box = page.getByRole('region', { name: 'Harvests' });
  await expect(box).toContainText('10 lb');
  await expect(box).toContainText('4 lb to the larder');
  await page.goto(`/harvests?tab=summary&year=${thisYear}`);
  const row = page.getByRole('table', { name: 'By crop' }).getByRole('row', { name: /Paste tomato/ });
  await expect(row).toContainText('10 lb');
  await expect(row).toContainText('12');
  await expect(page.getByRole('table', { name: 'By place' })).toContainText('Springfield');
});

test('with the link on and a fake Hearth & Larder, a harvest is sent; with it closed, it shows Not sent and Send again works', async ({ page, request }) => {
  const s = await setup(request);
  let fake = await fakeLarder();
  const { port } = fake;
  await request.put('/api/settings', { data: { larder_link: true, larder_url: `http://127.0.0.1:${port}` } });
  await recordHarvest(page, s.planting, { amount: '5', larder: '2' });
  await expect.poll(() => fake.got.length).toBe(1);
  expect(fake.got[0]).toMatchObject({ method: 'PUT', body: { crop: 'Paste tomato', unit: 'lb', quantity: 2 } });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Harvests' })).toContainText('Sent');

  await close(fake.server);
  await recordHarvest(page, s.planting, { amount: '3', larder: '1' });
  const harvests = async () => (await request.get(`/api/harvests?planting_id=${s.planting.id}`)).json();
  await expect.poll(async () => (await harvests()).map(h => h.larder_state).sort().join()).toBe('failed,sent');
  await page.reload();
  const box = page.getByRole('region', { name: 'Harvests' });
  await expect(box).toContainText('Not sent');

  fake = await fakeLarder(port);
  await box.getByRole('button', { name: 'Send again' }).click();
  await expect.poll(async () => (await harvests()).map(h => h.larder_state).join()).toBe('sent,sent');
  await page.reload();
  await expect(box.getByText('Not sent')).toHaveCount(0);
  await close(fake.server);
});

test('set a goal, see the suggestion, plan the plantings for next year and see them in To buy', async ({ page, request }) => {
  await setup(request);
  const next = thisYear + 1;
  await page.goto('/plan');
  await page.getByRole('button', { name: 'Add a goal' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Plant').selectOption({ label: 'Paste tomato' });
  await dialog.getByLabel('Jars to put up').check();
  await dialog.getByLabel('Preserving form').selectOption({ label: 'Sauce (quart)' });
  await dialog.getByLabel('How many').fill('24');
  await dialog.getByRole('button', { name: 'Save' }).click();
  const goal = page.locator('li', { hasText: 'Paste tomato' });
  await expect(goal).toContainText('about 24 plants');
  await goal.getByRole('link', { name: 'Plan plantings' }).click();
  await expect(page.getByLabel('How many plants')).toHaveValue('24');
  await page.getByLabel('Start date').fill(`${next}-03-01`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Paste tomato' })).toBeVisible();
  await page.goto(`/plan?tab=to-buy&year=${next}`);
  const seeds = page.getByRole('region', { name: 'Seeds' });
  await expect(seeds).toContainText('Paste tomato');
  await expect(seeds).toContainText('24 plants');
  await expect(seeds).toContainText('North bed');
});
