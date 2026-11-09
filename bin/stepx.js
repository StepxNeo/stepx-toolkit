#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Store } from '../src/store.js';
import { ENDPOINTS } from '../src/sdk.js';
import { BrowserLogin } from '../src/login.js';
import { makeClient, executeWorkflow, startServer, decodeFiles } from '../src/server.js';
import { DEFAULT_SCHEDULE, validateSchedule, Scheduler } from '../src/scheduler.js';

const HELP = `StepX Toolkit（非官方，Node 22+）
  npm start                              本地可视化界面 127.0.0.1:3210
  npm run cli -- serve --port 3210        指定本地端口（仅回环监听）
  npm run cli -- login                   打开官方浏览器；登录后回终端提取 Cookie
  npm run cli -- login --sms             交互输入手机号和短信验证码（请求一次短信）
  npm run cli -- login --check           仅检查公钥协议，不发送短信
  npm run cli -- auth import --file ./secret.json   导入 {cookie,token}，不放命令行参数
  npm run cli -- auth export --file ./secret.json   显式导出（目标须不存在）
  npm run cli -- auth status|verify|clear
  npm run cli -- endpoints               列出全部支持接口
  npm run cli -- call task.getBalance
  npm run cli -- call projects.get --args '{"path":{"id":"YOUR_ID"}}'
  npm run cli -- call task.sign --yes     写操作必须 --yes
  npm run cli -- call attachments.upload --file ./image.png --field file --yes
  npm run cli -- workflow inspect|enter|sign|verify|all [--yes]
  npm run cli -- schedule show|disable
  npm run cli -- schedule set --time 09:00 --timezone Asia/Shanghai
  npm run cli -- schedule run             常驻调度器（与 Web 二选一）
  npm run cli -- history
环境变量 STEPX_HOME / STEPX_COOKIE / STEPX_TOKEN / STEPX_API_ORIGIN / STEPX_TASK_ORIGIN。
密码仅在官方窗口输入（若官方提供）。遇人工验证码请改用浏览器。`;
function parse(argv) {
  const positional = []; const flags = {}; const boolean = new Set(['yes', 'sms', 'check', 'help']);
  const values = new Set(['port', 'file', 'args', 'field', 'time', 'timezone']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const key = arg.slice(2);
    if (boolean.has(key)) flags[key] = true;
    else if (values.has(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
    else throw new Error('未知参数或缺失值，请运行 --help');
  }
  return { positional, flags };
}
function print(value) { console.log(JSON.stringify(value, null, 2)); }
function confirmed(flags) { if (!flags.yes) throw new Error('此操作会写入上游，核对参数后显式添加 --yes'); }
async function waitForShutdown(cleanup) {
  await new Promise(resolve => {
    const stop = async () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); await cleanup(); resolve(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  });
}
async function main() {
  const { positional: [command = 'help', sub], flags } = parse(process.argv.slice(2));
  if (command === 'help' || flags.help) return console.log(HELP);
  const store = new Store();
  if (command === 'serve') {
    const release = await store.lock('daemon'); let app;
    try { app = await startServer(store, { port: flags.port ? Number(flags.port) : 3210 }); console.log(`StepX 本地面板：${app.url}\n凭据只保存在 ${store.dir}，按 Ctrl+C 停止。`); await waitForShutdown(() => app.close()); }
    finally { await release(); } return;
  }
  if (command === 'endpoints') return print(ENDPOINTS);
  if (command === 'login') {
    const cli = createInterface({ input: stdin, output: stdout });
    try {
      if (flags.sms || flags.check) {
        const { SmsLogin, checkProtocol } = await import('../src/sms-login.js');
        if (flags.check) { await checkProtocol(); return console.log('公钥协议检查通过；未发送短信'); }
        const sms = new SmsLogin(store);
        try {
          console.log('将向你自己的手机号发送一次短信；风控时请改用官方浏览器。');
          const started = await sms.start({ phone: (await cli.question('手机号：')).trim() });
          print(started);
          if (started.state !== 'waiting') { process.exitCode = 2; return; }
          const completed = await sms.complete({ code: (await cli.question('短信验证码：')).trim() });
          print(completed);
          if (completed.state !== 'saved') process.exitCode = 2;
        } finally { await sms.cancel(); }
      } else {
        const login = new BrowserLogin(store);
        try { print(await login.start()); await cli.question('在官方窗口完成登录后按回车提取 Cookie（Ctrl+C 取消）：'); print(await login.capture()); }
        finally { await login.cancel(); }
      }
    } finally { cli.close(); } return;
  }
  if (command === 'auth') {
    if (sub === 'status') { const s = await store.session(); return print({ hasCookie: !!s.cookie, hasToken: !!s.token, directory: store.dir }); }
    if (sub === 'clear') { if (process.env.STEPX_COOKIE || process.env.STEPX_TOKEN) throw new Error('请先移除环境变量凭据'); await store.saveSession({}); return print({ cleared: true, note: '仅删除本地文件中的凭据；远程注销须去官方页面执行' }); }
    if (sub === 'import') { if (!flags.file) throw new Error('需要 --file'); await store.saveSession(JSON.parse(await readFile(flags.file, 'utf8'))); return print({ saved: true, note: '尚未验证，请运行 auth verify' }); }
    if (sub === 'export') { if (!flags.file) throw new Error('需要 --file'); await writeFile(flags.file, JSON.stringify(await store.session(), null, 2), { mode: 0o600, flag: 'wx' }); return console.log('已导出敏感凭据，请勿上传仓库或分享'); }
    if (sub === 'verify') {
      const client = await makeClient(store); const result = {};
      for (const [key, call] of [['studio', () => client.identity.me()], ['task', () => client.task.getBalance()]]) {
        try { const data = await call(); result[key] = { ok: key === 'task' ? Number.isFinite(Number(data?.balance)) && data?.balance !== '' && data?.balance != null : !!(data?.userId || data?.data?.userId || data?.user?.userId) }; }
        catch { result[key] = { ok: false }; }
      }
      if (!result.task.ok) process.exitCode = 2; return print(result);
    }
  }
  if (command === 'call') {
    const endpoint = ENDPOINTS.find(e => e.name === sub); if (!endpoint) throw new Error('未知接口，运行 endpoints 查看');
    if (endpoint.method !== 'GET') confirmed(flags);
    const args = JSON.parse(flags.args || '{}');
    if (flags.file) args.files = await decodeFiles({ [flags.field || 'file']: { base64: (await readFile(flags.file)).toString('base64'), filename: flags.file.split(/[\\/]/).pop() } });
    print(await (await makeClient(store)).call(sub, args)); return;
  }
  if (command === 'workflow') {
    const step = sub || 'inspect'; if (!['inspect', 'verify'].includes(step)) confirmed(flags);
    print(await executeWorkflow(store, step)); return;
  }
  if (command === 'schedule') {
    if (sub === 'show') return print(await store.read('schedule', DEFAULT_SCHEDULE));
    if (sub === 'set' || sub === 'disable') {
      const old = await store.read('schedule', DEFAULT_SCHEDULE);
      const value = validateSchedule(sub === 'disable' ? { ...old, enabled: false } : { enabled: true, time: flags.time, timezone: flags.timezone || 'Asia/Shanghai' });
      await store.write('schedule', { ...old, ...value }); return print({ ...value, note: '需保持 Web 或 schedule run 常驻，关机不执行' });
    }
    if (sub === 'run') {
      const release = await store.lock('daemon'); const scheduler = new Scheduler(store, () => executeWorkflow(store, 'all'));
      try { scheduler.start(); console.log('定时器已启动；按 Ctrl+C 退出'); await waitForShutdown(async () => scheduler.stop()); }
      finally { await release(); } return;
    }
  }
  if (command === 'history') return print(await store.read('history', []));
  throw new Error('未知命令，请运行 --help');
}
main().catch(error => { console.error(error.name === 'StepXError' ? `上游请求失败：${error.code || 'REQUEST_ERROR'}（HTTP ${error.status || '-'}）` : /^(未知|此操作|需要|请|已有|本地|无效|凭据|任务|未发现|签到|无法|验证码|手机号|账号|登录|发送|公钥|接口|仅|操作)/.test(error.message) ? error.message : '操作失败，请检查网络、配置或本地路径（未输出敏感响应）'); process.exitCode = 1; });
