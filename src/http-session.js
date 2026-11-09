import { CookieJar } from 'tough-cookie';

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_BODY = 2 * 1024 * 1024;

/** HTTPS-only session; cookies are scoped by RFC domain/path/secure/expiry rules. */
export class HttpSession {
  constructor({ allowedHosts = [], fetchImpl = globalThis.fetch, timeoutMs = 20000, maxBodyBytes = MAX_BODY } = {}) {
    if (!Array.isArray(allowedHosts) || allowedHosts.some(host => typeof host !== 'string' || !/^[a-z0-9.-]+$/.test(host)) ||
        typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
        !Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) throw new Error('无效的 HTTP 会话配置');
    this.allowedHosts = new Set(allowedHosts);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxBodyBytes = Math.min(maxBodyBytes, MAX_BODY);
    this.jar = new CookieJar();
    this.controllers = new Set();
    this.closed = false;
  }

  validateUrl(input) {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !this.allowedHosts.has(url.hostname) || (url.port && url.port !== '443') || url.username || url.password) {
      throw new Error('安全限制：请求或重定向地址不在 HTTPS 官方域名白名单');
    }
    return url;
  }

  async cookie(url) { return this.jar.getCookieString(this.validateUrl(url).href); }
  async cookieHeader(url) { return this.cookie(url); }
  async setCookie(value, url) { return this.jar.setCookie(value, this.validateUrl(url).href); }
  async clear() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    await this.jar.removeAllCookies();
  }

  async request(input, options = {}) {
    if (this.closed) throw new Error('会话已销毁');
    let url = this.validateUrl(input);
    const controller = new AbortController();
    this.controllers.add(controller);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(new Error('请求超时')), this.timeoutMs);
    let method = (options.method || 'GET').toUpperCase();
    let body = options.body;
    const headers = new Headers(options.headers);
    // Never carry a caller-supplied Cookie header across scopes. Use the jar API instead.
    headers.delete('cookie');
    try {
      for (let hops = 0; ; hops++) {
        signal.throwIfAborted();
        const cookie = await this.cookie(url.href);
        if (cookie) headers.set('cookie', cookie); else headers.delete('cookie');
        const response = await withSignal(this.fetchImpl(url.href, { ...options, method, body, headers: new Headers(headers), redirect: 'manual', signal }), signal);
        signal.throwIfAborted();
        // Node's getSetCookie preserves separate fields, including Expires commas.
        const setCookies = response.headers.getSetCookie?.() || [];
        for (const value of setCookies) {
          try { await this.jar.setCookie(value, url.href); } catch { /* Reject invalid or cross-domain cookies. */ }
        }
        const location = response.headers.get('location');
        if (REDIRECTS.has(response.status) && location) {
          await response.body?.cancel();
          if (hops >= 5) throw new Error('重定向超过安全上限（5 跳）');
          const next = this.validateUrl(new URL(location, url).href);
          if (next.origin !== url.origin) {
            headers.delete('authorization'); headers.delete('proxy-authorization');
            // A cross-origin 307/308 must not forward the encrypted login payload.
            if (body != null && response.status !== 303 && !([301, 302].includes(response.status) && method === 'POST')) {
              throw new Error('安全限制：禁止跨域重放请求正文');
            }
          }
          if (response.status === 303 && method !== 'HEAD' || [301, 302].includes(response.status) && method === 'POST') {
            method = 'GET'; body = undefined;
            headers.delete('content-type'); headers.delete('content-length');
          }
          url = next;
          continue;
        }
        const length = Number(response.headers.get('content-length'));
        if (Number.isFinite(length) && length > this.maxBodyBytes) {
          await response.body?.cancel(); throw new Error('响应正文超过 2MB 安全限制');
        }
        const chunks = []; let size = 0;
        if (response.body) {
          const reader = response.body.getReader();
          try {
            while (true) {
              // Race reads as mock/custom streams need not honor fetch's abort signal.
              const part = await readWithSignal(reader, signal);
              if (part.done) break;
              size += part.value.byteLength;
              if (size > this.maxBodyBytes) throw new Error('响应正文超过 2MB 安全限制');
              chunks.push(Buffer.from(part.value));
            }
          } catch (error) { void reader.cancel().catch(() => {}); throw error; }
          finally { reader.releaseLock(); }
        }
        signal.throwIfAborted();
        const result = new Response([204, 205, 304].includes(response.status) || method === 'HEAD' ? null : Buffer.concat(chunks), {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
        Object.defineProperty(result, 'url', { value: url.href });
        return result;
      }
    } finally { clearTimeout(timer); this.controllers.delete(controller); }
  }
}

function readWithSignal(reader, signal) { return withSignal(reader.read(), signal); }

function withSignal(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason || new Error('请求已取消')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
