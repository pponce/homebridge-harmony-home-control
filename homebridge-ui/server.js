import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import { networkInterfaces } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CombinedAccess } from '../lib/access.js';
import { HueCredentialStore, HueTransport } from '../lib/real-hue.js';
import { Actions } from '../lib/actions.js';
import { PICKER_CATEGORIES } from '../lib/picker.js';
import { STORAGE, validateConfig, configHash, ROKU_KEYS, safeMessage } from '../lib/config.js';

export class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    const directory = join(this.homebridgeStoragePath, STORAGE);
    this.hueStore = new HueCredentialStore(directory);
    this.hueTransport = new HueTransport();
    this.onRequest('/bootstrap', async () => {
      const config = JSON.parse(await readFile(this.homebridgeConfigPath,'utf8'));
      return { addresses: Object.entries(networkInterfaces()).flatMap(([name, entries]) => entries.filter(e => e.family === 'IPv4' && !e.internal).map(e => ({ name, address: e.address }))),
        huePlatforms: (config.platforms || []).filter(p => p.platform === 'Hue').map(p => ({ name: p.name || 'Hue', hosts: p.hosts || [] })), keys: ROKU_KEYS, pickerCategories: PICKER_CATEGORIES };
    });
    this.onRequest('/hue/discover', async () => {
      try { return { bridges: await this.hueTransport.discover() }; }
      catch { throw new Error('Could not discover Hue bridges. Enter the bridge’s IP address to connect manually.'); }
    });
    this.onRequest('/hue/pair', async payload => ({ bridge: await this.hueTransport.pair(payload?.host, this.hueStore, payload?.expectedId) }));
    this.onRequest('/discover', async payload => {
      // Only public bridge descriptors come from the browser; keys stay on disk.
      const bridges = payload?.hueBridges || [];
      if (!this.access) {
        this.access = new CombinedAccess({ configPath: this.homebridgeConfigPath, directory, bridges, log: { info() {}, debug() {}, warn() {}, error() {} } });
        try { await this.access.start(); } catch (error) { this.access.close(); this.access = null; throw new Error(safeMessage(error)); }
        await new Promise(resolve => setTimeout(resolve, 3500));
      } else { this.access.setBridges(bridges); this.access.discover(); }
      return { services: await this.access.refresh(), error: this.access.lastError || null, bridges: this.access.hue.status };
    });
    this.onRequest('/validate', config => { const normalized = validateConfig(config); return { hash: configHash(normalized) }; });
    this.onRequest('/test', async payload => {
      if (!this.access) throw new Error('Refresh the accessory list first.');
      this.testActions ||= new Actions(this.access);
      try { return { value: await this.testActions.execute(payload.action) }; } catch (error) { throw new Error(safeMessage(error)); }
    });
    this.onRequest('/status', async () => {
      try { return await this.runtime('/status'); }
      catch { return { running: false, errors: [], events: [], message: 'Save your settings, restart this plugin’s bridge, then return here to pair Harmony.' }; }
    });
    this.onRequest('/pair', async () => {
      try { return await this.runtime('/pair','POST'); } catch (error) { throw new Error(safeMessage(error)); }
    });
    process.on('SIGTERM', () => { this.access?.close(); process.exit(0); });
    this.ready();
  }
  async runtime(path, method = 'GET') {
    const connection = JSON.parse(await readFile(join(this.homebridgeStoragePath, STORAGE, 'runtime.json'),'utf8'));
    if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535 || !/^[a-f0-9]{64}$/.test(connection.token)) throw new Error('Invalid runtime connection. Restart the plugin.');
    const response = await fetch(`http://127.0.0.1:${connection.port}${path}`, { method, redirect: 'error', headers: { Authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(3000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The plugin is unavailable.');
    return result;
  }
}
new UiServer();
