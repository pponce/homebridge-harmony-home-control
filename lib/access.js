import { HapAccess } from './hap.js';
import { HueCredentialStore, RealHueAccess } from './real-hue.js';
import { pickerService } from './picker.js';

// Both protocols and the editor use the same routing layer. HAP IDs are unchanged.
export class CombinedAccess {
  constructor({ configPath, directory, bridges = [], log, hap, hue } = {}) {
    this.log = log || console;
    this.hap = hap || new HapAccess({ configPath, log });
    this.hue = hue || new RealHueAccess({ log: this.log, bridges, store: new HueCredentialStore(directory) });
    this.startErrors = [];
  }
  async start() {
    await Promise.all([this.hap, this.hue].map(async provider => {
      try { await provider.start(); }
      catch (error) { this.startErrors.push(error.message); this.log.warn?.('Accessory provider could not start. Check connection status in settings.'); }
    }));
  }
  setBridges(bridges) { this.hue.setBridges(bridges); }
  discover() { this.hap.client?.refreshInstances(); }
  async refresh() {
    await Promise.allSettled([this.hap.refresh(), this.hue.refresh()]);
    return this.list();
  }
  get services() { return new Map([...this.hap.services, ...this.hue.services]); }
  get lastError() { return [this.hap.lastError, this.hue.lastError, ...this.startErrors].filter(Boolean).join(' ') || null; }
  list() { return [...this.hap.list().map(s => ({ ...s, source: 'homebridge' })), ...this.hue.list()].map(pickerService).sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)); }
  provider(id) { return id.startsWith('hue/') ? this.hue : this.hap; }
  resolve(id, characteristic) { return this.provider(id).resolve(id, characteristic); }
  read(id, characteristic) { return this.provider(id).read(id, characteristic); }
  write(id, characteristic, value) { return this.provider(id).write(id, characteristic, value); }
  async close() {
    await Promise.all([this.hap, this.hue].map(async provider => {
      try { await provider.close(); } catch { this.log.warn?.('Accessory provider cleanup failed.'); }
    }));
  }
}
