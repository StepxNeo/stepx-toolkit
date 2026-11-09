import { randomBytes, createHmac, publicEncrypt, constants, createCipheriv, createDecipheriv, createPublicKey } from 'node:crypto';
import { HttpSession } from './http-session.js';
import { createClient } from './sdk.js';

const STUDIO = 'https://studio.stepx.com';
const API = 'https://studio-api.stepx.com';
const LOGIN = 'https://login-studio.stepx.com';
const TASK = 'https://otter-gateway.stepaos.com/api/step.otter.zhiyueapp.api';
const HOSTS = [STUDIO, API, LOGIN, TASK].map(url => new URL(url).hostname);
const APP_ID = 'safe-key-center-sdk';
// Public signing configuration shipped by the official frontend, NOT a server secret.
const PUBLIC_SIGNING_SECRET = 'bt6bI9U7wKl8FwT6tJ3u';
const TTL = 10 * 60 * 1000;

export function signingHeaders() {
  const nonce = randomBytes(16).toString('hex'); const timestamp = String(Date.now());
  return { 'zy-app-id':APP_ID, 'zy-nonce':nonce, 'zy-timestamp':timestamp,
    'zy-sign':createHmac('sha256', PUBLIC_SIGNING_SECRET).update(APP_ID + nonce + timestamp + PUBLIC_SIGNING_SECRET).digest('hex') };
}

export function createEnvelope(publicKeyPem, kid) {
  if (kid == null) throw new Error('公钥版本无效');
  kid = String(kid);
  if (!kid || /[.\r\n]/.test(kid)) throw new Error('公钥版本无效');
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyDetails?.modulusLength < 2048) throw new Error('公钥协议无效');
  const key = randomBytes(32); let destroyed = false;
  const encryptedKey = publicEncrypt({key:publicKey, padding:constants.RSA_PKCS1_OAEP_PADDING, oaepHash:'sha256'}, key);
  return {
    header:`kcv1.${kid}.${encryptedKey.toString('base64url')}`,
    encrypt(value) {
      if (destroyed) throw new Error('加密会话已销毁');
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64');
    },
    decrypt(value) {
      if (destroyed) throw new Error('加密会话已销毁');
      if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('加密响应格式无效');
      const bytes = Buffer.from(value, 'base64');
      if (bytes.length < 28) throw new Error('加密响应格式无效');
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0,12));
      cipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([cipher.update(bytes.subarray(12,-16)), cipher.final()]).toString('utf8');
    },
    destroy() { key.fill(0); destroyed = true; },
  };
}

async function jsonResponse(response, envelope) {
  if (!response.ok) throw new Error(response.status === 403 ? '安全限制：当前账号未获登录白名单授权' : '官方登录接口请求失败');
  let raw;
  try {
    raw = await response.json();
    if (response.headers.get('X-KC-Enc') === '1') {
      if (!envelope || typeof raw !== 'string') throw new Error();
      raw = JSON.parse(envelope.decrypt(raw));
    }
  } catch { throw new Error('官方登录响应格式或加密校验无效'); }
  return raw;
}

async function publicEnvelope(session) {
  const raw = await jsonResponse(await session.request(STUDIO + '/key-center/api/app/v1/envelope/public-key', {
    method:'POST', headers:{...signingHeaders(), 'content-type':'application/json'}, body:JSON.stringify({appId:'user-center'}),
  }));
  const data = raw?.data || raw;
  return createEnvelope(data?.publicKeyPem, data?.kid);
}

export async function checkProtocol({fetchImpl = globalThis.fetch} = {}) {
  const session = new HttpSession({allowedHosts:HOSTS, fetchImpl}); let envelope;
  try { envelope = await publicEnvelope(session); return {ok:true, message:'官方公钥及加密协议检查通过；未发送短信或登录请求'}; }
  finally { envelope?.destroy(); await session.clear(); }
}

function protocolSuccess(raw) {
  const code = String(raw?.code ?? '');
  if (['405002','405003'].includes(code)) throw new Error('安全风控拦截（' + code + '）：请在官方页面完成人工验证；不会自动重试');
  if (code !== '200') throw new Error('官方登录操作未成功，请检查输入或在官方页面处理；不会自动重试');
}

function finiteBalance(raw) {
  const value = raw?.data?.balance ?? raw?.data ?? raw?.balance ?? raw;
  return (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
}

/** Credentials and envelope remain in memory only; status never contains them. */
export class SmsLogin {
  #session; #envelope; #pending; #timer; #generation = 0;
  constructor(store, {fetchImpl = globalThis.fetch, clientFactory = createClient} = {}) {
    this.store = store; this.fetchImpl = fetchImpl; this.clientFactory = clientFactory; this.state = {state:'idle'};
  }
  status() { return structuredClone(this.state); }
  async #dispose() {
    clearTimeout(this.#timer); this.#timer = undefined;
    this.#envelope?.destroy(); this.#envelope = undefined; this.#pending = undefined;
    const session = this.#session; this.#session = undefined;
    if (session) await session.clear();
  }
  async cancel() { this.#generation++; await this.#dispose(); this.state = {state:'idle'}; return this.status(); }
  async start({phone, sendSms = true, deviceId = '', deviceToken = ''} = {}) {
    if (['starting','waiting','verifying'].includes(this.state.state)) throw new Error('已有登录会话，请先完成或取消');
    if (typeof phone !== 'string' || !/^1[3-9]\d{9}$/.test(phone) || typeof sendSms !== 'boolean' ||
        typeof deviceId !== 'string' || typeof deviceToken !== 'string' || deviceId.length > 4096 || deviceToken.length > 4096) throw new Error('登录参数无效');
    this.state = {state:'starting', message:'正在初始化官方登录'};
    const generation = ++this.#generation;
    await this.#dispose();
    if (generation !== this.#generation) return this.status();
    const session = this.#session = new HttpSession({allowedHosts:HOSTS, fetchImpl:this.fetchImpl});
    try {
      const whitelistResponse = await session.request(STUDIO + '/api/identity/login-whitelist:check', {
        method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({phone}),
      });
      if (!whitelistResponse.ok) throw new Error(whitelistResponse.status === 403 ? '安全限制：当前账号未获登录白名单授权' : '官方登录白名单检查失败');
      // The official contract permits an empty successful HTTP response (including 204).
      const whitelistText = await whitelistResponse.text();
      let whitelist;
      if (whitelistText.trim()) {
        try { whitelist = JSON.parse(whitelistText); }
        catch { throw new Error('官方登录白名单响应格式无效'); }
      }
      if (whitelist === false || whitelist?.code !== undefined && !['200','0','OK'].includes(String(whitelist.code)) || whitelist?.success === false || whitelist?.data === false) throw new Error('安全限制：当前账号未获登录白名单授权');
      const initial = new URL(LOGIN + '/login/new/login.html');
      initial.search = new URLSearchParams({sid:'unionlogin', service:'ucweb', useruri:STUDIO+'/', lang:'zh_CN'}).toString();
      const initialResponse = await session.request(initial.href);
      if (!initialResponse.ok) throw new Error('官方 SSO 初始化失败');
      const envelope = await publicEnvelope(session);
      if (generation !== this.#generation) { envelope.destroy(); throw new Error('登录已取消'); }
      this.#envelope = envelope;
      if (sendSms) {
        protocolSuccess(await jsonResponse(await session.request(LOGIN + '/uc/system/sendNoLoginVcode', {
          method:'POST', body:new URLSearchParams({login_account:`0086:${phone}`, account_belong:'stepos', vcode_type:'21',
            validate_code_type:'phone_code_validate', device_id:deviceId, geetest_version:'4', lang:'zh_CN'}),
        }), envelope));
      }
      if (generation !== this.#generation) throw new Error('登录已取消');
      this.#pending = {phone, deviceId, deviceToken, expires:Date.now()+TTL};
      this.#timer = setTimeout(() => {
        if (generation !== this.#generation) return;
        void this.cancel().then(() => {
          if (this.#generation === generation + 1) this.state = {state:'error', message:'验证码登录会话已过期，请重新开始'};
        });
      }, TTL);
      this.#timer.unref?.();
      this.state = {state:'waiting', message:sendSms ? '验证码已发送，请在十分钟内输入' : '请使用已获取的验证码在十分钟内完成登录'};
    } catch (error) {
      if (generation === this.#generation) { await this.#dispose(); this.state = {state:'error', message:safeMessage(error)}; }
    }
    return this.status();
  }

  async complete({code} = {}) {
    if (this.state.state !== 'waiting' || !this.#pending || this.#pending.expires <= Date.now()) throw new Error('请先开始有效的短信登录');
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new Error('验证码格式无效');
    const generation = this.#generation; const session = this.#session; const envelope = this.#envelope; const pending = this.#pending;
    this.state = {state:'verifying', message:'正在验证官方登录及任务权限'};
    try {
      const raw = await jsonResponse(await session.request(LOGIN + '/sso/new/vCodeUnionLogin', {
        method:'POST', headers:{'X-KC-Enc-Key':envelope.header},
        body:new URLSearchParams({account:envelope.encrypt(`0086:${pending.phone}`), vcode:envelope.encrypt(code), sid:'unionlogin', service:'ucweb',
          useruri:STUDIO+'/', account_belong:'stepos', validate_code_type:'phone_code_validate', device_id:pending.deviceId,
          device_token:pending.deviceToken, lang:'zh_CN', encryptPlaintext:'1'}),
      }), envelope);
      protocolSuccess(raw);
      const data = raw?.data || raw;
      const redirect = typeof data?.value === 'string' && data.value || data?.redirect;
      if (redirect) {
        if (typeof redirect !== 'string') throw new Error('官方重定向格式无效');
        const response = await session.request(new URL(redirect, LOGIN).href);
        if (!response.ok) throw new Error('官方 SSO 回跳失败');
      }
      const {verification, taskCookie} = await this.verifyAuth(session);
      if (generation !== this.#generation) throw new Error('登录已取消或过期');
      if (!verification.task.ok) {
        this.state = {state:'error', message:'任务权限验证失败，未覆盖原有凭据。Studio 和任务域会话不能直接互换。', verification};
      } else {
        await this.store.saveSession({cookie:taskCookie});
        this.state = {state:'saved', message:'任务 Cookie 已验证并保存在本机；Studio 会话未另行保存。', verification};
      }
    } catch (error) {
      if (generation === this.#generation) this.state = {state:'error', message:safeMessage(error)};
    } finally { if (generation === this.#generation) await this.#dispose(); }
    return this.status();
  }

  async verifyAuth(session = this.#session) {
    const studioCookie = await session.cookieHeader(API + '/api/identity/me');
    const scoped = await session.cookieHeader(TASK + '/GetBalance');
    // Only these two official, protocol-specified cookie scopes may be task candidates.
    const taskCookie = scoped || await session.cookieHeader(STUDIO + '/api/identity/me');
    const verification = {studio:{ok:false}, task:{ok:false}, differentCookies:studioCookie !== taskCookie, studioSaved:false};
    if (studioCookie) {
      try {
        const raw = await this.clientFactory({cookie:studioCookie, apiOrigin:API, taskOrigin:TASK}).identity.me();
        const user = raw?.user ?? raw?.data?.user ?? raw?.data ?? raw;
        const id = user?.userId ?? user?.user_id ?? user?.uid ?? user?.id;
        verification.studio.ok = (typeof id === 'string' && id.trim() !== '') || typeof id === 'number' && Number.isFinite(id);
      } catch { /* Report only verification state, never response or credentials. */ }
    }
    if (taskCookie) {
      try { verification.task.ok = finiteBalance(await this.clientFactory({cookie:taskCookie, apiOrigin:API, taskOrigin:TASK}).task.getBalance()); }
      catch { /* Never save an unverified candidate. */ }
    }
    return {verification, taskCookie};
  }
}

function safeMessage(error) {
  const message = error instanceof Error ? error.message : '';
  return /^(安全|官方|公钥|加密|登录已|重定向|响应正文|请求超时)/.test(message) ? message : '登录失败；未保存新凭据，请检查网络或在官方页面处理';
}
