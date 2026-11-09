// Generates the endpoint documentation tables from src/endpoints.js so the
// catalogue, the README table and docs/API.md can never drift apart.
// Usage: node scripts/gen-api-table.mjs [--check]
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ENDPOINTS } from '../src/endpoints.js';

const GROUPS = {
  identity: '身份与开发者认证',
  developer: '身份与开发者认证',
  projects: '项目',
  integrate: '连接器与插件',
  kit: '素材库',
  inbox: '站内信',
  models: '模型、音色与附件',
  attachments: '模型、音色与附件',
  task: 'A 豆 / 任务中心',
};
const GROUP_ORDER = ['身份与开发者认证', '项目', '连接器与插件', '素材库', '站内信', '模型、音色与附件', 'A 豆 / 任务中心'];

export const README_START = '<!-- API_TABLE_START -->';
export const README_END = '<!-- API_TABLE_END -->';
export const API_DOC_START = '<!-- API_MATRIX_START -->';
export const API_DOC_END = '<!-- API_MATRIX_END -->';

const cell = value => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const sorted = [...ENDPOINTS].sort((a, b) => GROUP_ORDER.indexOf(GROUPS[a.group]) - GROUP_ORDER.indexOf(GROUPS[b.group]));

/** README: one table per functional group, so each endpoint carries its purpose. */
export function buildReadmeTables() {
  const out = [];
  for (const group of GROUP_ORDER) {
    const rows = sorted.filter(endpoint => GROUPS[endpoint.group] === group);
    if (!rows.length) continue;
    out.push(`### ${group}`, '', '| 接口 | 方法 | 路径 | 作用 | 状态 |', '| --- | --- | --- | --- | --- |');
    for (const endpoint of rows) {
      out.push(`| \`${cell(endpoint.name)}\` | ${endpoint.method} | \`${cell(endpoint.path)}\` | ${cell(endpoint.purpose)} | ${cell(endpoint.status)} |`);
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}

/** docs/API.md: flat matrix with the same purpose text. */
export function buildApiMatrix() {
  const out = [
    '| name | method | path | target | 作用 | 上游状态 |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const endpoint of ENDPOINTS) {
    out.push(`| ${cell(endpoint.name)} | ${endpoint.method} | ${cell(endpoint.path)} | ${endpoint.target} | ${cell(endpoint.purpose)} | ${cell(endpoint.status)} |`);
  }
  return out.join('\n');
}

export function replaceBlock(source, start, end, body) {
  const from = source.indexOf(start); const to = source.indexOf(end);
  if (from < 0 || to < 0 || to < from) throw new Error(`文档缺少标记 ${start} / ${end}`);
  return `${source.slice(0, from + start.length)}\n${body}\n${source.slice(to)}`;
}

export async function generate(check = false) {
  const jobs = [
    ['README.md', README_START, README_END, buildReadmeTables()],
    ['docs/API.md', API_DOC_START, API_DOC_END, buildApiMatrix()],
  ];
  const stale = [];
  for (const [file, start, end, body] of jobs) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const next = replaceBlock(source, start, end, body);
    if (next === source) continue;
    if (check) stale.push(file); else await writeFile(new URL(`../${file}`, import.meta.url), next);
  }
  return stale;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const check = process.argv.includes('--check');
  const stale = await generate(check);
  if (check && stale.length) {
    console.error(`接口表格已过期：${stale.join(', ')}。请运行 npm run docs:api 重新生成。`);
    process.exit(1);
  }
  console.log(check ? '接口表格与 ENDPOINTS 一致。' : `已根据 ${ENDPOINTS.length} 项接口更新表格。`);
}
