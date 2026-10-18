import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, stopServer, freshDataDir, removeDataDir } from './server.js';

let dir, proc;
test.beforeEach(async () => {
  dir = freshDataDir();
  const es = path.join(dir, 'locales', 'es');
  fs.mkdirSync(es, { recursive: true });
  fs.writeFileSync(path.join(es, 'ui.json'), JSON.stringify({ _name: 'Español', 'nav.today': 'Hoy', 'nav.settings': 'Ajustes', 'common.save': 'Guardar', 'settings.language': 'Idioma', 'settings.units.metric': 'Métrico' }));
  proc = await startServer(dir);
});
test.afterEach(async () => { await stopServer(proc); removeDataDir(dir); });

test('switching to Spanish and metric sticks after a restart', async ({ page }) => {
  await page.goto('/settings');
  await page.getByLabel('Language').selectOption('es');
  await page.getByRole('radio', { name: /Metric/ }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('link', { name: 'Hoy' })).toBeVisible();

  await stopServer(proc);
  proc = await startServer(dir);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Ajustes' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Métrico' })).toBeChecked();
});

test('Settings rows wrap on a phone: nothing sticks out or overlaps', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Backups' })).toBeVisible();
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.screen);
});
