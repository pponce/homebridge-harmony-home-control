import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function writePrivate(file, data) {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
}

export class StateStore {
  constructor(directory) { this.directory = directory; this.file = join(directory, 'state.json'); this.queue = Promise.resolve(); }
  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      this.data = JSON.parse(await readFile(this.file, 'utf8'));
      if (this.data.version !== 1 || !/^[a-f0-9]{12}$/.test(this.data.serial) || !this.data.users || !this.data.lightIds || !this.data.groups || !Number.isInteger(this.data.nextLightId) || !Number.isInteger(this.data.nextGroupId)) throw new Error('Invalid state');
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Cannot read the saved bridge identity. Preserve state.json and fix its permissions or contents before restarting.');
      this.data = { version: 1, serial: randomBytes(6).toString('hex'), users: {}, lightIds: {}, nextLightId: 1, groups: {}, nextGroupId: 1 };
      await this.save();
    }
    return this;
  }
  save() {
    const snapshot = structuredClone(this.data);
    const task = this.queue.then(() => writePrivate(this.file, snapshot));
    this.queue = task.catch(() => {});
    return task;
  }
  async assignLightIds(devices) {
    let changed = false;
    for (const item of devices) if (!Object.hasOwn(this.data.lightIds, item.id)) { this.data.lightIds[item.id] = String(this.data.nextLightId++); changed = true; }
    if (changed) await this.save();
  }
  get uuid() { return `2f402f80-da50-11e1-9b23-${this.data.serial}`; }
  get bridgeId() { return `${this.data.serial.slice(0,6)}fffe${this.data.serial.slice(6)}`.toUpperCase(); }
  get mac() { return this.data.serial.match(/../g).join(':'); }
  get rokuSerial() { return `HHC${this.data.serial.toUpperCase()}`; }
}
