import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HueCredentialStore, HueTransport, RealHueAccess, HUE_ON, HUE_BRIGHTNESS } from '../lib/real-hue.js';
import { CombinedAccess } from '../lib/access.js';
import { Actions } from '../lib/actions.js';
import { HueServer } from '../lib/hue.js';
import { validateConfig, validateHueHost } from '../lib/config.js';
import { fixture, temporary, SERVICE, ON, request } from './helpers.js';

const FIRST = '001788FFFE123456', SECOND = 'ECB5FAFFFE123456';
const bridges = [{ id: FIRST, host: '192.0.2.10', name: 'Downstairs' }, { id: SECOND, host: '192.0.2.11', name: 'Upstairs' }];

function fakeSdk() {
  const writes = [], clients = [], discoveries = [];
  const devices = new Map(bridges.map((bridge, index) => [bridge.host, {
    config: { bridgeid: bridge.id, name: bridge.name, modelid: index ? 'BSB003' : 'BSB002', swversion: '1970000000', apiversion: '1.78.0' },
    key: `secret-key-for-${bridge.id}`, pressed: false, offline: false, reject: false, pairings: 0,
    lights: {
      '1': { name: 'Reading lamp', type: 'Dimmable light', uniqueid: `${bridge.id}-01`, state: { on: false, bri: 127, reachable: true } },
      '2': { name: 'Desk plug', type: 'On/Off plug-in unit', uniqueid: `${bridge.id}-02`, state: { on: false, reachable: true } },
    },
    groups: { '3': { name: 'Living room', lights: ['1','2'], action: { on: false, bri: 127 }, state: { any_on: false, all_on: false } } },
  }]));
  const fail = (type, message) => Object.assign(new Error(message), { type });
  class HueDiscovery extends EventEmitter {
    async config(host) { const device = devices.get(host.replace(/:443$/, '')); if (!device || device.offline) throw new Error('Offline'); return structuredClone(device.config); }
    async discover(options) { discoveries.push(options); return Object.fromEntries([...devices].map(([host, d]) => [host, d.config])); }
  }
  class HueClient extends EventEmitter {
    static isHueBridge(config) { return /^(001788|ECB5FA)/.test(config.bridgeid); }
    constructor(options) { super(); this.options = options; this.device = devices.get(options.host); this.key = options.apiKey; clients.push(this); }
    async getApiKey() { if (!this.device.pressed) throw fail(101, 'Link button not pressed'); this.device.pairings++; this.key = this.device.key; return this.key; }
    check() {
      if (this.device.offline) throw new Error(`Secret-containing request failed /api/${this.key}/lights`);
      if (this.key !== this.device.key) throw fail(1, `Unauthorized /api/${this.key}`);
    }
    async get(path) {
      this.check(); let result = this.device;
      for (const part of path.split('/').filter(Boolean)) result = result?.[part];
      if (!result) throw fail(3, `Not found /api/${this.key}${path}`);
      return structuredClone(result);
    }
    async put(path, body) {
      this.check(); writes.push({ host: this.options.host, path, body });
      if (this.device.reject) return { errors: [fail(201, `Unavailable /api/${this.key}`)] };
      const [, kind, id, sub] = path.split('/'); const resource = this.device[kind][id];
      Object.assign(resource[sub], body);
      if (kind === 'groups') for (const lightId of resource.lights) Object.assign(this.device.lights[lightId].state, body);
      for (const group of Object.values(this.device.groups)) {
        group.state.any_on = group.lights.some(lightId => this.device.lights[lightId].state.on);
        group.state.all_on = group.lights.every(lightId => this.device.lights[lightId].state.on);
      }
      return { errors: [], success: body };
    }
    destroy() {}
  }
  return { devices, writes, clients, discoveries, transport: new HueTransport({ loadSdk: async () => ({ HueClient, HueDiscovery }) }) };
}

async function realFixture(t) {
  const f = await fixture(t), sdk = fakeSdk(), store = new HueCredentialStore(f.directory);
  for (const b of bridges) await store.save(b.id, sdk.devices.get(b.host).key);
  const hue = new RealHueAccess({ bridges, store, transport: sdk.transport }); await hue.start(); t.after(() => hue.close());
  const access = new CombinedAccess({ hap: f.access, hue });
  return { ...f, ...sdk, store, hue, combined: access, combinedActions: new Actions(access, f.report) };
}

test('real bridge configuration is optional, validates identities, and preserves old mappings', () => {
  const config = { advertiseAddress: '192.0.2.1', harmonyHubAddresses: ['192.0.2.2'] };
  assert.deepEqual(validateConfig(config).hueBridges, []);
  assert.deepEqual(validateConfig({ ...config, hueBridges: bridges }).hueBridges, bridges);
  assert.throws(() => validateConfig({ ...config, hueBridges: [bridges[0], bridges[0]] }), /own valid bridge ID/);
  for (const host of ['http://192.0.2.10','127.0.0.1','169.254.169.254','224.0.0.1','192.0.2.10:80']) assert.throws(() => validateHueHost(host), /IPv4/);
  const mapping = { id: 'hue-light', name: 'Light', serviceId: `hue/${FIRST}/lights/one`, power: { characteristic: HUE_ON, onValue: true, offValue: false } };
  assert.throws(() => validateConfig({ ...config, hueDevices: [mapping] }), /not connected/);
  assert.equal(validateConfig({ ...config, hueDevices: [mapping], hueBridges: bridges }).hueDevices[0].id, mapping.id);
});

test('physical-button authorization stores private keys, survives restart, and never returns them', async t => {
  const directory = await temporary(t), store = new HueCredentialStore(directory), sdk = fakeSdk();
  await assert.rejects(sdk.transport.pair(bridges[0].host, store), /Press the button/);
  assert.deepEqual(await store.load(), {});
  sdk.devices.get(bridges[0].host).pressed = true;
  const result = await sdk.transport.pair(bridges[0].host, store);
  assert.equal(result.id, FIRST); assert.ok(!JSON.stringify(result).includes('secret-key'));
  assert.equal((await stat(store.file)).mode & 0o777, 0o600);
  const again = new HueCredentialStore(directory); assert.equal((await again.load())[FIRST], sdk.devices.get(bridges[0].host).key);
  await sdk.transport.pair(bridges[0].host, again, FIRST); assert.equal(sdk.devices.get(bridges[0].host).pairings, 1);
  assert.ok(sdk.clients.every(client => client.options.waitTimeResend === 0 && client.options.forceHttp === undefined));
  await assert.rejects(sdk.transport.pair(bridges[1].host, store, FIRST), /different Hue bridge/);
  assert.equal(sdk.devices.get(bridges[1].host).pairings, 0);
});

test('local discovery excludes emulators; corrupted authorization is never overwritten', async t => {
  const directory = await temporary(t), store = new HueCredentialStore(directory), sdk = fakeSdk();
  assert.equal((await sdk.transport.discover()).length, 2); assert.equal(sdk.discoveries[0].stealth, true);
  sdk.devices.get(bridges[0].host).config.swversion = '9999999999';
  assert.equal((await sdk.transport.discover()).length, 1);
  await assert.rejects(sdk.transport.pair(bridges[0].host, store), /physical square/);
  await writeFile(store.file, '{invalid');
  await assert.rejects(store.save(FIRST, 'some-valid-test-key'), /Cannot read/);
  assert.equal(await readFile(store.file, 'utf8'), '{invalid');
});

test('one combined list contains HAP, two Hue bridges, plugs, and groups without exposing keys', async t => {
  const f = await realFixture(t), list = f.combined.list();
  assert.equal(list.length, 7); assert.equal(list.filter(s => s.name === 'Reading lamp').length, 3);
  assert.equal(list.filter(s => s.type === 'Outlet').length, 2); assert.equal(list.filter(s => s.type === 'HueGroup').length, 2);
  assert.ok(!JSON.stringify(list).includes('secret-key')); assert.ok(!JSON.stringify(f.hue.status).includes('secret-key'));
  await f.combinedActions.execute({ serviceId: SERVICE, characteristic: ON, operation: 'set', value: true });
  assert.equal(f.values[11], true); assert.equal(f.writes.length, 0);
  const target = list.find(s => s.hueBridge === FIRST && s.resourceId === '1');
  await f.combinedActions.execute({ serviceId: target.id, characteristic: HUE_ON, operation: 'set', value: true });
  assert.deepEqual(f.writes.at(-1), { host: bridges[0].host, path: '/lights/1/state', body: { on: true } });
  assert.equal(f.devices.get(bridges[1].host).lights['1'].state.on, false);
});

test('Harmony Hue endpoint routes a mixed list and groups, and keeps existing virtual IDs', async t => {
  const f = await realFixture(t), list = f.hue.list();
  const light = list.find(s => s.hueBridge === FIRST && s.kind === 'lights' && s.resourceId === '1');
  const group = list.find(s => s.hueBridge === SECOND && s.kind === 'groups');
  const config = { ...f.config, hueBridges: bridges, hueDevices: [...f.config.hueDevices, ...[light,group].map((s,i) => ({ id: `real-${i}`, name: s.name, serviceId: s.id,
    power: { characteristic: HUE_ON, onValue: true, offValue: false }, brightness: { characteristic: HUE_BRIGHTNESS, min: 0, max: 100 } }))] };
  await f.state.assignLightIds(config.hueDevices); assert.equal(f.state.data.lightIds.lamp, '1');
  const hue = new HueServer({ config, state: f.state, access: f.combined, actions: f.combinedActions }); const port = await hue.start(); t.after(() => hue.close());
  hue.openPairing(); const key = (await request(port,'/api','POST',{ devicetype: 'test' })).value[0].success.username;
  assert.equal(Object.keys((await request(port, `/api/${key}/lights`)).value).length, 3);
  assert.equal((await request(port, `/api/${key}/lights/1/state`, 'PUT', { on: true })).value[0].success['/lights/1/state/on'], true); assert.equal(f.values[11], true);
  await request(port, `/api/${key}/lights/2/state`, 'PUT', { bri: 254, on: false });
  assert.equal(f.devices.get(bridges[0].host).lights['1'].state.bri, 254); assert.equal(f.devices.get(bridges[0].host).lights['1'].state.on, false);
  await request(port, `/api/${key}/lights/3/state`, 'PUT', { on: true });
  assert.equal(f.devices.get(bridges[1].host).lights['2'].state.on, true);
  assert.equal(f.writes.at(-1).path, '/groups/3/action');
});

test('toggles read Hue changes made elsewhere and serialized presses do not use cached power', async t => {
  const f = await realFixture(t), target = f.hue.list().find(s => s.hueBridge === FIRST && s.resourceId === '1');
  f.devices.get(bridges[0].host).lights['1'].state.on = true;
  const action = { serviceId: target.id, characteristic: HUE_ON, operation: 'toggle' };
  await Promise.all([f.combinedActions.execute(action), f.combinedActions.execute(action)]);
  assert.deepEqual(f.writes.map(w => w.body.on), [false,true]);
  await f.combinedActions.execute({ serviceId: target.id, characteristic: HUE_BRIGHTNESS, operation: 'increase', value: 90 });
  assert.equal(f.devices.get(bridges[0].host).lights['1'].state.bri, 254);
});

test('a failed Hue bridge cannot disable HAP or the other Hue bridge; authorization errors hide keys', async t => {
  const f = await realFixture(t); f.devices.get(bridges[0].host).offline = true;
  await f.combined.refresh();
  assert.equal(f.hue.status.find(s => s.id === FIRST).connected, false); assert.equal(f.hue.status.find(s => s.id === SECOND).connected, true);
  assert.ok(!JSON.stringify(f.hue.status).includes('secret-key'));
  await f.combinedActions.execute({ serviceId: SERVICE, characteristic: ON, operation: 'set', value: true }); assert.equal(f.values[11], true);
  const other = f.hue.list().find(s => s.hueBridge === SECOND && s.resourceId === '2');
  await f.combinedActions.execute({ serviceId: other.id, characteristic: HUE_ON, operation: 'set', value: true });
  f.devices.get(bridges[0].host).offline = false; f.devices.get(bridges[0].host).key = 'revoked-new-key'; await f.hue.refresh();
  assert.match(f.hue.lastError, /authorization was refused/); assert.ok(!JSON.stringify(f.hue.list()).includes('secret-key'));
});

test('a reused numeric light ID cannot redirect an existing mapping to a replacement light', async t => {
  const f = await realFixture(t), target = f.hue.list().find(s => s.hueBridge === FIRST && s.resourceId === '1');
  f.devices.get(bridges[0].host).lights['1'].uniqueid = 'replacement-light';
  await assert.rejects(f.combinedActions.execute({ serviceId: target.id, characteristic: HUE_ON, operation: 'set', value: true }), /replaced/);
  assert.equal(f.writes.length, 0); await f.hue.refresh();
  assert.throws(() => f.hue.resolve(target.id, HUE_ON), /not found/);
});

test('Hue partial failures are reported once and rejected commands are not replayed', async t => {
  const f = await realFixture(t), target = f.hue.list().find(s => s.hueBridge === FIRST && s.resourceId === '1');
  f.devices.get(bridges[0].host).reject = true;
  await assert.rejects(f.combinedActions.execute({ serviceId: target.id, characteristic: HUE_ON, operation: 'set', value: true }), /could not apply/);
  assert.equal(f.writes.length, 1); assert.equal(f.hue.resolve(target.id, HUE_ON).characteristic.value, false);
  assert.equal(f.events.at(-1).ok, false); assert.ok(!JSON.stringify(f.events).includes('secret-key'));
});
