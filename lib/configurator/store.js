import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { writePrivate } from '../state.js';
import { ConfiguratorError, fail } from './hub.js';
import { reconcileIrCodes } from './ir-cache.js';

export class ConfiguratorStore {
  constructor(directory) { this.file = join(directory,'configurator.json'); this.data = { version:1, revision:0, hubs:{} }; this.busy = false; }
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.file,'utf8'));
      if (saved.version !== 1 || !Number.isSafeInteger(saved.revision) || saved.revision < 0 || !saved.hubs || typeof saved.hubs !== 'object' || Array.isArray(saved.hubs)) throw new Error();
      for (const [host,hub] of Object.entries(saved.hubs)) {
        if (isIP(host) !== 4 || !hub || !Array.isArray(hub.drafts) || !hub.context?.devices || typeof hub.context.devices !== 'object' || typeof hub.context.automations !== 'string') throw new Error();
        if (hub.model && (!Array.isArray(hub.model.devices) || !Array.isArray(hub.model.activities) || !Array.isArray(hub.model.maps) || typeof hub.model.version !== 'string')) throw new Error();
        if (hub.drafts.some(d => !d || typeof d.key !== 'string' || typeof d.field !== 'string' || typeof d.status !== 'string')) throw new Error();
        reconcileIrCodes(hub);
      }
      this.data = saved;
      for (const hub of Object.values(this.data.hubs)) for (const draft of hub.drafts || []) {
        if (draft.status === 'saving') draft.status = 'unconfirmed';
      }
    } catch (error) { if (error.code !== 'ENOENT') throw new ConfiguratorError('The configurator state could not be read. Its file has been preserved.',500); }
    return this;
  }
  hub(host) { return this.data.hubs[host] || { model:null, identity:null, context:{devices:{},automations:''},drafts:[],lastError:null }; }
  async mutate(revision, fn) {
    if (this.busy) fail('Another configurator operation is in progress. Wait for it to finish.',409);
    if (revision != null && revision !== this.data.revision) fail('This page is out of date. Reload before saving your changes.',409);
    this.busy = true; const before = structuredClone(this.data);
    try {
      const result = await fn(this.data);
      this.data.revision++;
      await writePrivate(this.file,this.data);
      return result;
    } catch (error) { this.data = before; throw error; }
    finally { this.busy = false; }
  }
}
