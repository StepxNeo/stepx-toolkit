import { readdir, mkdir, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ENDPOINTS } from '../src/sdk.js';
import { generate as checkDocs } from './gen-api-table.mjs';

for (const dir of ['src', 'bin', 'web', 'scripts', 'test']) {
  for (const file of await readdir(dir)) {
    if (!/\.(m?js)$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', join(dir, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
if (ENDPOINTS.length !== 44 || new Set(ENDPOINTS.map(e => e.name)).size !== 44) throw new Error('Endpoint catalog incomplete');
if (ENDPOINTS.some(e => typeof e.purpose !== 'string' || !e.purpose.trim())) throw new Error('Every endpoint needs a purpose description');
const staleDocs = await checkDocs(true);
if (staleDocs.length) throw new Error(`API tables out of date (${staleDocs.join(', ')}); run npm run docs:api`);
await rm('dist', { recursive: true, force: true });
await mkdir('dist/web', { recursive: true });
for (const file of ['index.html', 'app.js', 'styles.css', 'logo.svg']) await copyFile(join('web', file), join('dist/web', file));
console.log('Build passed: JavaScript syntax, 44 endpoint catalog, local Web assets → dist/web. Runtime serves source web/.');
