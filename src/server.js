import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient, ENDPOINTS } from './sdk.js';
import { BrowserLogin } from './login.js';
import { SmsLogin } from './sms-login.js';
import { Scheduler, DEFAULT_SCHEDULE, validateSchedule } from './scheduler.js';
import { runWorkflow } from './workflow.js';

export async function makeClient(store) {
  return createClient({ ...await store.session(), apiOrigin: process.env.STEPX_API_ORIGIN, taskOrigin: process.env.STEPX_TASK_ORIGIN });
}
export async function executeWorkflow(store, step) {
  const release = await store.lock('workflow');
  try { return await runWorkflow(await makeClient(store), step); } finally { await release(); }
}
export async function decodeFiles(files = {}) {
  const result = {};
  for (const [key, file] of Object.entries(files)) {
    if (!file || typeof file.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) throw new Error('文件需使用合法 base64 编码');
    result[key] = { buffer: Buffer.from(file.base64, 'base64'), filename: String(file.filename || 'file'), type: String(file.type || 'application/octet-stream') };
  }
  return result;
}
async function body(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 12 * 1024 * 1024) throw new Error('请求过大（上限 12 MiB）'); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString() || '{}'); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
  catch { throw new Error('请求必须是 JSON 对象'); }
}
const FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/logo.svg': ['logo.svg', 'image/svg+xml'] };
export async function startServer(store, { port = 3210 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('无效端口');
  const csrf = randomBytes(32).toString('hex'); const login = new BrowserLogin(store); const sms = new SmsLogin(store);
  const scheduler = new Scheduler(store, () => executeWorkflow(store, 'all'));
  const server = createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const expected = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== expected) return json(403, { error: `仅接受 ${expected}，请使用 127.0.0.1 访问` });
      if (req.headers.origin && req.headers.origin !== `http://${expected}`) return json(403, { error: '拒绝跨站请求' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: '拒绝跨站请求' });
      const path = new URL(req.url, `http://${expected}`).pathname;
      if (req.method === 'GET' && FILES[path]) {
        const [file, type] = FILES[path]; const data = await readFile(new URL(`../web/${file}`, import.meta.url)); res.writeHead(200, { 'Content-Type': type }); return res.end(data);
      }
      if (req.method === 'GET' && path === '/api/bootstrap') {
        const session = await store.session(); return json(200, { csrf, session: { hasCookie: !!session.cookie, hasToken: !!session.token }, endpoints: ENDPOINTS, schedule: await store.read('schedule', DEFAULT_SCHEDULE), login: login.status() });
      }
      if (req.method === 'GET' && path === '/api/history') return json(200, { items: await store.read('history', []) });
      if (req.method === 'GET' && path === '/api/login/status') return json(200, login.status());
      if (req.method !== 'POST') return json(404, { error: 'Not found' });
      const token = String(req.headers['x-csrf-token'] || '');
      if (token.length !== csrf.length || !timingSafeEqual(Buffer.from(token), Buffer.from(csrf))) return json(403, { error: 'CSRF 校验失败，请刷新页面' });
      if (!String(req.headers['content-type']).startsWith('application/json')) return json(415, { error: '仅接受 application/json' });
      const input = await body(req);
      if (path === '/api/session') {
        if (input.clear && (process.env.STEPX_COOKIE || process.env.STEPX_TOKEN)) throw new Error('环境变量凭据仍然生效，请先在启动环境移除再清除会话');
        await store.saveSession(input.clear ? {} : input); return json(200, { saved: true });
      }
      if (path === '/api/session/export') return json(200, await store.session());
      if (path === '/api/sms/start') return json(200, await sms.start({ phone: input.phone }));
      if (path === '/api/sms/complete') return json(200, await sms.complete({ code: input.code }));
      if (path === '/api/sms/cancel') return json(200, await sms.cancel());
      if (path === '/api/login/start') return json(200, await login.start());
      if (path === '/api/login/capture') return json(200, await login.capture());
      if (path === '/api/login/cancel') return json(200, await login.cancel());
      if (path === '/api/schedule') {
        const old = await store.read('schedule', DEFAULT_SCHEDULE); const schedule = { ...old, ...validateSchedule(input) }; await store.write('schedule', schedule); return json(200, { schedule });
      }
      if (path === '/api/workflow') {
        const result = await executeWorkflow(store, input.step || 'all'); await store.record('workflow', true, '签到流程步骤完成'); return json(200, { result });
      }
      if (path === '/api/call') {
        const endpoint = ENDPOINTS.find(e => e.name === input.name);
        if (!endpoint) throw new Error('未知接口');
        if (endpoint.method !== 'GET' && input.confirm !== true) throw new Error('写操作必须显式确认 confirm=true');
        const args = input.args || {}; const result = await (await makeClient(store)).call(input.name, { ...args, files: await decodeFiles(args.files) });
        await store.record(endpoint.name, true, '接口调用成功'); return json(200, { result });
      }
      return json(404, { error: 'Not found' });
    } catch (error) {
      // Never return upstream body, headers, or messages that might echo credentials.
      const message = error.name === 'StepXError' ? `上游请求失败（HTTP ${error.status || '-'}，code ${error.code || '-'}），请检查凭据及接口资料` : error.message;
      json(400, { error: message });
    }
  });
  server.requestTimeout = 90000; server.headersTimeout = 15000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  scheduler.start();
  return { server, url: `http://127.0.0.1:${server.address().port}`, async close() { scheduler.stop(); await login.cancel(); await sms.cancel(); await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())); } };
}
