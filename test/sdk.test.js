import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createClient,createClientFromEnv,StepXClient,StepXError,ENDPOINTS} from '../src/sdk.js';
const json = data => new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const client = fetch => createClient({cookie:'DSESSIONID=secret; _uticket=raw',token:'raw-token',minInterval:0,fetch});
const routes = `identity.me GET /api/identity/me
identity.updateAvatar POST /api/identity/me/avatar
developer.status GET /api/identity/developer/status
developer.profile GET /api/identity/developer/profile
developer.sendSmsCode POST /api/identity/developer/sms-code
developer.submitIdentity POST /api/identity/developer/identity
developer.submitReview POST /api/identity/developer/review
developer.idImage GET /api/identity/developer/id-images/I
projects.list GET /api/projects
projects.get GET /api/projects/I
projects.activity GET /api/projects/activity
projects.publishedPlugins GET /api/projects/published-plugins
projects.create POST /api/projects
projects.update PATCH /api/projects/I
projects.remove DELETE /api/projects/I
projects.builderConfig GET /api/projects/I/builder-config
projects.updateBuilderConfig PATCH /api/projects/I/builder-config
projects.dependencies GET /api/projects/I/builder-dependencies
projects.generateIcon POST /api/projects/generate-icon
projects.generateName POST /api/projects/generate-name
projects.rebindAttachments POST /api/projects/I/attachments/rebind
integrate.connectors GET /api/integrate/connectors
integrate.plugins GET /api/integrate/plugins
integrate.disconnect DELETE /api/integrate/connections/I
kit.list GET /api/kit/items
kit.detail GET /api/kit/items/I/I
kit.recommendations GET /api/kit/items/I/I/recommendations
kit.thumbnail GET /api/kit/items/I/I/thumbnail
inbox.list GET /api/inbox
inbox.read PATCH /api/inbox/I/read
inbox.readAll PATCH /api/inbox/read-all
models.chat GET /api/chat-models
models.builder GET /api/builder-models
models.voices GET /api/builder-voices
models.avatars GET /api/builder-avatars
attachments.upload POST /api/attachments
task.getBalance GET /GetBalance
task.list GET /GetTaskList
task.sign POST /Sign
task.journal GET /GetPointsJournal
task.gifts GET /GetGiftList
task.redeemOrders GET /GetRedeemOrderList
task.redeem POST /Redeem
task.firstEnter POST /FirstEnter`.split('\n').map(line=>line.split(' '));

test('complete 44 endpoint directory and every exact routing method',async t=>{
  assert.equal(ENDPOINTS.length,44);
  assert.equal(new Set(ENDPOINTS.map(e=>e.name)).size,44);
  assert.deepEqual(new Set(ENDPOINTS.map(e=>e.name)),new Set(routes.map(r=>r[0])));
  for (const [name,method,path] of routes) await t.test(name,async()=>{
    const endpoint = ENDPOINTS.find(e=>e.name===name);
    assert.equal(endpoint.method,method); assert.equal(endpoint.group,name.split('.')[0]);
    assert.ok(endpoint.description && endpoint.status); assert.ok(Object.isFrozen(endpoint));
    const sx = client((url,opts)=>{
      assert.equal(url,(name.startsWith('task.') ? 'https://otter-gateway.stepaos.com/api/step.otter.zhiyueapp.api' : 'https://studio-api.stepx.com')+path);
      assert.equal(opts.method,method); assert.equal(opts.redirect,'manual');
      assert.equal(opts.headers.cookie,'DSESSIONID=secret; _uticket=raw'); assert.equal(opts.headers.authorization,'raw-token');
      if (name==='task.sign') assert.equal(opts.body,'{}');
      return Promise.resolve(json(name.startsWith('task.') ? {code:200,data:{ok:true}} : {ok:true}));
    });
    assert.deepEqual(await sx.call(name,{path:{id:'I',imageId:'I',kind:'I',name:'I',connectionId:'I'}}),{ok:true});
  });
});
test('query and all path parameters encoded; no path traversal',async()=>{
  const sx = client(url=>{
    const u = new URL(url);
    assert.equal(u.pathname,'/api/kit/items/a%2Fb/%E4%B8%AD%20%3F%23%25');
    assert.deepEqual(u.searchParams.getAll('x'),['a&b','0','false']);
    assert.equal(u.searchParams.get('q'),'中文 ?&'); assert.equal(u.searchParams.has('empty'),false);
    return json({});
  });
  await sx.call('kit.detail',{path:{kind:'a/b',name:'中 ?#%'},query:{x:['a&b',0,false],q:'中文 ?&',empty:'',nil:null}});
  for (const id of ['.','..','',undefined]) await assert.rejects(sx.call('projects.get',{path:{id}}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(sx.call('https://evil.invalid'),{code:'UNKNOWN_ENDPOINT'});
});
test('multipart preserves bytes, filename and type without manual boundary header',async()=>{
  const sx = createClient({cookie:'c',minInterval:0,headers:{'content-type':'bad'},fetch:async(_,opts)=>{
    assert.ok(opts.body instanceof FormData); assert.equal(opts.headers['content-type'],undefined);
    const f = opts.body.get('file'); assert.equal(f.name,'note.txt'); assert.equal(f.type,'text/plain');
    assert.equal(await f.text(),'你好'); return json({ok:true});
  }});
  await sx.attachments.upload({buffer:Buffer.from('你好'),type:'text/plain'},'note.txt');
  const avatar = client(async(_,opts)=>{assert.equal(await opts.body.get('avatar').text(),'avatar');return json({});});
  await avatar.identity.updateAvatar(new Blob(['avatar']));
  await assert.rejects(sx.call('attachments.upload',{files:{file:'bad'}}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(sx.call('attachments.upload',{body:{},files:{file:new Blob()}}),{code:'INVALID_ARGUMENT'});
});
test('strict task envelope; no upstream strings or bodies in errors',async()=>{
  for (const data of [{code:0,data:null},{code:200,data:{balance:'2'}}]) assert.deepEqual(await client(()=>json(data)).task.getBalance(),data.data);
  for (const data of [null,[],{}, {code:'200',data:1},{code:200}]) await assert.rejects(client(()=>json(data)).task.list(),{code:'INVALID_ENVELOPE'});
  await assert.rejects(client(()=>json({code:403,msg:'SECRET',data:'SECRET'})).task.sign(),err=>{
    assert.equal(err.code,'TASK_ERROR');assert.equal(err.body,undefined);assert.equal(err.url,undefined);assert.ok(!JSON.stringify(err).includes('SECRET'));return true;
  });
  let calls=0;
  await assert.rejects(client(()=>{calls++; return new Response('SECRET',{status:500});}).task.sign(),{code:'HTTP_ERROR',status:500});
  assert.equal(calls,1);
});
test('binary thumbnail is JSON-safe and non-JSON errors stay sanitized',async()=>{
  assert.deepEqual(await client(()=>new Response(new Uint8Array([0,1,255]),{headers:{'content-type':'image/png'}})).kit.thumbnail('template','name'),{contentType:'image/png',base64:'AAH/'});
  for (const name of ['identity.me','kit.thumbnail']) await assert.rejects(client(()=>new Response('<html>SECRET</html>',{headers:{'content-type':'text/html'}})).call(name,{path:{kind:'template',name:'x'}}),{code:'INVALID_JSON'});
  await assert.rejects(client(()=>{throw new Error('SECRET token');}).identity.me(),err=>err instanceof StepXError && err.code==='NETWORK_ERROR' && !err.message.includes('SECRET'));
});
test('Sign is POST {} even when generic caller supplies another body',async()=>{
  await client((_,opts)=>{assert.equal(opts.method,'POST');assert.equal(opts.body,'{}');return json({code:0,data:true});}).call('task.sign',{body:{bad:true}});
});
test('timeout includes response body and ignores noncooperating injected fetch',async()=>{
  const never = ()=>new Promise(()=>{});
  const slowBody = ()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}});
  for (const fetch of [never,slowBody]) {
    const sx = createClient({token:'t',timeout:15,minInterval:0,fetch});
    await assert.rejects(sx.identity.me(),{code:'TIMEOUT'});
  }
});
test('caller abort before request and during body; listener cleanup',async()=>{
  let calls=0;
  const sx = client(()=>{calls++; return json({});});
  const c = new AbortController(); c.abort('SECRET');
  await assert.rejects(sx.call('identity.me',{signal:c.signal}),{code:'ABORTED'}); assert.equal(calls,0);
  const d = new AbortController(); let adds=0,removes=0;
  const signal = {get aborted(){return d.signal.aborted;},addEventListener(...args){adds++;d.signal.addEventListener(...args);},removeEventListener(...args){removes++;d.signal.removeEventListener(...args);}};
  const pending = client(()=>{queueMicrotask(()=>d.abort());return new Response(new ReadableStream({start(){}}));}).call('identity.me',{signal});
  await assert.rejects(pending,{code:'ABORTED'}); assert.equal(adds,removes);
  await sx.identity.me(); assert.equal(calls,1);
});
test('redirect refused; real localhost server never receives redirected credentials',async()=>{
  let leaks=0;
  const server = createServer((req,res)=>{
    if (req.url==='/leak') {leaks++;res.end('{}');}
    else {res.writeHead(302,{location:'/leak'});res.end();}
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  try {
    const sx = createClient({cookie:'SECRET',apiOrigin:`http://127.0.0.1:${server.address().port}`,minInterval:0});
    await assert.rejects(sx.identity.me(),{code:'REDIRECT_REJECTED'}); assert.equal(leaks,0);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('configuration, env, safe fixed origin directories, exact raw token',async()=>{
  for (const apiOrigin of ['http://example.com','https://u:p@example.com','https://example.com/prefix','https://example.com/?token=x','file:///tmp']) assert.throws(()=>createClient({token:'x',apiOrigin}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>createClient(),{code:'INVALID_ARGUMENT'});
  for (const timeout of [0,-1,NaN]) assert.throws(()=>createClient({token:'x',timeout}),{code:'INVALID_ARGUMENT'});
  const original = process.env.STEPX_TOKEN; process.env.STEPX_TOKEN='env-original';
  try {
    const sx = createClientFromEnv({minInterval:0,fetch:(_,opts)=>{assert.equal(opts.headers.authorization,'env-original');return json({});}});
    assert.ok(sx instanceof StepXClient); await sx.identity.me();
  } finally {if(original===undefined) delete process.env.STEPX_TOKEN;else process.env.STEPX_TOKEN=original;}
  await createClient({token:' raw ',cookie:' raw-cookie ',minInterval:0,taskOrigin:'http://localhost:1234',fetch:(url,opts)=>{
    assert.equal(url,'http://localhost:1234/api/step.otter.zhiyueapp.api/GetBalance');assert.equal(opts.headers.authorization,' raw ');assert.equal(opts.headers.cookie,' raw-cookie ');return json({code:0,data:1});
  }}).task.getBalance();
});
test('group defaults and positional signatures',async()=>{
  const requests=[];
  const sx = client((url,opts)=>{requests.push([new URL(url),opts]);return json(url.includes('step.otter') ? {code:0,data:{}} : {});});
  await sx.kit.list(); await sx.kit.recommendations('template','n'); await sx.inbox.list(); await sx.task.journal();
  await sx.projects.rebindAttachments('p',{attachments:[]}); await sx.developer.idImage('a/b','verify'); await sx.task.redeem(7);
  assert.equal(requests[0][0].searchParams.get('page_size'),'20');assert.equal(requests[1][0].searchParams.get('limit'),'3');
  assert.equal(requests[2][0].searchParams.get('limit'),'20');assert.equal(requests[3][0].searchParams.get('offset'),'0');
  assert.equal(requests[4][1].body,'{"attachments":[]}');assert.equal(requests[5][0].searchParams.get('biz'),'verify');assert.equal(requests[6][1].body,'{"gift_id":"7"}');
});
test('per-client throttle serializes starts; cancelled queued call cannot deadlock',async()=>{
  const starts=[];
  const sx = createClient({token:'x',minInterval:25,fetch:()=>{starts.push(Date.now());return json({});}});
  const controller=new AbortController();
  const a=sx.identity.me(); const b=sx.call('identity.me',{signal:controller.signal}); const c=sx.identity.me();
  controller.abort(); await assert.rejects(b,{code:'ABORTED'}); await Promise.all([a,c]);
  assert.equal(starts.length,2); assert.ok(starts[1]-starts[0]>=20);
});
