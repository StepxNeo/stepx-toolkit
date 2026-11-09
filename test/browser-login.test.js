import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OFFICIAL_LOGIN_URL } from '../src/login.js';

test('browser login uses the mobile official login URL, task gateway scope stays unchanged', async () => {
  assert.equal(OFFICIAL_LOGIN_URL, 'https://m.stepx.com/pages/users/login/index');
  const source = await readFile(new URL('../src/login.js', import.meta.url), 'utf8');
  assert.match(source, /const TARGETS = \[OFFICIAL_LOGIN_URL,/);
  assert.match(source, /await page\.goto\(TARGETS\[0\]/);
  assert.match(source, /https:\/\/otter-gateway\.stepaos\.com\/api\/step\.otter\.zhiyueapp\.api\/GetBalance/);
});
