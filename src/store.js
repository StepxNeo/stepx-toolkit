import { mkdir, readFile, writeFile, rename, chmod, open, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(dir = process.env.STEPX_HOME || join(homedir(), '.stepx-toolkit')) { this.dir = resolve(dir); this.queue = Promise.resolve(); }
  async init() { await mkdir(this.dir, { recursive: true, mode: 0o700 }); await chmod(this.dir, 0o700); }
  async read(name, fallback = {}) {
    await this.init();
    try { return JSON.parse(await readFile(join(this.dir, `${name}.json`), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error(`本地 ${name} 数据损坏或无法读取，请备份后检查`); }
  }
  async write(name, data) {
    const operation = this.queue.then(async () => {
      await this.init(); const dest = join(this.dir, `${name}.json`); const temp = `${dest}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temp, dest); await chmod(dest, 0o600);
    }); this.queue = operation.catch(() => {}); return operation;
  }
  async session() {
    const saved = await this.read('session');
    return { cookie: process.env.STEPX_COOKIE || saved.cookie || '', token: process.env.STEPX_TOKEN || saved.token || '' };
  }
  async saveSession(value) {
    const cookie = String(value.cookie || '').trim(); const token = String(value.token || '').trim();
    if (/[\r\n]/.test(cookie + token)) throw new Error('凭据不可包含换行');
    await this.write('session', { cookie, token });
  }
  async record(action, ok, summary) {
    // Only caller-owned summaries, never upstream response bodies or credentials.
    const items = await this.read('history', []);
    await this.write('history', [...items, { at: new Date().toISOString(), action, ok, summary }].slice(-200));
  }
  async lock(name) {
    await this.init(); const path = join(this.dir, `${name}.lock`); let handle;
    try { handle = await open(path, 'wx', 0o600); await handle.writeFile(String(process.pid)); }
    catch (e) { if (e.code === 'EEXIST') throw new Error(`已有 ${name} 进程或任务运行（崩溃后请核实进程再删除 ${path}）`); throw e; }
    return async () => { await handle.close(); await unlink(path).catch(() => {}); };
  }
}
