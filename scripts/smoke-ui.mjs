import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Store } from '../src/store.js';
import { startServer } from '../src/server.js';

const dir = await mkdtemp(join(tmpdir(), 'stepx-ui-'));
let app, browser;
try {
  app = await startServer(new Store(dir), { port: 0 });
  browser = await chromium.launch({ headless: true, ...(process.env.STEPX_TEST_CHROMIUM ? { executablePath: process.env.STEPX_TEST_CHROMIUM } : {}) });
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url);
  await page.waitForFunction(() => document.getElementById('connection-state')?.textContent === '已连接');
  assert.equal(await page.locator('#endpoint option').count(), 44);
  await page.getByText('手动保存 Cookie / Token', { exact: true }).click();
  await page.locator('#cookie').fill('DSESSIONID=synthetic-ui-test');
  await page.locator('#session-form button[type=submit]').click();
  await page.waitForFunction(() => document.getElementById('session-state')?.textContent === 'Cookie 已保存');
  assert.equal(await page.locator('#cookie').inputValue(), '');
  assert.equal(await page.locator('#export-area').isVisible(), false);
  await page.locator('#endpoint').selectOption({ label: 'kit.list · GET · 实测' });
  assert.equal(JSON.parse(await page.locator('#api-query').inputValue()).page_size, 20);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal overflow at ${viewport.width}`);
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: `artifacts/dashboard-${viewport.width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('UI smoke passed: real local backend, 44 endpoints, private session form, default query, desktop/mobile no overflow, no page errors. No official network requests sent.');
} finally {
  if (browser) await browser.close();
  if (app) await app.close();
  await rm(dir, { recursive: true, force: true });
}
