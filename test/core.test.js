import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { runWorkflow, taskItems } from '../src/workflow.js';
import { Scheduler, validateSchedule, localClock } from '../src/scheduler.js';

async function temp(t) { const dir = await mkdtemp(join(tmpdir(), 'stepx-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return new Store(dir); }
function mockClient({ signed = false, verify = true } = {}) {
  const calls = []; let done = signed;
  return { calls, task: {
    getBalance: async () => { calls.push('balance'); return { balance: '20' }; },
    list: async () => { calls.push('list'); return { list: [{ task_id: '1', task_type: 1, completed: done, rewarded: done }, { task_type: 2, completed: false }] }; },
    firstEnter: async () => { calls.push('enter'); return {}; },
    sign: async () => { calls.push('sign'); done = verify; return {}; }
  } };
}
test('store private session persistence, permissions and credential validation', async t => {
  const store = await temp(t); await store.saveSession({ cookie: 'DSESSIONID=test', token: 'raw' });
  assert.equal((await store.session()).cookie, 'DSESSIONID=test');
  assert.equal((await stat(store.dir)).mode & 0o777, 0o700);
  assert.equal((await stat(join(store.dir, 'session.json'))).mode & 0o777, 0o600);
  await assert.rejects(store.saveSession({ token: 'bad\nheader' }));
  const release = await store.lock('workflow'); await assert.rejects(store.lock('workflow')); await release();
  const again = await store.lock('workflow'); await again();
});
test('workflow performs inspect, first enter, sign and verification', async () => {
  const client = mockClient(); const result = await runWorkflow(client, 'all');
  assert.equal(result.verified, true); assert.deepEqual(client.calls, ['balance','list','enter','sign','balance','list']);
  assert.equal(result.steps[0].result.manualTasks.length, 1);
});
test('already rewarded sign is skipped and string booleans handled', async () => {
  const client = mockClient({ signed: true }); const result = await runWorkflow(client, 'all');
  assert.equal(result.skipped, true); assert.equal(client.calls.includes('sign'), false);
});
test('unknown task shape and unverified rewards stop safely without retry', async () => {
  assert.throws(() => taskItems({ unknown: [] }));
  const client = mockClient({ verify: false }); await assert.rejects(runWorkflow(client, 'all'), /不自动重试/);
  assert.equal(client.calls.filter(c => c === 'sign').length, 1);
});
test('schedule validation and local timezone conversion', () => {
  assert.throws(() => validateSchedule({ enabled: true, time: '24:00', timezone: 'Asia/Shanghai' }));
  assert.throws(() => validateSchedule({ enabled: true, time: '09:00', timezone: 'invalid' }));
  assert.deepEqual(localClock(new Date('2026-01-01T01:00:00Z'), 'Asia/Shanghai'), { date: '2026-01-01', time: '09:00' });
});
test('scheduler claims one run per local date, catches up, never auto retries failure', async t => {
  const store = await temp(t); await store.write('schedule', { enabled: true, time: '09:00', timezone: 'Asia/Shanghai' });
  let count = 0; const scheduler = new Scheduler(store, async () => { count++; throw new Error('SECRET'); });
  await scheduler.tick(new Date('2026-01-01T00:59:00Z')); assert.equal(count, 0);
  await scheduler.tick(new Date('2026-01-01T01:01:00Z')); await scheduler.tick(new Date('2026-01-01T05:00:00Z')); assert.equal(count, 1);
  assert.equal((await readFile(join(store.dir, 'schedule.json'), 'utf8')).includes('SECRET'), false);
  await scheduler.tick(new Date('2026-01-02T04:00:00Z')); assert.equal(count, 2);
});
