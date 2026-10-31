import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function walk(directory) {
  for (const entry of await readdir(directory,{ withFileTypes: true })) {
    if (['node_modules','.git','local-work'].includes(entry.name)) continue;
    const path = join(directory,entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (path.endsWith('.js') || path.endsWith('.mjs')) {
      const result = spawnSync(process.execPath,['--check',path],{ encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    } else if (path.endsWith('.json')) JSON.parse(await readFile(path,'utf8'));
  }
}
await walk(root);
console.log('JavaScript syntax and JSON files validated.');
