import { EventEmitter } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writePrivate } from './state.js';
import { longUuid, validateValue } from './hap.js';
import { validateHueHost, validateHueBridges } from './config.js';

export const HUE_ON = longUuid('25'), HUE_BRIGHTNESS = longUuid('8');
const bridgeIdPattern = /^[0-9A-F]{16}$/;
const keyPattern = /^[A-Za-z0-9_-]{10,128}$/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const hueServicePrefix = id => `hue/${id}/`;

// Credentials are never included in plugin config, service descriptions, or UI replies.
export class HueCredentialStore {
  constructor(directory) { this.directory = directory; this.file = join(directory, 'hue-bridges.json'); this.queue = Promise.resolve(); }
  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.version !== 1 || !record(data.keys) || Object.entries(data.keys).some(([id,key]) => !bridgeIdPattern.test(id) || !keyPattern.test(key))) throw new Error('Invalid credentials');
      return data.keys;
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw new Error('Cannot read saved Hue authorization. Check hue-bridges.json and its permissions; it has not been replaced.');
    }
  }
  save(id, key) {
    if (!bridgeIdPattern.test(id) || !keyPattern.test(key)) return Promise.reject(new Error('The Hue bridge returned invalid authorization.'));
    const task = this.queue.then(async () => {
      const keys = await this.load(); keys[id] = key;
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writePrivate(this.file, { version: 1, keys });
    });
    this.queue = task.catch(() => {}); return task;
  }
}

// Deliberately don't propagate SDK request objects or URLs: Hue v1 URLs contain keys.
export function hueError(error) {
  if (error?.type === 101) return new Error('Press the button on the physical Hue bridge, then try Connect again within 30 seconds.');
  if (error?.type === 1) return new Error('Hue authorization was refused. Reconnect this real Hue bridge in the plugin settings.');
  if ([3, 7, 201].includes(error?.type)) return new Error('Hue could not apply this command. Refresh the devices and check that the light is reachable.');
  return new Error('The real Hue bridge did not complete the request. Check its address, network connection, and firmware, then retry.');
}

export class HueTransport {
  constructor({ loadSdk } = {}) {
    this.loadSdk = loadSdk || (async () => {
      const [{ HueClient }, { HueDiscovery }] = await Promise.all([import('hb-hue-tools/HueClient'), import('hb-hue-tools/HueDiscovery')]);
      return { HueClient, HueDiscovery };
    });
  }
  async sdk() { return this.sdkPromise ||= this.loadSdk(); }
  async discovery() {
    const { HueDiscovery } = await this.sdk();
    const discovery = new HueDiscovery({ timeout: 5 }); discovery.on('error', () => {}); return discovery;
  }
  supported(config, HueClient) {
    return config && typeof config.bridgeid === 'string' && typeof config.name === 'string' &&
      bridgeIdPattern.test(config.bridgeid.toUpperCase()) && HueClient.isHueBridge(config) && /^BSB00[23]$/.test(config.modelid) &&
      /^\d+$/.test(config.swversion || '') && BigInt(config.swversion) >= 1804201116n && config.swversion !== '9999999999';
  }
  async discover() {
    const { HueClient } = await this.sdk();
    const found = await (await this.discovery()).discover({ stealth: true });
    const bridges = new Map();
    for (const [host, config] of Object.entries(found)) {
      try { validateHueHost(host); } catch { continue; }
      if (this.supported(config, HueClient)) bridges.set(config.bridgeid.toUpperCase(), { id: config.bridgeid.toUpperCase(), host, name: config.name.slice(0,64), model: config.modelid });
    }
    return [...bridges.values()];
  }
  async inspect(host) {
    validateHueHost(host);
    const { HueClient } = await this.sdk();
    let config;
    try { config = await (await this.discovery()).config(`${host}:443`); } catch (error) { throw hueError(error); }
    if (!this.supported(config, HueClient)) throw new Error('Choose a physical square Hue Bridge or Hue Bridge Pro with current firmware. Emulated bridges and deCONZ gateways cannot be linked here.');
    return { config, bridge: { id: config.bridgeid.toUpperCase(), host, name: config.name.slice(0,64), model: config.modelid } };
  }
  async connect(bridge, apiKey, inspected) {
    const { HueClient } = await this.sdk();
    const details = inspected || await this.inspect(bridge.host);
    if (details.bridge.id !== bridge.id) throw new Error('A different Hue bridge is at this address. Correct the address; existing mappings have not been reassigned.');
    // The maintained Hue client validates Hue CA certificates and bridge identity.
    // Turning retries off prevents replays of commands whose outcome is unknown.
    const client = new HueClient({ host: bridge.host, config: details.config, ...(apiKey ? { apiKey } : {}), timeout: 5, waitTimeResend: 0 });
    client.on('error', () => {}); return client;
  }
  async pair(host, store, expectedId) {
    const details = await this.inspect(host);
    if (expectedId && expectedId !== details.bridge.id) throw new Error('This address belongs to a different Hue bridge. Existing mappings have not been reassigned.');
    const keys = await store.load(), client = await this.connect(details.bridge, keys[details.bridge.id], details);
    try {
      if (keys[details.bridge.id]) {
        try { await client.get('/config'); return details.bridge; }
        catch (error) { if (error.type !== 1) throw error; }
      }
      const key = await client.getApiKey('harmony-home-control');
      await store.save(details.bridge.id, key);
      return details.bridge;
    } catch (error) { throw hueError(error); }
    finally { client.destroy?.(); }
  }
  async get(client, resource) { try { return await client.get(resource); } catch (error) { throw hueError(error); } }
  async put(client, resource, body) {
    try {
      const result = await client.put(resource, body);
      if (result.errors?.length) throw result.errors[0];
      return result;
    } catch (error) { throw hueError(error); }
  }
}

export class RealHueAccess extends EventEmitter {
  constructor({ bridges = [], store, transport = new HueTransport() }) {
    super(); this.bridges = validateHueBridges(bridges); this.store = store; this.transport = transport;
    this.services = new Map(); this.clients = new Map(); this.status = []; this.closed = false;
  }
  setBridges(bridges) {
    this.bridges = validateHueBridges(bridges);
    for (const [id, entry] of this.clients) if (!this.bridges.some(b => b.id === id && b.host === entry.host)) { entry.client.destroy?.(); this.clients.delete(id); }
    for (const [id, service] of this.services) if (!this.bridges.some(b => b.id === service.hueBridge)) this.services.delete(id);
  }
  async start() {
    await this.refresh();
    if (!this.closed) { this.poll = setInterval(() => void this.refresh(), 15000); this.poll.unref(); }
  }
  async client(bridge, keys) {
    if (!keys[bridge.id]) throw new Error('Connect this real Hue bridge in the plugin settings to authorize it.');
    let entry = this.clients.get(bridge.id);
    if (entry && (entry.host !== bridge.host || entry.key !== keys[bridge.id])) { entry.client.destroy?.(); entry = null; }
    if (!entry) {
      entry = { host: bridge.host, key: keys[bridge.id], client: await this.transport.connect(bridge, keys[bridge.id]) };
      if (this.closed) { entry.client.destroy?.(); throw new Error('Hue connection is closed.'); }
      this.clients.set(bridge.id, entry);
    }
    return entry.client;
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.loadServices().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async loadServices() {
    if (!this.bridges.length) { this.status = []; this.lastError = null; this.services.clear(); return []; }
    let keys;
    try { keys = await this.store.load(); }
    catch (error) {
      this.lastError = error.message;
      this.status = this.bridges.map(b => ({ id: b.id, name: b.name, connected: false, error: error.message }));
      for (const service of this.services.values()) { service.reachable = false; service.error = error.message; }
      return this.list();
    }
    const status = await Promise.all(this.bridges.map(async bridge => {
      try {
        const client = await this.client(bridge, keys);
        const [lights, groups] = await Promise.all([this.transport.get(client, '/lights'), this.transport.get(client, '/groups')]);
        if (!record(lights) || !record(groups)) throw new Error('The Hue bridge returned an invalid device list.');
        const fresh = new Map();
        for (const [resourceId, light] of Object.entries(lights)) {
          if (!/^\d+$/.test(resourceId) || typeof light.uniqueid !== 'string' || !light.uniqueid || typeof light.state?.on !== 'boolean') continue;
          const service = this.makeService(bridge, 'lights', resourceId, light, lights);
          fresh.set(service.id, service);
        }
        for (const [resourceId, group] of Object.entries(groups)) {
          if (!/^\d+$/.test(resourceId) || !Array.isArray(group.lights) || !group.lights.length || typeof group.action?.on !== 'boolean') continue;
          const service = this.makeService(bridge, 'groups', resourceId, group, lights);
          fresh.set(service.id, service);
        }
        if (!this.closed && this.bridges.some(b => b.id === bridge.id && b.host === bridge.host)) {
          for (const [id, service] of this.services) if (service.hueBridge === bridge.id) this.services.delete(id);
          for (const [id, service] of fresh) this.services.set(id, service);
        }
        return { id: bridge.id, name: bridge.name, connected: true, devices: fresh.size };
      } catch (error) {
        for (const service of this.services.values()) if (service.hueBridge === bridge.id) { service.reachable = false; service.error = error.message; }
        const entry = this.clients.get(bridge.id); entry?.client.destroy?.(); this.clients.delete(bridge.id);
        return { id: bridge.id, name: bridge.name, connected: false, error: error.message };
      }
    }));
    this.status = status; this.lastError = status.find(s => !s.connected)?.error || null; this.emit('updated'); return this.list();
  }
  makeService(bridge, kind, resourceId, resource, lights) {
    const group = kind === 'groups', state = group ? resource.action : resource.state;
    const dimmable = typeof state.bri === 'number' && (!group || resource.lights.some(id => typeof lights[id]?.state?.bri === 'number'));
    const reachable = group ? resource.lights.some(id => lights[id]?.state?.reachable !== false && lights[id]) : state.reachable !== false;
    const name = String(resource.name || (group ? 'Hue group' : 'Hue light')).slice(0,128);
    return { id: `${hueServicePrefix(bridge.id)}${kind}/${encodeURIComponent(group ? resourceId : resource.uniqueid)}`, source: 'hue', name,
      accessoryName: name, type: group ? 'HueGroup' : dimmable ? 'Lightbulb' : /plug/i.test(resource.type || '') ? 'Outlet' : 'Lightbulb',
      bridge: bridge.id, bridgeName: `Hue · ${bridge.name}`, hueBridge: bridge.id, kind, resourceId, uniqueid: resource.uniqueid, reachable: Boolean(reachable),
      characteristics: [
        { id: HUE_ON, type: 'On', format: 'bool', canRead: true, canWrite: true, value: group ? Boolean(resource.state?.any_on ?? state.on) : state.on },
        ...(dimmable ? [{ id: HUE_BRIGHTNESS, type: 'Brightness', format: 'int', canRead: true, canWrite: true, minValue: 0, maxValue: 100, minStep: 1, value: Math.round(state.bri * 100 / 254), unit: 'percentage' }] : []),
      ] };
  }
  list() { return [...this.services.values()].map(service => structuredClone(service)); }
  resolve(id, characteristicId) {
    const service = this.services.get(id);
    if (!service) throw new Error('Hue device not found. Refresh the accessory list and check its mapping.');
    if (!service.reachable) throw new Error(service.error || 'This Hue device is unreachable.');
    const characteristic = service.characteristics.find(c => c.id === characteristicId);
    if (!characteristic) throw new Error('This Hue device does not support the mapped control.');
    return { service, characteristic };
  }
  async read(id, characteristicId) {
    const { service, characteristic } = this.resolve(id, characteristicId);
    const client = this.clients.get(service.hueBridge)?.client;
    if (!client) throw new Error('The real Hue bridge is unavailable. Refresh the accessories.');
    const resource = await this.transport.get(client, `/${service.kind}/${service.resourceId}`);
    if (!record(resource)) throw new Error('The Hue device did not return its current state.');
    if (service.kind === 'lights' && resource.uniqueid !== service.uniqueid) { service.reachable = false; throw new Error('The original Hue light was replaced. Refresh and choose its mapping again.'); }
    const state = service.kind === 'groups' ? resource.action : resource.state;
    if (!state || state.reachable === false) { service.reachable = false; throw new Error('This Hue device is unreachable.'); }
    const value = characteristicId === HUE_ON ? (service.kind === 'groups' ? resource.state?.any_on ?? state.on : state.on) : Math.round(state.bri * 100 / 254);
    validateValue(characteristic, value); characteristic.value = value; return value;
  }
  async write(id, characteristicId, value) {
    const { service, characteristic } = this.resolve(id, characteristicId); validateValue(characteristic, value);
    // Resolve the current resource identity immediately before writes. Numeric Hue
    // resource IDs can be reused when a light is removed and replaced.
    await this.read(id, HUE_ON);
    const client = this.clients.get(service.hueBridge)?.client;
    const body = characteristicId === HUE_ON ? { on: value } : { bri: Math.max(1, Math.round(value * 254 / 100)) };
    await this.transport.put(client, `/${service.kind}/${service.resourceId}/${service.kind === 'groups' ? 'action' : 'state'}`, body);
    characteristic.value = value; return value;
  }
  close() { this.closed = true; clearInterval(this.poll); for (const entry of this.clients.values()) entry.client.destroy?.(); this.clients.clear(); }
}
