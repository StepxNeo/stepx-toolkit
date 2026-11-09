import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ENDPOINTS } from '../src/endpoints.js';
import { buildReadmeTables, buildApiMatrix, generate, README_START, README_END } from '../scripts/gen-api-table.mjs';

test('every endpoint carries a one-line description and a longer purpose', () => {
  assert.equal(ENDPOINTS.length, 44);
  for (const endpoint of ENDPOINTS) {
    assert.equal(typeof endpoint.description, 'string', endpoint.name);
    assert.ok(endpoint.description.trim().length >= 2, endpoint.name);
    assert.equal(typeof endpoint.purpose, 'string', endpoint.name);
    assert.ok(endpoint.purpose.trim().length >= 6, `${endpoint.name} purpose too short`);
    assert.equal(endpoint.group, endpoint.name.split('.')[0]);
    assert.equal(endpoint.target, endpoint.name.startsWith('task.') ? 'task' : 'api');
  }
});

test('documentation tables list all 44 endpoints with their purpose', () => {
  const readme = buildReadmeTables();
  const matrix = buildApiMatrix();
  for (const endpoint of ENDPOINTS) {
    assert.ok(readme.includes(`\`${endpoint.name}\``), `README missing ${endpoint.name}`);
    assert.ok(readme.includes(endpoint.purpose.replace(/\|/g, '\\|')), `README missing purpose of ${endpoint.name}`);
    assert.match(matrix, new RegExp(`^\\| ${endpoint.name.replace('.', '\\.')} \\|`, 'm'));
  }
  assert.equal((matrix.match(/^\| (?!name|---)/gm) || []).length, 44);
});

test('checked-in README and API docs tables are in sync with the catalogue', async () => {
  assert.deepEqual(await generate(true), []);
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes(README_START) && readme.includes(README_END));
  assert.ok(readme.indexOf(README_START) < readme.indexOf('## 1. 快速启动'), 'endpoint table should sit before the quick-start section');
});
