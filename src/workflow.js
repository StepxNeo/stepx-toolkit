export function taskItems(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['list', 'tasks', 'items', 'task_list']) if (Array.isArray(data?.[key])) return data[key];
  throw new Error('未知任务列表结构，已停止自动签到，请核对上游接口');
}
const yes = value => value === true || value === 1 || value === '1' || value === 'true';
const isSigned = task => yes(task.completed) && yes(task.rewarded);
export async function runWorkflow(client, step = 'all') {
  if (!['inspect', 'enter', 'sign', 'verify', 'all'].includes(step)) throw new Error('未知签到步骤');
  const result = { step, steps: [] };
  const inspect = async () => {
    const balance = await client.task.getBalance(); const raw = await client.task.list(); const tasks = taskItems(raw);
    return { balance, tasks, manualTasks: tasks.filter(t => Number(t.task_type) !== 1 && !yes(t.completed)), officialUrl: 'https://task.stepaos.com' };
  };
  if (step === 'inspect') return inspect();
  if (step === 'enter') return { firstEnter: await client.task.firstEnter() };
  if (step === 'verify') return inspect();
  const before = await inspect(); result.steps.push({ action: 'inspect', result: before });
  const signs = before.tasks.filter(t => Number(t.task_type) === 1);
  if (!signs.length) throw new Error('未发现每日签到任务，已停止，请在官方任务页核对');
  if (signs.every(isSigned)) { result.skipped = true; result.reason = '上游显示今日签到及奖励均已完成'; return result; }
  if (step === 'all') result.steps.push({ action: 'enter', result: await client.task.firstEnter() });
  result.steps.push({ action: 'sign', result: await client.task.sign() });
  const after = await inspect(); result.steps.push({ action: 'verify', result: after });
  const verified = after.tasks.filter(t => Number(t.task_type) === 1);
  if (!verified.length || !verified.every(isSigned)) throw new Error('签到请求已提交，但上游尚未确认完成及奖励到账；请手动核验，不自动重试');
  result.verified = true; return result;
}
