// Independently implemented Node 22 ESM client. No upstream implementation is embedded.
import { ENDPOINTS } from './endpoints.js';
export { ENDPOINTS };
export const DEFAULT_API_ORIGIN = 'https://studio-api.stepx.com';
export const DEFAULT_TASK_ORIGIN = 'https://otter-gateway.stepaos.com/api/step.otter.zhiyueapp.api';
const directory = new Map(ENDPOINTS.map(endpoint => [endpoint.name, endpoint]));

export class StepXError extends Error {
  constructor(message, {code = 'SDK_ERROR', status, endpoint, method} = {}) {
    super(message);
    this.name = 'StepXError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (endpoint !== undefined) this.endpoint = endpoint;
    if (method !== undefined) this.method = method;
  }
}
function invalid() { return new StepXError('Invalid SDK configuration or arguments', {code:'INVALID_ARGUMENT'}); }
function baseUrl(value, target) {
  let url;
  try { url = new URL(value); } catch { throw invalid(); }
  const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const prefix = '/api/step.otter.zhiyueapp.api';
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) throw invalid();
  const path = url.pathname.replace(/\/+$/, '');
  if (target === 'api' ? path !== '' : (path !== '' && path !== prefix)) throw invalid();
  // Task always uses its fixed gateway directory, even with a bare custom origin.
  return url.origin + (target === 'task' ? prefix : '');
}
function number(value, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive ? value <= 0 : value < 0) || value > 2147483647) throw invalid();
  return value;
}
function pathValue(value) {
  if (!['string','number'].includes(typeof value) || String(value) === '' || ['.','..'].includes(String(value))) throw invalid();
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export class StepXClient {
  #cookie; #token; #headers; #fetch; #api; #task; #timeout; #interval; #gate = Promise.resolve(); #next = 0;
  constructor(opts = {}) {
    const {cookie, token, headers = {}, lang = 'zh', timeout = 30000, minInterval = 300, fetch:fetchImpl = globalThis.fetch} = opts;
    if ((!cookie && !token) || (cookie !== undefined && typeof cookie !== 'string') || (token !== undefined && typeof token !== 'string') || typeof fetchImpl !== 'function') throw invalid();
    this.#api = baseUrl(opts.apiOrigin ?? DEFAULT_API_ORIGIN, 'api');
    this.#task = baseUrl(opts.taskOrigin ?? DEFAULT_TASK_ORIGIN, 'task');
    this.#timeout = number(timeout, true); this.#interval = number(minInterval);
    try {
      this.#headers = new Headers(headers);
      this.#headers.set('Accept','application/json'); this.#headers.set('zy-client-lang',lang);
      this.#headers.delete('cookie'); this.#headers.delete('authorization');
      if (cookie) this.#headers.set('Cookie',cookie);
      if (token) this.#headers.set('Authorization',token);
    } catch { throw invalid(); }
    this.#cookie = cookie; this.#token = token; this.#fetch = fetchImpl;
    // Group functions keep the original positional signatures; call() supplies signal support.
    const invoke = (name, args) => this.call(name,args);
    for (const endpoint of ENDPOINTS) {
      this[endpoint.group] ??= {};
      this[endpoint.group][endpoint.name.split('.')[1]] = () => invoke(endpoint.name);
    }
    this.identity.updateAvatar = file => invoke('identity.updateAvatar',{files:{avatar:file}});
    this.developer.idImage = (imageId,biz='') => invoke('developer.idImage',{path:{imageId},query:{biz}});
    for (const name of ['sendSmsCode','submitIdentity','submitReview']) this.developer[name] = body => invoke(`developer.${name}`,{body});
    this.projects.list = (query={}) => invoke('projects.list',{query});
    for (const name of ['get','remove','builderConfig','dependencies']) this.projects[name] = id => invoke(`projects.${name}`,{path:{id}});
    for (const name of ['create','generateIcon','generateName']) this.projects[name] = body => invoke(`projects.${name}`,{body});
    for (const name of ['update','updateBuilderConfig','rebindAttachments']) this.projects[name] = (id,body) => invoke(`projects.${name}`,{path:{id},body});
    for (const name of ['connectors','plugins']) this.integrate[name] = (query={}) => invoke(`integrate.${name}`,{query});
    this.integrate.disconnect = connectionId => invoke('integrate.disconnect',{path:{connectionId}});
    this.kit.list = ({kind='template',page=1,pageSize=20,search='',category=''}={}) => invoke('kit.list',{query:{kind,page,page_size:pageSize,search,category}});
    this.kit.detail = (kind,name) => invoke('kit.detail',{path:{kind,name}});
    this.kit.recommendations = (kind,name,limit=3) => invoke('kit.recommendations',{path:{kind,name},query:{limit}});
    this.kit.thumbnail = (kind,name,tag='') => invoke('kit.thumbnail',{path:{kind,name},query:{tag}});
    this.inbox.list = ({limit=20,cursor=''}={}) => invoke('inbox.list',{query:{limit,cursor}});
    this.inbox.read = id => invoke('inbox.read',{path:{id}});
    this.attachments.upload = (file,filename) => invoke('attachments.upload',{files:{file:filename ? (file instanceof Blob ? {buffer:file,filename,type:file.type} : {...file,filename}) : file}});
    this.task.journal = ({type=1,offset=0,limit=20}={}) => invoke('task.journal',{query:{type,offset,limit}});
    this.task.redeem = giftId => invoke('task.redeem',{body:{gift_id:String(giftId)}});
  }

  async call(name, {path={},query={},body,files={},signal} = {}) {
    const endpoint = directory.get(name);
    if (!endpoint) throw new StepXError('Unknown endpoint',{code:'UNKNOWN_ENDPOINT'});
    const context = {endpoint:name,method:endpoint.method};
    const error = (code,status) => new StepXError(`StepX request failed (${code})`,{...context,code,status});
    let url, payload, headers;
    try {
      const route = endpoint.path.replace(/:([A-Za-z]+)/g, (_, key) => pathValue(path[key]));
      url = new URL((endpoint.target === 'task' ? this.#task : this.#api) + route);
      for (const [key,value] of Object.entries(query)) {
        for (const item of (Array.isArray(value) ? value : [value])) {
          if (item === null || item === undefined || item === '') continue;
          if (!['string','number','boolean'].includes(typeof item)) throw invalid();
          url.searchParams.append(key,String(item));
        }
      }
      headers = new Headers(this.#headers);
      // Restore exact raw credential strings (Headers may trim boundary whitespace).
      const rawHeaders = Object.fromEntries(headers);
      if (this.#cookie) rawHeaders.cookie = this.#cookie;
      if (this.#token) rawHeaders.authorization = this.#token;
      headers = rawHeaders;
      const entries = Object.entries(files);
      if (name === 'task.sign' || name === 'task.firstEnter') { body = {}; if (entries.length) throw invalid(); }
      if (entries.length) {
        if (body !== undefined) throw invalid();
        payload = new FormData();
        for (const [key,file] of entries) {
          if (file instanceof Blob) payload.append(key,file);
          else if (file && typeof file === 'object' && file.buffer !== undefined) {
            if (!(file.buffer instanceof Blob) && !(file.buffer instanceof ArrayBuffer) && !ArrayBuffer.isView(file.buffer)) throw invalid();
            payload.append(key,new Blob([file.buffer],{type:file.type || 'application/octet-stream'}),file.filename || 'file');
          } else throw invalid();
        }
        delete headers['content-type'];
      } else if (body !== undefined) {
        payload = JSON.stringify(body); headers['content-type'] = 'application/json';
      }
      if (endpoint.method === 'GET' && payload !== undefined) throw invalid();
    } catch { throw error('INVALID_ARGUMENT'); }
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort',onAbort,{once:true});
    const timer = setTimeout(() => { timedOut = true; controller.abort(); },this.#timeout);
    const abortError = () => error(timedOut ? 'TIMEOUT' : 'ABORTED');
    let onInternalAbort;
    const aborted = new Promise((_,reject) => {
      onInternalAbort = () => reject(abortError());
      if (controller.signal.aborted) onInternalAbort();
      else controller.signal.addEventListener('abort',onInternalAbort,{once:true});
    });
    let release;
    const previous = this.#gate;
    this.#gate = new Promise(resolve => { release = resolve; });
    let delay;
    try {
      await Promise.race([previous,aborted]);
      const wait = Math.max(0,this.#next - Date.now());
      if (wait) await Promise.race([new Promise(resolve => { delay = setTimeout(resolve,wait); }),aborted]);
      if (controller.signal.aborted) throw abortError();
      this.#next = Date.now() + this.#interval;
      release(); release = undefined;
      const response = await Promise.race([Promise.resolve().then(() => this.#fetch(url.toString(),{method:endpoint.method,headers,body:payload,signal:controller.signal,redirect:'manual',cache:'no-store'})),aborted]);
      if (response.status >= 300 && response.status < 400 || response.redirected) { void response.body?.cancel().catch(() => {}); throw error('REDIRECT_REJECTED',response.status); }
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw error('HTTP_ERROR',response.status); }
      const contentType = response.headers.get('content-type') || '';
      const json = /(?:application|text)\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(contentType);
      if (!json && name === 'kit.thumbnail' && contentType && !/^(?:text\/|application\/(?:xml|xhtml))/i.test(contentType)) {
        const bytes = await Promise.race([response.arrayBuffer(),aborted]);
        return {contentType,base64:Buffer.from(bytes).toString('base64')};
      }
      let data;
      try {
        const text = await Promise.race([response.text(),aborted]);
        data = text === '' && response.status === 204 ? null : JSON.parse(text);
      } catch (err) { if (controller.signal.aborted) throw abortError(); throw error('INVALID_JSON',response.status); }
      if (endpoint.target === 'task') {
        if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.hasOwn(data,'code') || !Object.hasOwn(data,'data') || typeof data.code !== 'number') throw error('INVALID_ENVELOPE',response.status);
        if (data.code !== 0 && data.code !== 200) throw error('TASK_ERROR',response.status);
        return data.data;
      }
      return data;
    } catch (err) {
      if (controller.signal.aborted) throw abortError();
      if (err instanceof StepXError) throw err;
      throw error('NETWORK_ERROR');
    } finally {
      clearTimeout(timer); clearTimeout(delay);
      signal?.removeEventListener('abort',onAbort);
      controller.signal.removeEventListener('abort',onInternalAbort);
      // A cancelled queued request cannot let later requests overtake its predecessor.
      if (release) previous.then(release,release);
    }
  }
}
export function createClient(options) { return new StepXClient(options); }
export function createClientFromEnv(options = {}) {
  const env = process.env;
  return createClient({cookie:env.STEPX_COOKIE,token:env.STEPX_TOKEN,apiOrigin:env.STEPX_API_ORIGIN,taskOrigin:env.STEPX_TASK_ORIGIN,
    ...(env.STEPX_TIMEOUT ? {timeout:Number(env.STEPX_TIMEOUT)} : {}),
    ...(env.STEPX_MIN_INTERVAL ? {minInterval:Number(env.STEPX_MIN_INTERVAL)} : {}),...options});
}
export default StepXClient;
