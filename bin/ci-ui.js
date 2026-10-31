import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const results = ['test/ui.mjs','test/configurator-ui.mjs'].map(file => spawnSync(process.execPath,[file],{ encoding: 'utf8',timeout: 180000 }));
const output = results.map(result => `${result.stdout || ''}${result.stderr || ''}${result.error?.message || ''}`).join('\n');
const success = results.every(result => result.status === 0);
process.stdout.write(output);
await mkdir('local-work/artifacts',{ recursive: true });
await writeFile('local-work/artifacts/ui-result.json',JSON.stringify({ success, output }));
process.exitCode = success ? 0 : 1;
