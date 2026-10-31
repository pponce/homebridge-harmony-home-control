import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { bridgeCredentials, safeMessage } from './config.js';

export const longUuid = value => value.length <= 8 ? value.toUpperCase().padStart(8, '0') + '-0000-1000-8000-0026BB765291' : value.toUpperCase();
const readableFormats = new Set(['bool', 'int', 'float', 'uint8', 'uint16', 'uint32', 'uint64', 'string']);
export const numeric = c => ['int', 'float', 'uint8', 'uint16', 'uint32', 'uint64'].includes(c.format);

export function validateValue(characteristic, value) {
  if (!characteristic.canWrite) throw new Error('This control is read-only or requires a write mode that is not supported.');
  if (characteristic.format === 'bool' && typeof value !== 'boolean') throw new Error('This control requires true or false.');
  if (characteristic.format === 'string' && (typeof value !== 'string' || value.length > (characteristic.maxLen ?? 256))) throw new Error('This control requires a valid text value.');
  if (numeric(characteristic)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('This control requires a number.');
    if (characteristic.format !== 'float' && !Number.isSafeInteger(value)) throw new Error('This control requires a whole number.');
    if (characteristic.minValue !== undefined && value < characteristic.minValue || characteristic.maxValue !== undefined && value > characteristic.maxValue) throw new Error('The value is outside the accessory’s allowed range.');
    if (characteristic.minStep && Math.abs((value - (characteristic.minValue ?? 0)) / characteristic.minStep - Math.round((value - (characteristic.minValue ?? 0)) / characteristic.minStep)) > 1e-6) throw new Error('The value does not match the accessory’s allowed step size.');
  }
  if (characteristic.validValues?.length && !characteristic.validValues.includes(value)) throw new Error('Choose one of the accessory’s allowed values.');
  return value;
}

export function quantize(value, c) {
  const step = c.minStep || (c.format === 'float' ? 0 : 1);
  if (step) value = (c.minValue ?? 0) + Math.round((value - (c.minValue ?? 0)) / step) * step;
  return Math.max(c.minValue ?? -Infinity, Math.min(c.maxValue ?? Infinity, Number(value.toFixed(6))));
}

export class HapAccess extends EventEmitter {
  constructor({ configPath, log = console, request = fetch, clientFactory, types } = {}) {
    super(); this.configPath = configPath; this.log = log; this.request = request; this.clientFactory = clientFactory; this.types = types;
    this.instances = new Map(); this.services = new Map(); this.closed = false;
    this.credentials = { pin: '', pins: {} };
  }
  async start() {
    const config = JSON.parse(await readFile(this.configPath, 'utf8'));
    this.credentials = bridgeCredentials(config);
    this.bridgeNames = { [config.bridge.username?.toUpperCase() || '']: config.bridge.name || 'Homebridge' };
    for (const entry of [...(config.platforms || []), ...(config.accessories || [])]) if (entry._bridge?.username) this.bridgeNames[entry._bridge.username.toUpperCase()] = entry.name || entry.platform || entry.accessory || 'Child bridge';
    if (!this.clientFactory) {
      const [{ HapClient }, types] = await Promise.all([import('@homebridge/hap-client'), import('@homebridge/hap-client/hap-types')]);
      this.clientFactory = options => new HapClient(options); this.types = types;
    }
    const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, message => this.log[level]?.(safeMessage(message))]));
    this.client = this.clientFactory({ ...this.credentials, logger, config: { autoStartDiscovery: false, discoveryTimeout: 10000 } });
    this.client.on('instance-discovered', instance => {
      if (this.closed) return;
      this.instances.set(instance.username.toUpperCase(), instance);
      void this.refresh().catch(e => this.log.warn?.(safeMessage(e)));
    });
    this.client.startDiscovery();
    this.poll = setInterval(() => void this.refresh().catch(e => this.log.warn?.(safeMessage(e))), 15000); this.poll.unref();
    this.discover = setInterval(() => this.client.refreshInstances(), 60000); this.discover.unref();
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.loadServices().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async requestHap(instance, path, options = {}) {
    let response;
    try {
      response = await this.request(`http://${instance.ipAddress}:${instance.port}${path}`, {
        ...options, redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/hap+json', Authorization: this.credentials.pins[instance.username.toUpperCase()] || this.credentials.pin, ...options.headers },
      });
    } catch { throw new Error('Accessory bridge did not respond. Check that it is running and reachable.'); }
    if ([401, 403, 470].includes(response.status)) throw new Error('Accessory control was refused. Enable Homebridge accessory control (-I) and check the bridge PIN in your local configuration.');
    if (!response.ok) throw new Error(`Accessory bridge returned HTTP ${response.status}.`);
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw new Error('Accessory bridge returned an invalid response.'); }
  }
  async loadServices() {
    const failures = [];
    await Promise.all([...this.instances.values()].map(async instance => {
      const bridge = instance.username.toUpperCase();
      try {
        const data = await this.requestHap(instance, '/accessories');
        if (!Array.isArray(data?.accessories)) throw new Error('Missing accessory list.');
        const fresh = new Map();
        for (const accessory of data.accessories) {
          const information = accessory.services.find(s => longUuid(s.type).startsWith('0000003E-'));
          const accessoryName = information?.characteristics.find(c => longUuid(c.type).startsWith('00000023-'))?.value;
          for (const service of accessory.services) {
            const uuid = longUuid(service.type);
            if (uuid.startsWith('0000003E-')) continue;
            const id = `${bridge}/${accessory.aid}/${service.iid}`;
            const characteristics = service.characteristics.map(c => {
              const type = longUuid(c.type);
              return { id: type, iid: c.iid, type: this.types?.Characteristics?.[type] || c.description || type, format: c.format,
                value: c.value, canRead: c.perms.includes('pr'), canWrite: c.perms.includes('pw') && !c.perms.includes('tw') && !c.perms.includes('aa') && readableFormats.has(c.format),
                minValue: c.minValue, maxValue: c.maxValue, minStep: c.minStep, validValues: c['valid-values'], maxLen: c.maxLen, unit: c.unit };
            });
            if (!characteristics.some(c => c.canWrite)) continue;
            fresh.set(id, { id, name: service.characteristics.find(c => longUuid(c.type).startsWith('00000023-'))?.value || accessoryName || 'Accessory',
              accessoryName, type: this.types?.Services?.[uuid] || uuid, bridge, bridgeName: this.bridgeNames?.[bridge], aid: accessory.aid, iid: service.iid, reachable: true, characteristics, instance });
          }
        }
        for (const [id, service] of this.services) if (service.bridge === bridge) this.services.delete(id);
        for (const [id, service] of fresh) this.services.set(id, service);
      } catch (error) {
        for (const service of this.services.values()) if (service.bridge === bridge) { service.reachable = false; service.error = safeMessage(error); }
        failures.push(safeMessage(error));
      }
    }));
    this.lastError = failures[0] || null;
    this.emit('updated');
    return this.list();
  }
  list() { return [...this.services.values()].map(({ instance, ...service }) => structuredClone(service)).sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)); }
  resolve(serviceId, characteristicId) {
    const service = this.services.get(serviceId);
    if (!service) throw new Error('Accessory not found. Refresh the accessory list and check its mapping.');
    if (!service.reachable) throw new Error(service.error || 'Accessory bridge is unavailable.');
    const characteristic = service.characteristics.find(c => c.id === characteristicId);
    if (!characteristic) throw new Error('The mapped control no longer exists. Choose the accessory control again.');
    return { service, characteristic };
  }
  async read(serviceId, characteristicId) {
    const { service, characteristic } = this.resolve(serviceId, characteristicId);
    if (!characteristic.canRead) throw new Error('This action requires a readable control.');
    const data = await this.requestHap(service.instance, `/characteristics?id=${service.aid}.${characteristic.iid}`);
    const result = data?.characteristics?.find(c => c.aid === service.aid && c.iid === characteristic.iid);
    if (!result || result.status && result.status !== 0 || result.value === undefined) throw new Error('Accessory could not report its current value.');
    characteristic.value = result.value;
    return result.value;
  }
  async write(serviceId, characteristicId, value) {
    const { service, characteristic } = this.resolve(serviceId, characteristicId);
    validateValue(characteristic, value);
    const data = await this.requestHap(service.instance, '/characteristics', { method: 'PUT', body: JSON.stringify({ characteristics: [{ aid: service.aid, iid: characteristic.iid, value }] }) });
    if (data !== null) {
      const results = data?.characteristics;
      const result = results?.find(c => c.aid === service.aid && c.iid === characteristic.iid);
      if (!result || result.status && result.status !== 0) throw new Error(`Accessory rejected the command${result?.status ? ` (HAP ${result.status})` : ''}.`);
    }
    characteristic.value = value;
    return value;
  }
  close() { this.closed = true; clearInterval(this.poll); clearInterval(this.discover); this.client?.destroy(); }
}
