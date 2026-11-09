export const DEFAULT_SCHEDULE = { enabled: false, time: '09:00', timezone: 'Asia/Shanghai' };
export function validateSchedule(value) {
  if (typeof value.enabled !== 'boolean' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time || '')) throw new Error('定时配置须提供 enabled 布尔值和 HH:mm 时间');
  try { new Intl.DateTimeFormat('en-CA', { timeZone: value.timezone }).format(); } catch { throw new Error('无效的 IANA 时区'); }
  if (!value.timezone || typeof value.timezone !== 'string') throw new Error('必须指定 IANA 时区');
  return { enabled: value.enabled, time: value.time, timezone: value.timezone };
}
export function localClock(now, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
export class Scheduler {
  constructor(store, run) { this.store = store; this.run = run; this.busy = false; }
  async tick(now = new Date()) {
    if (this.busy) return; this.busy = true; let unlock;
    try {
      const config = await this.store.read('schedule', DEFAULT_SCHEDULE);
      if (!config.enabled) return;
      validateSchedule(config); const clock = localClock(now, config.timezone);
      if (clock.time < config.time || config.lastDate === clock.date) return;
      unlock = await this.store.lock('schedule-claim');
      const current = await this.store.read('schedule', DEFAULT_SCHEDULE);
      if (!current.enabled || current.time !== config.time || current.timezone !== config.timezone || current.lastDate === clock.date) return;
      // Claim before sending any request: a crash never causes an automatic write retry.
      current.lastDate = clock.date; current.lastRun = now.toISOString(); current.lastResult = 'running';
      await this.store.write('schedule', current);
      let ok = false;
      try { await this.run(); ok = true; } catch { /* no automatic retry of uncertain writes */ }
      const latest = await this.store.read('schedule', DEFAULT_SCHEDULE);
      await this.store.write('schedule', { ...latest, lastDate: current.lastDate, lastRun: current.lastRun, lastResult: ok ? 'success' : 'failed: 请检查凭据和上游任务，今日不自动重试' });
      await this.store.record('schedule', ok, ok ? '定时签到已核验' : '定时签到失败，请手动检查；今日不自动重试');
    } finally { if (unlock) await unlock(); this.busy = false; }
  }
  start() { this.timer = setInterval(() => this.tick().catch(() => {}), 30000); void this.tick().catch(() => {}); }
  stop() { clearInterval(this.timer); }
}
