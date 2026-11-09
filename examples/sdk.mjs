import { createClientFromEnv } from '../src/sdk.js';
import { runWorkflow } from '../src/workflow.js';

const client = createClientFromEnv();
// Read-only by default. Output may contain private data: do not share raw logs.
console.log(await client.task.getBalance());
console.log(await client.task.list());
// Explicitly enable writes only after checking your account and official task rules:
// console.log(await runWorkflow(client, 'all'));
// const bytes = await readFile('./image.png');
// await client.attachments.upload({ buffer: bytes, filename: 'image.png', type: 'image/png' });
