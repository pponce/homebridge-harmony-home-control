import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const result = spawnSync(process.execPath,['test/ui.mjs'],{ encoding: 'utf8',timeout: 180000 });
const output = `${result.stdout || ''}${result.stderr || ''}${result.error?.message || ''}`;
process.stdout.write(output);
await mkdir('local-work/artifacts',{ recursive: true });
await writeFile('local-work/artifacts/ui-result.json',JSON.stringify({ success: result.status === 0, output }));
process.exitCode = result.status === 0 ? 0 : 1;
