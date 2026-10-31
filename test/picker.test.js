import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PICKER_CATEGORIES, pickerService } from '../lib/picker.js';
import { HapAccess, longUuid } from '../lib/hap.js';
import { CombinedAccess } from '../lib/access.js';
import { temporary, ON } from './helpers.js';

const control = { id: ON, type: 'On', format: 'bool', canWrite: true, canRead: true };
const service = (extra = {}) => ({ id: 'bridge/2/10', name: 'A control', type: 'Switch', characteristics: [control], ...extra });

test('picker classifies HAP UUIDs, both fan versions, direct Hue devices, and custom services', () => {
  for (const [type, category] of [['43','lights'], ['45','locks'], ['49','switches'], ['47','outlets'], ['40','fans'], ['B7','fans'], ['8C','coverings'], ['41','doors'], ['4A','climate'], ['D8','media'], ['D0','water'], ['7E','security'], ['BA','internal'], ['D9','internal'], ['110','internal']]) {
    assert.equal(pickerService(service({ type: longUuid(type) })).category, category);
    assert.equal(pickerService(service({ type: 'Unknown name', uuid: longUuid(type) })).category, category);
  }
  for (const [type, category] of [['Lightbulb','lights'], ['Outlet','outlets'], ['HueGroup','groups'], ['Fanv2','fans'], ['CustomAction','other']]) assert.equal(pickerService(service({ source: 'hue', type })).category, category);
  assert.equal(PICKER_CATEGORIES.find(c => c.id === 'internal').defaultSelected, false);
  assert.ok(PICKER_CATEGORIES.filter(c => c.id !== 'internal').every(c => c.defaultSelected));
});

test('Harmony exclusion uses identity and platform, never display names or Logitech alone', () => {
  for (const extra of [{ manufacturer: 'Harmony' }, { manufacturer: ' harmony ' }, { platforms: ['HarmonyHubWebSocket'] }, { platforms: ['homebridge-harmony.HarmonyHubWebSocket'] }]) assert.equal(pickerService(service(extra)).harmony, true);
  for (const extra of [{ name: 'Harmony lamp' }, { bridgeName: 'Harmony bridge' }, { manufacturer: 'Logitech' }, { platforms: ['HarmonyHomeControl'] }, { manufacturer: 'Harmony', source: 'hue' }]) assert.equal(pickerService(service(extra)).harmony, false);
});

test('metadata is excluded from new actions while writable custom actions and old controls survive', () => {
  const input = service({ characteristics: [control,
    { id: longUuid('E3'), type: 'Unknown', format: 'string', canWrite: true },
    { id: 'custom-name', type: 'Configured Name', format: 'string', canWrite: true },
    { id: longUuid('14'), type: 'Identify', format: 'bool', canWrite: true },
    { id: 'custom-command', type: 'Custom command', format: 'string', canWrite: true },
    { id: 'sensor', type: 'Temperature', format: 'float', canWrite: false },
  ] });
  const result = pickerService(input);
  assert.deepEqual(result.characteristics.map(c => c.canMap), [true,false,false,false,true,false]);
  assert.equal(result.selectable, true);
  assert.equal(result.characteristics[1].canWrite, true, 'Filtering must not change the underlying write permission');
  assert.equal(input.characteristics[0].canMap, undefined, 'Picker hints must not mutate runtime services');
  assert.equal(pickerService(service({ characteristics: [input.characteristics[1]] })).selectable, false);
  assert.equal(pickerService(service({ characteristics: [input.characteristics.at(-1)] })).selectable, false);
});

test('HAP discovery identifies Harmony per accessory on mixed bridges and on dedicated child bridges', async t => {
  const directory = await temporary(t), configPath = join(directory,'config.json');
  const main = 'AA:BB:CC:DD:EE:01', child = 'AA:BB:CC:DD:EE:02';
  await writeFile(configPath, JSON.stringify({ bridge: { username: main, name: 'Main', pin: '031-45-154' }, platforms: [
    { platform: 'HarmonyHubWebSocket', name: 'Main Harmony' },
    { platform: 'homebridge-harmony.HarmonyHubWebSocket', name: 'Child Harmony', _bridge: { username: child } },
  ] }));
  const accessory = (aid, manufacturer) => ({ aid, services: [
    { iid: 1, type: '3E', characteristics: [{ type: '23', value: 'Harmony display name' }, { type: '20', value: manufacturer }] },
    { iid: 10, type: '49', characteristics: [{ iid: 11, type: '25', format: 'bool', perms: ['pr','pw'], value: false }] },
    { iid: 20, type: '89', characteristics: [{ iid: 21, type: '73', format: 'uint8', perms: ['pr'], value: 0 }] },
  ] });
  const writes = [];
  const client = new EventEmitter(); client.startDiscovery = client.refreshInstances = client.destroy = () => {};
  const hap = new HapAccess({ configPath, clientFactory: () => client, types: {}, request: async (url, options) => {
    if (options.method === 'PUT') { writes.push(JSON.parse(options.body)); return { status: 204, ok: true }; }
    return { status: 200, ok: true, json: async () => ({ accessories: url.includes(':1001/') ? [accessory(2,'Harmony'),accessory(3,'Logitech'),accessory(4,'Other')] : [accessory(2,'Unknown')] }) };
  } });
  await hap.start(); t.after(() => hap.close());
  hap.instances.set(main,{ username: main, ipAddress: '127.0.0.1', port: 1001 });
  hap.instances.set(child,{ username: child, ipAddress: '127.0.0.1', port: 1002 });
  await hap.refresh();
  const combined = new CombinedAccess({ hap, hue: { list: () => [] } });
  const list = combined.list(); assert.equal(list.length,4, 'Read-only button events never become action targets');
  assert.equal(list.find(s => s.id === `${main}/2/10`).harmony,true);
  assert.equal(list.find(s => s.id === `${main}/3/10`).harmony,false);
  assert.equal(list.find(s => s.id === `${main}/4/10`).harmony,false);
  assert.equal(list.find(s => s.id === `${child}/2/10`).harmony,true);
  await combined.write(`${main}/2/10`,ON,true);
  assert.equal(writes.length,1,'Existing Harmony mappings still execute even though new selections default to hidden');
});
