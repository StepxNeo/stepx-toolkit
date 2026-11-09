import { createClient } from './sdk.js';
export const OFFICIAL_LOGIN_URL = 'https://m.stepx.com/pages/users/login/index';
const TARGETS = [OFFICIAL_LOGIN_URL, 'https://otter-gateway.stepaos.com/api/step.otter.zhiyueapp.api/GetBalance'];
export class BrowserLogin {
  constructor(store) { this.store = store; this.state = { state: 'idle' }; this.browser = null; this.context = null; }
  status() { return { ...this.state }; }
  async start() {
    if (['opening', 'waiting'].includes(this.state.state)) throw new Error('已有登录窗口，请先完成或取消');
    this.state = { state: 'opening', message: '正在打开官方登录页面' };
    try {
      const { chromium } = await import('playwright');
      this.browser = await chromium.launch({ headless: false });
      this.context = await this.browser.newContext();
      this.browser.on('disconnected', () => { this.context = null; this.browser = null; if (this.state.state === 'waiting') this.state = { state: 'idle', message: '登录窗口已关闭' }; });
      const page = await this.context.newPage();
      await page.goto(TARGETS[0], { waitUntil: 'domcontentloaded', timeout: 60000 });
      this.state = { state: 'waiting', message: '请在官方窗口输入账号、验证码（或官方提供的密码方式），完成后点击提取 Cookie' };
    } catch {
      await this.cancel(); this.state = { state: 'error', message: '无法打开官方浏览器。请确认已安装 Chromium 且当前环境有桌面显示；无桌面服务器请使用 Cookie 导入。' };
      throw new Error(this.state.message);
    }
    return this.status();
  }
  async capture() {
    if (!this.context) throw new Error('请先打开官方登录窗口');
    // Only collect cookies that the browser would actually send to task gateway.
    const cookies = await this.context.cookies(TARGETS[1]);
    const session = cookies.find(c => c.name === 'DSESSIONID');
    if (!session) throw new Error('任务网关尚无 DSESSIONID，请先完成官方任务页登录；Studio 和任务域 Cookie 不可直接互换');
    const cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    await createClient({ cookie }).task.getBalance(); // validate before replacing stored credential
    await this.store.saveSession({ cookie });
    this.state = { state: 'saved', message: '任务网关 Cookie 已验证并保存在本机。Studio 跨域接口若未授权，请单独导入对应凭据。' };
    await this.close(); return this.status();
  }
  async close() { const browser = this.browser; this.context = null; this.browser = null; if (browser) await browser.close().catch(() => {}); }
  async cancel() { this.state = { state: 'idle' }; await this.close(); return this.status(); }
}
