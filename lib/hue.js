import { randomBytes, createHash } from 'node:crypto';
import { makeServer, listen, closeServer, xml, json, body, hubAllowed, remoteIp, escapeXml } from './http.js';
import { safeMessage } from './config.js';
import { numeric, quantize, validateValue } from './hap.js';

const errorResponse = (type, address, description) => ({ error: { type, address, description } });
const success = (address, value) => ({ success: { [address]: value } });

export class HueServer {
  constructor({ config, state, access, actions, report = () => {}, now = Date.now }) {
    Object.assign(this, { config, state, access, actions, report, now }); this.pairUntil = 0; this.pairingDiagnostic = null; this.pairAttempts = new Map();
    this.devices = new Map(config.hueDevices.map(item => [state.data.lightIds[item.id], item]));
  }
  openPairing() { this.pairUntil = this.now() + 120000; return { pairingUntil: this.pairUntil }; }
  description() {
    return `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><URLBase>http://${this.config.advertiseAddress}:${this.port || this.config.huePort}/</URLBase><device><deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType><friendlyName>Harmony Home Control Hue</friendlyName><manufacturer>Royal Philips Electronics</manufacturer><manufacturerURL>http://www.philips.com</manufacturerURL><modelDescription>Philips hue Personal Wireless Lighting</modelDescription><modelName>Philips hue bridge 2015</modelName><modelNumber>BSB002</modelNumber><serialNumber>${this.state.data.serial}</serialNumber><UDN>uuid:${this.state.uuid}</UDN><presentationURL>index.html</presentationURL></device></root>`;
  }
  bridgeConfig(full = false) {
    const value = { name: 'Harmony Home Control', bridgeid: this.state.bridgeId, mac: this.state.mac, dhcp: true, ipaddress: this.config.advertiseAddress, netmask: '255.255.255.0', gateway: '0.0.0.0', proxyaddress: 'none', proxyport: 0, modelid: 'BSB002', swversion: '9999999999', apiversion: '1.17.0', factorynew: false, replacesbridgeid: null, starterkitid: '', swupdate: { updatestate: 0, checkforupdate: false, devicetypes: { bridge: false, lights: [], sensors: [] }, url: '', text: '', notify: false } };
    if (full) Object.assign(value, { linkbutton: this.now() < this.pairUntil, portalservices: false, portalconnection: 'disconnected', UTC: new Date(this.now()).toISOString().slice(0,19), localtime: new Date(this.now()).toISOString().slice(0,19), timezone: 'UTC', whitelist: Object.fromEntries(Object.entries(this.state.data.users).map(([key, user]) => [key, { name: user.name, 'create date': user.created, 'last use date': user.created }])) });
    return value;
  }
  light(id) {
    const item = this.devices.get(id);
    if (!item) return null;
    let on = false, bri = 254, reachable = false;
    try {
      const { characteristic: power } = this.access.resolve(item.serviceId, item.power.characteristic);
      on = power.value === item.power.onValue; reachable = power.canWrite;
      if (item.brightness) {
        const { characteristic: dim } = this.access.resolve(item.serviceId, item.brightness.characteristic);
        reachable = reachable && dim.canWrite;
        bri = Math.max(0, Math.min(254, Math.round((Number(dim.value) - item.brightness.min) * 254 / (item.brightness.max - item.brightness.min))));
        if (!Number.isFinite(bri)) bri = 254;
      }
    } catch {}
    const unique = createHash('sha256').update(`${this.state.data.serial}:${id}`).digest('hex').slice(0,16).match(/../g).join(':');
    return { state: { on, ...(item.brightness ? { bri } : {}), alert: 'none', reachable }, type: item.brightness ? 'Dimmable light' : 'On/Off light', name: item.name, modelid: item.brightness ? 'LWB010' : 'LWB004', manufacturername: 'Philips', swversion: '1.0', uniqueid: `${unique}-0b` };
  }
  lights() { return Object.fromEntries([...this.devices.keys()].map(id => [id, this.light(id)])); }
  group(id) {
    const group = id === '0' ? { name: 'All lights', lights: [...this.devices.keys()] } : Object.hasOwn(this.state.data.groups,id) ? this.state.data.groups[id] : null;
    if (!group) return null;
    const ids = group.lights.filter(lightId => this.devices.has(lightId)); const lights = ids.map(lightId => this.light(lightId));
    return { name: group.name, type: 'LightGroup', lights: ids, state: { all_on: lights.length > 0 && lights.every(l => l.state.on), any_on: lights.some(l => l.state.on) }, action: { on: lights.some(l => l.state.on), bri: lights.find(l => l.state.bri !== undefined)?.state.bri ?? 254 } };
  }
  groups() { return Object.fromEntries(Object.keys(this.state.data.groups).map(id => [id, this.group(id)])); }
  async changeLight(id, input, address = `/lights/${id}/state`) {
    const item = this.devices.get(id);
    if (!item) return [errorResponse(3, address, 'Light not found.')];
    return this.actions.serial(item.serviceId, async () => {
      try {
        for (const key of Object.keys(input)) if (!['on', 'bri', 'bri_inc', 'transitiontime'].includes(key)) return [errorResponse(6, `${address}/${key}`, 'Parameter not available.')];
        if ('on' in input && typeof input.on !== 'boolean') return [errorResponse(7, `${address}/on`, 'Expected true or false.')];
        if ('bri' in input && (!Number.isInteger(input.bri) || input.bri < 0 || input.bri > 254)) return [errorResponse(7, `${address}/bri`, 'Brightness must be 0–254.')];
        if ('bri_inc' in input && (!Number.isInteger(input.bri_inc) || Math.abs(input.bri_inc) > 254)) return [errorResponse(7, `${address}/bri_inc`, 'Brightness adjustment must be -254–254.')];
        if ('bri' in input && 'bri_inc' in input) return [errorResponse(7, address, 'Specify brightness or brightness adjustment.')];
        if ('transitiontime' in input && (!Number.isInteger(input.transitiontime) || input.transitiontime < 0)) return [errorResponse(7, `${address}/transitiontime`, 'Invalid transition time.')];
        const hasDim = 'bri' in input || 'bri_inc' in input;
        if (hasDim && !item.brightness) return [errorResponse(6, `${address}/bri`, 'This accessory has no brightness mapping.')];
        const operations = [];
        if (hasDim) {
          const dim = item.brightness, c = this.access.resolve(item.serviceId, dim.characteristic).characteristic;
          if (!numeric(c)) throw new Error('Brightness needs a numeric control.');
          let bri = input.bri;
          if ('bri_inc' in input) {
            const current = await this.access.read(item.serviceId, dim.characteristic);
            bri = Math.max(0, Math.min(254, Math.round((current - dim.min) * 254 / (dim.max - dim.min)) + input.bri_inc));
          }
          const value = quantize(dim.min + bri * (dim.max - dim.min) / 254, c);
          validateValue(c, value); operations.push({ characteristic: dim.characteristic, value });
        }
        if ('on' in input) {
          const value = input.on ? item.power.onValue : item.power.offValue;
          if (value !== null) { const c = this.access.resolve(item.serviceId, item.power.characteristic).characteristic; validateValue(c, value); operations.push({ characteristic: item.power.characteristic, value }); }
        }
        // Apply brightness first, then explicit power. An off+bri command must end off.
        for (const operation of operations) await this.access.write(item.serviceId, operation.characteristic, operation.value);
        this.report({ source: 'hue', name: item.name, ok: true });
        return Object.entries(input).map(([key,value]) => success(`${address}/${key}`, value));
      } catch (error) {
        this.report({ source: 'hue', name: item.name, ok: false, message: safeMessage(error) });
        return [errorResponse(901, address, safeMessage(error))];
      }
    });
  }
  async handle(request, response) {
    const path = new URL(request.url, 'http://localhost').pathname.replace(/\/$/, '') || '/';
    if (request.method === 'GET' && (path === '/' || path === '/description.xml')) return xml(response, this.description());
    if (request.method === 'GET' && path === '/api/config') return json(response, this.bridgeConfig());
    const registration = request.method === 'POST' && path === '/api';
    const peer = remoteIp(request);
    if (registration) {
      const now = this.now(), previous = this.pairAttempts.get(peer);
      const attempts = previous && now - previous.at < 1000 ? previous : { at: now, count: 0 };
      if (!this.pairAttempts.has(peer) && this.pairAttempts.size >= 256) this.pairAttempts.delete(this.pairAttempts.keys().next().value);
      this.pairAttempts.set(peer, attempts);
      if (++attempts.count > 5) return json(response, [errorResponse(901, '/', 'Too many pairing requests.')], 429);
      this.pairingDiagnostic = { address: peer, at: new Date(now).toISOString(), result: 'received' };
    }
    // A phone can register while the user opens pairing. Control stays hub-only.
    if (!registration && request.method !== 'GET' && !hubAllowed(request, this.config.harmonyHubAddresses)) return json(response, [errorResponse(1, '/', 'Address is not an allowed Harmony hub.')], 403);
    let input;
    if (['PUT', 'POST'].includes(request.method)) { try { input = await body(request); } catch { if (registration) this.pairingDiagnostic.result = 'invalid-json'; return json(response, [errorResponse(2, path, 'Invalid JSON request.')]); } }
    if (request.method === 'POST' && path === '/api') {
      if (this.now() >= this.pairUntil) {
        this.pairingDiagnostic.result = 'window-closed';
        return json(response, [errorResponse(101, '/', 'link button not pressed')]);
      }
      this.pairingDiagnostic.result = 'invalid-parameters';
      if (typeof input.devicetype !== 'string' || !input.devicetype.length) return json(response, [errorResponse(7, '/devicetype', 'Device type is required.')]);
      if (input.username !== undefined && (typeof input.username !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.username) || ['__proto__','constructor','prototype'].includes(input.username))) return json(response,[errorResponse(7,'/username','Invalid username.')]);
      this.pairingDiagnostic.result = 'validating';
      const name = input.devicetype.slice(0,80);
      const recent = Object.entries(this.state.data.users).find(([, user]) => user.name === name && user.address === peer && this.now() - Date.parse(user.created + 'Z') >= 0 && this.now() - Date.parse(user.created + 'Z') < 30000);
      const username = input.username || recent?.[0] || randomBytes(20).toString('hex');
      if (Object.keys(this.state.data.users).length >= 32 && !Object.hasOwn(this.state.data.users,username)) { this.pairingDiagnostic.result = 'client-limit'; return json(response, [errorResponse(301, '/', 'Too many linked users.')]); }
      const previous = this.state.data.users[username];
      this.state.data.users[username] = previous || { name, address: peer, created: new Date(this.now()).toISOString().slice(0,19) };
      try { await this.state.save(); } catch { if (previous) this.state.data.users[username] = previous; else delete this.state.data.users[username]; this.pairingDiagnostic.result = 'save-failed'; return json(response, [errorResponse(901, '/', 'Could not save pairing.')]); }
      this.pairingDiagnostic.result = 'paired';
      this.report({ source: 'hue', name: 'Hue pairing', ok: true, message: `Registered client at ${peer}.` });
      return json(response, [{ success: { username } }]);
    }
    const parts = path.split('/').filter(Boolean), [, user, resource, id, sub] = parts;
    if (parts[0] !== 'api' || !user || !Object.hasOwn(this.state.data.users, user)) return json(response, [errorResponse(1, path, 'unauthorized user')]);
    if (request.method === 'GET') {
      if (!resource) return json(response, { config: this.bridgeConfig(true), lights: this.lights(), groups: this.groups(), scenes: {}, schedules: {}, sensors: {}, rules: {}, resourcelinks: {} });
      if (resource === 'config' && !id) return json(response, this.bridgeConfig(true));
      if (resource === 'lights' && id === 'new') return json(response, { lastscan: 'none' });
      if (resource === 'lights') { const light = this.light(id); return json(response, id ? light || [errorResponse(3, path, 'Light not found.')] : this.lights()); }
      if (resource === 'groups') return json(response, id ? this.group(id) || [errorResponse(3, path, 'Group not found.')] : this.groups());
      if (['scenes', 'schedules', 'sensors', 'rules', 'resourcelinks'].includes(resource) && !id) return json(response, {});
    }
    if (request.method === 'POST' && resource === 'lights' && !id) return json(response, [success('/lights', 'Searching for new devices')]);
    if (request.method === 'PUT' && resource === 'lights' && id && sub === 'state') return json(response, await this.changeLight(id, input));
    if (request.method === 'PUT' && resource === 'groups' && sub === 'action') {
      const group = this.group(id);
      if (!group) return json(response, [errorResponse(3, path, 'Group not found.')]);
      const results = await Promise.all(group.lights.map(light => this.changeLight(light, input)));
      const failures = results.flat().filter(result => result.error);
      return json(response, failures.length ? failures : Object.entries(input).map(([key,value]) => success(`/groups/${id}/action/${key}`, value)));
    }
    if (resource === 'groups' && (request.method === 'POST' && !id || request.method === 'PUT' && id && id !== '0' && !sub)) {
      if (id && !Object.hasOwn(this.state.data.groups,id)) return json(response, [errorResponse(3,path,'Group not found.')]);
      const group = { ...(this.state.data.groups[id] || {}), ...input };
      if (typeof group.name !== 'string' || !group.name.trim() || group.name.length > 64 || !Array.isArray(group.lights) || !group.lights.every(light => this.devices.has(light))) return json(response,[errorResponse(7,path,'Provide a name and valid light IDs.')]);
      if (!id && Object.keys(this.state.data.groups).length >= 100) return json(response,[errorResponse(301,path,'Too many groups.')]);
      const groupId = id || String(this.state.data.nextGroupId++);
      this.state.data.groups[groupId] = { name: group.name, lights: [...new Set(group.lights)] }; await this.state.save();
      return json(response,id ? [success(`/groups/${id}`,this.group(id))] : [{ success: { id: groupId } }]);
    }
    if (resource === 'groups' && id && id !== '0' && request.method === 'DELETE') { delete this.state.data.groups[id]; await this.state.save(); return json(response,[success(`/groups/${id}`,'deleted')]); }
    return json(response, [errorResponse(4, path, 'Method not available.')]);
  }
  async start() { this.server = makeServer(this.handle.bind(this)); this.port = await listen(this.server, this.config.huePort); return this.port; }
  close() { return closeServer(this.server); }
}
