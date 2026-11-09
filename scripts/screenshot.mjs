// Renders README screenshots from the real local UI using a throwaway store and
// synthetic demo data. No official network request is made and no real credential
// is involved: the session file contains a clearly fake placeholder cookie.
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Store } from '../src/store.js';
import { startServer } from '../src/server.js';

const DEMO_COOKIE_MARKER = 'DSESSIONID=demo-placeholder-not-a-real-session';
const dir = await mkdtemp(join(tmpdir(), 'stepx-shot-'));
const store = new Store(dir);
const now = Date.now();
await store.write('session', { cookie: DEMO_COOKIE_MARKER, token: '' });
await store.write('schedule', {
  enabled: true,
  time: '09:12',
  timezone: 'Asia/Shanghai',
  lastDate: '2026-01-01',
  lastRun: new Date(now - 3 * 3600_000).toISOString(),
  lastResult: 'success',
});
await store.write('history', [
  { at: new Date(now - 3 * 3600_000).toISOString(), action: 'schedule', ok: true, summary: '定时签到已核验（演示数据）' },
  { at: new Date(now - 26 * 3600_000).toISOString(), action: 'workflow', ok: true, summary: '签到流程步骤完成（演示数据）' },
  { at: new Date(now - 52 * 3600_000).toISOString(), action: 'task.list', ok: true, summary: '接口调用成功（演示数据）' },
  { at: new Date(now - 78 * 3600_000).toISOString(), action: 'identity.me', ok: true, summary: '接口调用成功（演示数据）' },
]);

let app;
let browser;
try {
  app = await startServer(store, { port: 0 });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.STEPX_TEST_CHROMIUM ? { executablePath: process.env.STEPX_TEST_CHROMIUM } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(app.url);
  await page.waitForFunction(() => document.getElementById('connection-state')?.textContent === '已连接');
  await page.waitForSelector('#history-list .history-item');
  await mkdir('docs/images', { recursive: true });
  await page.screenshot({ path: 'docs/images/dashboard.png', fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await mobile.goto(app.url);
  await mobile.waitForFunction(() => document.getElementById('connection-state')?.textContent === '已连接');
  await mobile.screenshot({ path: 'docs/images/dashboard-mobile.png', fullPage: true });
  console.log('Wrote docs/images/dashboard.png and docs/images/dashboard-mobile.png using synthetic demo data.');
} finally {
  if (browser) await browser.close();
  if (app) await app.close();
  await rm(dir, { recursive: true, force: true });
}
