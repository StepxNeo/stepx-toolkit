import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpSession } from '../src/http-session.js';
import { SmsLogin, createEnvelope, signingHeaders, checkProtocol } from '../src/sms-login.js';
import { generateKeyPairSync, privateDecrypt, createDecipheriv, createCipheriv, randomBytes, constants, createHmac } from 'node:crypto';
const keys = generateKeyPairSync('rsa', {modulusLength:2048});
const publicKeyPem = keys.publicKey.export({type:'spki', format:'pem'});

const allowedHosts = ['login.example.com', 'api.example.com'];
const session = fetchImpl => new HttpSession({ allowedHosts, fetchImpl });
const json = (value, status = 200, headers = {}) => Response.json(value, {status, headers});

test('envelope matches RSA OAEP SHA256 and AES GCM wire layout, rejects tampering', () => {
  const envelope = createEnvelope(publicKeyPem, 'kid1');
  const key = privateDecrypt({key:keys.privateKey, padding:constants.RSA_PKCS1_OAEP_PADDING, oaepHash:'sha256'}, Buffer.from(envelope.header.split('.')[2], 'base64url'));
  assert.equal(key.length, 32);
  const encrypted = envelope.encrypt('测试123');
  const bytes = Buffer.from(encrypted, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0,12)); cipher.setAuthTag(bytes.subarray(-16));
  assert.equal(Buffer.concat([cipher.update(bytes.subarray(12,-16)), cipher.final()]).toString(), '测试123');
  assert.equal(envelope.decrypt(encrypted), '测试123');
  bytes[15] ^= 1;
  assert.throws(() => envelope.decrypt(bytes.toString('base64')));
  assert.notEqual(envelope.encrypt('same'), envelope.encrypt('same'));
  envelope.destroy(); assert.throws(() => envelope.encrypt('no'), /销毁/);
  const headers = signingHeaders(); const secret = 'bt6bI9U7wKl8FwT6tJ3u';
  assert.equal(headers['zy-sign'], createHmac('sha256', secret).update(headers['zy-app-id'] + headers['zy-nonce'] + headers['zy-timestamp'] + secret).digest('hex'));
});

function mockProtocol({smsCode = '200', taskBalance = 3, redirect = '/done', whitelistStatus = 200, whitelistBody = {code:200}, encryptedResponse = false} = {}) {
  const calls = []; const writes = []; let envelopeHeader; let envelopeKey;
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname; calls.push({url, options});
    if (path.endsWith('login-whitelist:check')) return whitelistBody === '' || whitelistStatus === 204 ? new Response(whitelistStatus === 204 ? null : '', {status:whitelistStatus}) : json(whitelistBody, whitelistStatus);
    if (path.endsWith('/public-key')) return json({data:{publicKeyPem, kid:'test-key'}});
    if (path.endsWith('/sendNoLoginVcode')) return json({code:smsCode});
    if (path.endsWith('/vCodeUnionLogin')) {
      envelopeHeader = options.headers.get('X-KC-Enc-Key');
      envelopeKey = privateDecrypt({key:keys.privateKey, padding:constants.RSA_PKCS1_OAEP_PADDING, oaepHash:'sha256'}, Buffer.from(envelopeHeader.split('.')[2], 'base64url'));
      for (const [name, expected] of [['account','0086:13800138000'], ['vcode','123456']]) {
        const bytes = Buffer.from(options.body.get(name), 'base64'); const decipher = createDecipheriv('aes-256-gcm', envelopeKey, bytes.subarray(0,12));
        decipher.setAuthTag(bytes.subarray(-16)); assert.equal(Buffer.concat([decipher.update(bytes.subarray(12,-16)), decipher.final()]).toString(), expected);
      }
      assert.equal(options.body.get('encryptPlaintext'), '1');
      const result = {code:'200', data:{redirect}};
      if (encryptedResponse) {
        const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', envelopeKey, iv);
        const body = Buffer.concat([cipher.update(JSON.stringify(result)), cipher.final()]);
        return json(Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64'), 200, {'X-KC-Enc':'1'});
      }
      return json(result);
    }
    if (path === '/done') return new Response('done', {headers:{'set-cookie':'studio=one; Domain=stepx.com; Path=/; Secure'}});
    return new Response('sso');
  };
  const clientFactory = ({cookie}) => ({identity:{me:async () => ({data:{id:'user'}})}, task:{getBalance:async () => ({data:{balance:taskBalance}})}});
  const login = new SmsLogin({saveSession:async value => { writes.push(value); }}, {fetchImpl, clientFactory});
  return {login, calls, writes, fetchImpl};
}

test('numeric kid is stringified while missing or header-unsafe kid is rejected', () => {
  for (const kid of [0, 42]) {
    const envelope = createEnvelope(publicKeyPem, kid);
    assert.ok(envelope.header.startsWith(`kcv1.${kid}.`)); envelope.destroy();
  }
  for (const kid of [null, undefined, '', 'bad.kid', 'bad\r\nkid']) assert.throws(() => createEnvelope(publicKeyPem, kid), /公钥版本/);
});

test('SMS forwards deviceId and completion requires exactly six digits before network', async () => {
  const {login, calls} = mockProtocol();
  await login.start({phone:'13800138000', deviceId:'device-test'});
  const sms = calls.find(call => call.url.endsWith('/sendNoLoginVcode'));
  assert.equal(sms.options.body.get('device_id'), 'device-test');
  const count = calls.length;
  for (const code of ['1234','12345','1234567','12345678','12a456',123456]) {
    await assert.rejects(login.complete({code}), /验证码格式/);
    assert.equal(calls.length, count); assert.equal(login.status().state, 'waiting');
  }
  assert.equal((await login.complete({code:'123456'})).state, 'saved');
  assert.equal(calls.find(call => call.url.endsWith('/vCodeUnionLogin')).options.body.get('device_id'), 'device-test');
});

test('whitelist permits HTTP-ok empty bodies but refuses explicit false and HTTP403', async () => {
  for (const options of [{whitelistStatus:204}, {whitelistBody:''}]) {
    const {login} = mockProtocol(options);
    assert.equal((await login.start({phone:'13800138000', sendSms:false})).state, 'waiting');
    await login.cancel();
  }
  for (const options of [{whitelistBody:false}, {whitelistBody:{data:false}}, {whitelistBody:{success:false}}, {whitelistStatus:403, whitelistBody:''}]) {
    const {login, calls, writes} = mockProtocol(options);
    assert.equal((await login.start({phone:'13800138000'})).state, 'error');
    assert.equal(calls.length, 1); assert.equal(writes.length, 0);
  }
});

test('SMS sends once, encrypted completion verifies scopes before save; status has no credentials', async () => {
  const {login, calls, writes} = mockProtocol();
  assert.equal((await login.start({phone:'13800138000'})).state, 'waiting');
  await assert.rejects(login.start({phone:'13800138000'}), /已有/);
  assert.equal(calls.filter(call => call.url.endsWith('/sendNoLoginVcode')).length, 1);
  const result = await login.complete({code:'123456'});
  assert.equal(result.state, 'saved'); assert.equal(result.verification.task.ok, true);
  assert.deepEqual(writes, [{cookie:'studio=one'}]);
  assert.doesNotMatch(JSON.stringify(login.status()), /13800138000|studio=one|123456|kcv1/);
});

test('encrypted JSON response is decrypted before following redirect', async () => {
  const {login, writes} = mockProtocol({encryptedResponse:true});
  await login.start({phone:'13800138000', sendSms:false});
  assert.equal((await login.complete({code:'123456'})).state, 'saved'); assert.equal(writes.length, 1);
});

test('task verification only considers gateway and specified studio fallback cookie scopes', async () => {
  const {login} = mockProtocol();
  const scopes = []; const candidates = [];
  login.clientFactory = ({cookie}) => { candidates.push(cookie); return {identity:{me:async () => ({id:1})}, task:{getBalance:async () => ({data:{balance:'0'}})}}; };
  const {verification, taskCookie} = await login.verifyAuth({cookieHeader:async url => {
    scopes.push(url);
    return url.includes('otter-gateway') ? 'gateway=verified' : 'studio=separate';
  }});
  assert.equal(taskCookie, 'gateway=verified'); assert.equal(verification.differentCookies, true);
  assert.equal(verification.studioSaved, false); assert.deepEqual(candidates, ['studio=separate','gateway=verified']);
  assert.deepEqual(scopes, ['https://studio-api.stepx.com/api/identity/me','https://otter-gateway.stepaos.com/api/step.otter.zhiyueapp.api/GetBalance']);
});

test('failed task validation never overwrites prior store', async () => {
  for (const taskBalance of ['', 'not-a-number', {}, null, Infinity]) {
    const {login, writes} = mockProtocol({taskBalance});
    await login.start({phone:'13800138000', sendSms:false});
    const result = await login.complete({code:'123456'});
    assert.equal(result.state, 'error'); assert.equal(result.verification.task.ok, false); assert.equal(writes.length, 0);
  }
});

test('risk codes and whitelist refusal are terminal without retries', async () => {
  for (const smsCode of ['405002','405003']) {
    const {login, calls, writes} = mockProtocol({smsCode});
    const result = await login.start({phone:'13800138000'});
    assert.equal(result.state, 'error'); assert.match(result.message, /安全风控/);
    assert.equal(calls.filter(call => call.url.endsWith('/sendNoLoginVcode')).length, 1); assert.equal(writes.length, 0);
  }
  const {login, calls} = mockProtocol({whitelistStatus:403});
  assert.equal((await login.start({phone:'13800138000'})).state, 'error'); assert.equal(calls.length, 1);
});

test('completion refuses unsafe redirect; cancel destroys pending login; protocol check only fetches key', async () => {
  const {login, writes} = mockProtocol({redirect:'https://evil.test/collect'});
  await login.start({phone:'13800138000'}); assert.equal((await login.complete({code:'123456'})).state, 'error'); assert.equal(writes.length, 0);
  const pending = mockProtocol(); await pending.login.start({phone:'13800138000', sendSms:false});
  assert.equal((await pending.login.cancel()).state, 'idle'); await assert.rejects(pending.login.complete({code:'123456'}));
  const probe = mockProtocol(); assert.equal((await checkProtocol({fetchImpl:probe.fetchImpl})).ok, true);
  assert.equal(probe.calls.length, 1); assert.match(probe.calls[0].url, /public-key$/);
});

test('HTTPS exact-host allowlist rejects ports, credentials and suffix spoofing', async () => {
  let calls = 0;
  const http = session(async () => { calls++; return json({}); });
  for (const url of ['http://login.example.com', 'https://login.example.com.evil.test', 'https://login.example.com:444', 'https://u:p@login.example.com', 'https://evil.test']) {
    await assert.rejects(http.request(url), /安全限制/);
  }
  assert.equal(calls, 0);
});

test('jar respects domain, path, secure and expiry; ignores forged cookies', async () => {
  const seen = [];
  const http = session(async (url, options) => { seen.push(options.headers.get('cookie')); return json({}); });
  await http.setCookie('root=one; Secure; Path=/', 'https://login.example.com');
  await http.setCookie('private=two; Secure; Path=/private', 'https://login.example.com');
  await http.setCookie('shared=three; Domain=example.com; Path=/; Secure', 'https://login.example.com');
  await http.setCookie('expired=no; Max-Age=0; Path=/', 'https://login.example.com');
  await assert.rejects(http.setCookie('evil=no; Domain=evil.test', 'https://login.example.com'));
  await http.request('https://login.example.com/public', {headers:{cookie:'injected=no'}});
  await http.request('https://login.example.com/private/item');
  await http.request('https://api.example.com');
  assert.equal(seen[0], 'root=one; shared=three');
  assert.match(seen[1], /private=two/);
  assert.equal(seen[2], 'shared=three');
  await http.clear();
  await assert.rejects(http.request('https://api.example.com'), /销毁/);
});

test('redirect recalculates cookies and strips cross-origin authorization', async () => {
  const seen = [];
  const http = session(async (url, options) => {
    seen.push({url, auth:options.headers.get('authorization'), cookie:options.headers.get('cookie'), method:options.method, body:options.body});
    if (seen.length === 1) return new Response(null, {status:302, headers:{location:'https://api.example.com/final', 'set-cookie':'login=secret; Path=/; Secure'}});
    return json({ok:true});
  });
  await http.setCookie('api=yes; Secure; Path=/', 'https://api.example.com');
  const result = await http.request('https://login.example.com/start', {method:'POST', body:'secret', headers:{authorization:'Bearer private'}});
  assert.equal(result.url, 'https://api.example.com/final');
  assert.equal(seen[0].auth, 'Bearer private');
  assert.equal(seen[1].auth, null);
  assert.equal(seen[1].cookie, 'api=yes');
  assert.equal(seen[1].method, 'GET');
  assert.equal(seen[1].body, undefined);
  assert.equal(await http.cookie('https://login.example.com'), 'login=secret');
});

test('redirect blocks untrusted hosts, excess hops and cross-host body replay', async () => {
  for (const location of ['https://evil.test', 'http://login.example.com']) {
    const http = session(async () => new Response(null, {status:302, headers:{location}}));
    await assert.rejects(http.request('https://login.example.com'), /安全限制/);
  }
  let calls = 0;
  const loop = session(async () => { calls++; return new Response(null, {status:302, headers:{location:'/again'}}); });
  await assert.rejects(loop.request('https://login.example.com'), /5 跳/);
  assert.equal(calls, 6);
  const replay = session(async () => new Response(null, {status:307, headers:{location:'https://api.example.com'}}));
  await assert.rejects(replay.request('https://login.example.com', {method:'POST', body:'secret'}), /重放/);
});

test('body timeout applies after headers and response is size limited', async () => {
  const http = new HttpSession({allowedHosts, timeoutMs:20, fetchImpl:async () => new Response(new ReadableStream({start() {}}))});
  await assert.rejects(http.request('https://login.example.com'), /超时/);
  const big = session(async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)));
  await assert.rejects(big.request('https://login.example.com'), /2MB/);
  const declared = session(async () => new Response('small', {headers:{'content-length':String(3 * 1024 * 1024)}}));
  await assert.rejects(declared.request('https://login.example.com'), /2MB/);
});
