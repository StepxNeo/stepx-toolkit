'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const state = { csrf: '', endpoints: [], ready: false, busy: false, polling: null, exportTimer: null };
  const pretty = (value) => JSON.stringify(value, null, 2) ?? '（无返回内容）';
  const messageOf = (error) => error instanceof Error ? error.message : String(error);
  const dateText = (value) => {
    if (!value) return '时间未知';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
  };
  function notice(message, failed = false) {
    $('notice').textContent = message;
    $('notice').classList.toggle('error', failed);
  }
  function hideExport() {
    $('export-result').textContent = '';
    $('export-area').hidden = true;
    clearTimeout(state.exportTimer);
  }
  async function request(path, body) {
    const options = { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      if (!state.csrf) throw new Error('尚未取得 CSRF 令牌，请先刷新并连接本地服务。');
      options.headers['Content-Type'] = 'application/json';
      options.headers['X-CSRF-Token'] = state.csrf;
      options.body = JSON.stringify(body);
    }
    const controller = new AbortController();
    options.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(path, options);
      let data;
      try { data = await response.json(); } catch { throw new Error(`本地服务未返回有效 JSON（HTTP ${response.status}）。请通过本地后端访问此页面。`); }
      if (!response.ok || data.error) throw new Error(String(data.error || `请求失败（HTTP ${response.status}）`));
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('请求超时，请先检查实际执行状态，再决定是否重试，避免重复提交。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function setBusy(busy) {
    state.busy = busy;
    document.querySelectorAll('button').forEach((button) => {
      if (button.closest('dialog') || button.id === 'hide-export') return;
      button.disabled = busy;
    });
  }
  async function action(label, work) {
    if (state.busy) return;
    setBusy(true);
    notice(`${label}…`);
    try { await work(); notice(`${label}完成，请查看真实返回结果。`); }
    catch (error) { notice(`${label}失败：${messageOf(error)}`, true); }
    finally { setBusy(false); }
  }
  function confirmAction(title, message) {
    const dialog = $('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    return new Promise((resolve) => {
      dialog.returnValue = 'cancel';
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
      dialog.showModal();
    });
  }
  function renderLogin(login) {
    const labels = { idle: '未启动', opening: '正在打开浏览器', waiting: '等待官方登录', saved: 'Cookie 已保存', error: '登录出错' };
    $('login-state').textContent = `${labels[login?.state] || '未知状态'}${login?.message ? ` · ${login.message}` : ''}`;
    clearTimeout(state.polling);
    state.polling = null;
    if (login?.state === 'opening' || login?.state === 'waiting') {
      state.polling = setTimeout(async () => {
        if (document.hidden || state.busy) { renderLogin(login); return; }
        try {
          const data = await request('/api/login/status');
          renderLogin(data.login || data);
          if ((data.login || data).state === 'saved') await bootstrap();
        } catch (error) { $('login-state').textContent = `状态刷新失败：${messageOf(error)}；可点击检查状态重试。`; }
      }, 3000);
    }
  }
  function renderSchedule(schedule) {
    if (!schedule) return;
    $('schedule-enabled').checked = Boolean(schedule.enabled);
    $('schedule-time').value = schedule.time || '09:00';
    $('schedule-timezone').value = schedule.timezone || 'Asia/Shanghai';
    $('schedule-state').textContent = schedule.enabled ? '已启用' : '未启用';
    $('schedule-detail').textContent = `${schedule.time || '09:00'} · ${schedule.timezone || 'Asia/Shanghai'}`;
    $('schedule-last').textContent = schedule.lastRun
      ? `${dateText(schedule.lastRun)}\n${schedule.lastResult === undefined ? '无结果详情' : typeof schedule.lastResult === 'string' ? schedule.lastResult : pretty(schedule.lastResult)}`
      : '暂无定时执行记录。';
  }
  function selectedEndpoint() { return state.endpoints[Number($('endpoint').value)]; }
  function renderEndpoint() {
    const ep = selectedEndpoint();
    const path = Object.create(null);
    for (const match of String(ep?.path || '').matchAll(/\{([^{}]+)\}|:([A-Za-z_][A-Za-z0-9_]*)/g)) path[match[1] || match[2]] = '';
    $('api-path').value = pretty(path);
    $('api-query').value = pretty(ep?.name === 'kit.list' ? { kind: 'template', page: 1, page_size: 20 } : {});
    $('api-body').value = '{}';
    $('endpoint-info').textContent = ep ? `${ep.method} ${ep.path}\n目标：${ep.target || '未提供'} · 状态：${ep.status || '未验证'}\n作用：${ep.purpose || ep.description || '无接口说明'}\n注意：推断 / 未验证接口须自行核实，写操作会改动官方数据。` : '没有可用接口。请连接本地服务并刷新接口目录。';
  }
  function renderEndpoints(endpoints) {
    const previous = selectedEndpoint()?.name;
    state.endpoints = Array.isArray(endpoints) ? endpoints : [];
    const select = $('endpoint');
    select.replaceChildren();
    const groups = new Map();
    state.endpoints.forEach((ep, index) => {
      const groupName = ep.group || '其他接口';
      if (!groups.has(groupName)) {
        const group = document.createElement('optgroup');
        group.label = groupName;
        select.append(group);
        groups.set(groupName, group);
      }
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${ep.name} · ${ep.method} · ${ep.status || '未验证'}`;
      if (ep.name === previous) option.selected = true;
      groups.get(groupName).append(option);
    });
    if (!state.endpoints.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '暂无接口目录';
      select.append(option);
    }
    $('endpoint-count').textContent = `${state.endpoints.length} 个接口`;
    renderEndpoint();
  }
  async function bootstrap() {
    const data = await request('/api/bootstrap');
    if (typeof data.csrf !== 'string' || !data.csrf) throw new Error('后端未提供有效 CSRF 令牌。');
    state.csrf = data.csrf;
    state.ready = true;
    $('connection-state').textContent = '已连接';
    $('session-state').textContent = data.session?.hasCookie ? 'Cookie 已保存' : '未保存 Cookie';
    $('token-state').textContent = data.session?.hasToken ? 'Token 已保存 · 内容隐藏' : 'Token 未保存';
    renderEndpoints(data.endpoints);
    renderSchedule(data.schedule);
    renderLogin(data.login);
  }
  async function history() {
    try {
      const data = await request('/api/history');
      const list = $('history-list');
      list.replaceChildren();
      if (!Array.isArray(data.items) || !data.items.length) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = '还没有执行记录。完成一次操作后可在这里查看。';
        list.append(empty);
        return;
      }
      for (const item of data.items) {
        const row = document.createElement('article');
        row.className = 'history-item';
        const heading = document.createElement('header');
        const title = document.createElement('strong');
        title.textContent = String(item.action || '操作');
        const status = document.createElement('span');
        status.textContent = item.ok ? '成功' : '失败';
        if (!item.ok) status.className = 'failed';
        heading.append(title, status);
        const time = document.createElement('small');
        time.textContent = dateText(item.at);
        const summary = document.createElement('p');
        summary.textContent = typeof item.summary === 'string' ? item.summary : pretty(item.summary);
        row.append(heading, time, summary);
        list.append(row);
      }
    } catch (error) { $('history-list').textContent = `执行记录读取失败：${messageOf(error)}`; }
  }
  function output(target, meta, label, value, failed = false) {
    $(target).textContent = pretty(value);
    $(meta).textContent = `${label} · ${failed ? '失败' : '已返回'} · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
  }
  async function runTask(label, work, api = false) {
    try {
      const data = await work();
      output('task-result', 'result-meta', label, data.result);
      if (api) output('api-result', 'api-result-meta', label, data.result);
    } catch (error) {
      output('task-result', 'result-meta', label, { error: messageOf(error) }, true);
      if (api) output('api-result', 'api-result-meta', label, { error: messageOf(error) }, true);
      throw error;
    } finally { await history(); }
  }
  function needsConfirmation(ep) {
    return String(ep.method).toUpperCase() !== 'GET' || /redeem|exchange|delete|remove|update|create|upload|set|兑换|删除|修改|写入/i.test(`${ep.name} ${ep.path} ${ep.description}`);
  }
  function parseJSON(id, objectOnly) {
    let value;
    try { value = JSON.parse($(id).value); } catch { throw new Error(`${id === 'api-path' ? 'Path' : id === 'api-query' ? 'Query' : 'Body'} 不是有效 JSON。`); }
    if (objectOnly && (value === null || Array.isArray(value) || typeof value !== 'object')) throw new Error(`${id === 'api-path' ? 'Path' : 'Query'} 必须为 JSON 对象。`);
    return value;
  }
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`无法读取文件：${file.name}`));
      reader.onload = () => resolve({ base64: String(reader.result).split(',')[1] || '', filename: file.name, type: file.type || 'application/octet-stream' });
      reader.readAsDataURL(file);
    });
  }
  async function fileArgs() {
    const files = Object.create(null);
    for (const [inputId, keyId] of [['attachment', 'attachment-key'], ['avatar', 'avatar-key']]) {
      const selected = Array.from($(inputId).files);
      if (!selected.length) continue;
      const key = $(keyId).value.trim();
      if (!key || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('请填写有效的文件字段名。');
      for (let i = 0; i < selected.length; i++) {
        const field = selected.length > 1 ? `${key}.${i}` : key;
        if (Object.hasOwn(files, field)) throw new Error(`文件字段重复：${field}`);
        files[field] = await readFile(selected[i]);
      }
    }
    return files;
  }
  $('refresh').addEventListener('click', () => action('刷新状态', async () => { hideExport(); await bootstrap(); await history(); }));
  document.querySelectorAll('[data-workflow]').forEach((button) => button.addEventListener('click', () => action('执行签到流程', async () => {
    const step = button.dataset.workflow;
    if (step !== 'inspect' && step !== 'verify' && !await confirmAction('确认执行签到步骤', `即将运行 ${step}。此操作可能向官方服务提交请求；完整流程仅用于签到，不自动兑换。是否继续？`)) { notice('已取消操作。'); return; }
    await runTask(`workflow.${step}`, () => request('/api/workflow', { step }));
  })));
  $('list-tasks').addEventListener('click', () => action('获取任务列表', async () => {
    const ep = state.endpoints.find((item) => item.name === 'task.list');
    if (!ep) throw new Error('接口目录没有 task.list，请刷新目录或在官方任务站查看。');
    const confirmed = needsConfirmation(ep);
    if (confirmed && !await confirmAction('确认任务列表请求', `${ep.method} ${ep.path}\n此接口属于非 GET 或写操作，是否发送？`)) return;
    await runTask('task.list', () => request('/api/call', { name: ep.name, args: { path: {}, query: {} }, ...(confirmed ? { confirm: true } : {}) }));
  }));
  for (const [id, path, label] of [['login-start', '/api/login/start', '启动官方浏览器'], ['login-capture', '/api/login/capture', '提取并保存 Cookie'], ['login-cancel', '/api/login/cancel', '关闭官方浏览器']]) {
    $(id).addEventListener('click', () => action(label, async () => {
      hideExport();
      await request(path, {});
      await bootstrap();
      await history();
    }));
  }
  $('login-refresh').addEventListener('click', () => action('检查登录状态', async () => {
    const data = await request('/api/login/status');
    renderLogin(data.login || data);
    if ((data.login || data).state === 'saved') await bootstrap();
  }));
  $('session-form').addEventListener('submit', (event) => {
    event.preventDefault();
    action('保存会话', async () => {
      const cookie = $('cookie').value.trim();
      const token = $('token').value.trim();
      if (!cookie && !token) throw new Error('请至少填写 Cookie 或 Token；清除请使用“清除会话”。');
      hideExport();
      await request('/api/session', { ...(cookie ? { cookie } : {}), ...(token ? { token } : {}) });
      $('cookie').value = '';
      $('token').value = '';
      await bootstrap();
      await history();
    });
  });
  $('export-session').addEventListener('click', () => action('查看敏感凭据', async () => {
    if (!await confirmAction('显示敏感凭据？', 'Cookie 和 Token 等同登录凭证。确认后才会请求后端并显示，60 秒后自动隐藏。请避免录屏、截图或分享。')) return;
    const data = await request('/api/session/export', {});
    $('export-result').textContent = pretty({ cookie: data.cookie, token: data.token });
    $('export-area').hidden = false;
    clearTimeout(state.exportTimer);
    state.exportTimer = setTimeout(hideExport, 60000);
  }));
  $('hide-export').addEventListener('click', hideExport);
  $('clear-session').addEventListener('click', () => action('清除会话', async () => {
    if (!await confirmAction('清除本地会话？', '将删除本地服务保存的 Cookie / Token，之后需重新登录。此操作不会自动退出官方浏览器中的账号。')) return;
    hideExport();
    $('cookie').value = '';
    $('token').value = '';
    await request('/api/session', { clear: true });
    await bootstrap();
    await history();
  }));
  let smsWaiting = false;
  function renderSms(data) {
    $('sms-state').textContent = `${data.state === 'saved' ? '已保存登录会话；请核实任务站登录状态' : data.state === 'waiting' ? '等待输入登录验证码' : data.state === 'error' ? '登录失败，请检查返回信息或改用官方浏览器' : '短信登录已取消'}${data.message ? ` · ${data.message}` : ''}`;
    $('sms-result').hidden = false;
    $('sms-result').textContent = pretty({ state: data.state, message: data.message, verification: data.verification });
  }
  $('sms-start-form').addEventListener('submit', (event) => {
    event.preventDefault();
    action('发送登录短信', async () => {
      if (smsWaiting) throw new Error('已经发送过一次短信。请先提交验证码或取消本次登录，不会重复发送。');
      const phone = $('sms-phone').value.trim();
      if (!/^[+0-9][0-9\s-]{5,23}$/.test(phone)) throw new Error('请输入有效手机号。');
      if (!await confirmAction('确认发送一次登录短信', `将向 ${phone} 发送官方登录验证码。这不是开发者认证短信；遇风控请改用官方浏览器。是否发送？`)) return;
      smsWaiting = true;
      try { renderSms(await request('/api/sms/start', { phone })); }
      catch (error) { $('sms-state').textContent = `发送结果不确定或失败：${messageOf(error)}。为避免重复发送，请先取消再尝试。`; throw error; }
    });
  });
  $('sms-complete-form').addEventListener('submit', (event) => {
    event.preventDefault();
    action('提交登录验证码', async () => {
      if (!smsWaiting) throw new Error('请先发送一次官方登录短信。');
      const code = $('sms-code').value.trim();
      if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位数字登录验证码。');
      const data = await request('/api/sms/complete', { code });
      renderSms(data);
      $('sms-code').value = '';
      if (data.state === 'saved') {
        smsWaiting = false;
        $('sms-phone').value = '';
        await bootstrap();
        await history();
      }
      if (data.state === 'error') throw new Error(data.message || '短信登录未成功，请检查官方验证状态。');
    });
  });
  $('sms-cancel').addEventListener('click', () => action('取消短信登录', async () => {
    const data = await request('/api/sms/cancel', {});
    smsWaiting = false;
    $('sms-phone').value = '';
    $('sms-code').value = '';
    renderSms({ ...data, state: 'idle' });
  }));
  $('endpoint').addEventListener('change', renderEndpoint);
  $('clear-files').addEventListener('click', () => { $('attachment').value = ''; $('avatar').value = ''; });
  $('api-form').addEventListener('submit', (event) => {
    event.preventDefault();
    action('调用 API', async () => {
      const ep = selectedEndpoint();
      if (!ep) throw new Error('请先选择可用接口。');
      const args = { path: parseJSON('api-path', true), query: parseJSON('api-query', true) };
      const selectedFiles = $('attachment').files.length + $('avatar').files.length;
      if (String(ep.method).toUpperCase() !== 'GET' && !selectedFiles) args.body = parseJSON('api-body', false);
      const confirmed = needsConfirmation(ep);
      if (confirmed && !await confirmAction('确认发送写操作', `${ep.name}\n${ep.method} ${ep.path}\n状态：${ep.status || '未验证'}\n${selectedFiles ? `将包含 ${selectedFiles} 个本地文件。\n` : ''}该操作可能兑换、删除或修改官方数据，提交后可能无法撤销。是否继续？`)) return;
      const files = await fileArgs();
      if (Object.keys(files).length) args.files = files;
      await runTask(ep.name, () => request('/api/call', { name: ep.name, args, ...(confirmed ? { confirm: true } : {}) }), true);
    });
  });
  $('schedule-form').addEventListener('submit', (event) => {
    event.preventDefault();
    action('保存定时计划', async () => {
      const enabled = $('schedule-enabled').checked;
      const time = $('schedule-time').value;
      const timezone = $('schedule-timezone').value.trim();
      if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('请选择有效的每日执行时间。');
      try { new Intl.DateTimeFormat('zh-CN', { timeZone: timezone }); } catch { throw new Error('请输入有效 IANA 时区，例如 Asia/Shanghai。'); }
      if (!await confirmAction('确认保存签到计划', enabled ? `每天 ${time}（${timezone}）自动签到。需保持本地服务运行，不会自动兑换。是否启用？` : '将关闭自动签到。是否保存？')) return;
      const data = await request('/api/schedule', { enabled, time, timezone });
      renderSchedule(data.schedule);
      await history();
    });
  });
  $('history-refresh').addEventListener('click', () => action('读取执行记录', history));
  document.addEventListener('visibilitychange', () => { if (document.hidden) hideExport(); });
  window.addEventListener('pagehide', () => { hideExport(); clearTimeout(state.polling); });
  action('连接本地服务', async () => {
    try { await bootstrap(); } catch (error) {
      state.ready = false;
      $('connection-state').textContent = '连接失败';
      $('session-state').textContent = '状态未知';
      renderEndpoints([]);
      throw error;
    }
    await history();
  });
})();
