import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { validateConfig, bridgeCredentials, safeMessage } from '../lib/config.js';
import { StateStore } from '../lib/state.js';
import { fixture, temporary, ON, BRI, CUSTOM, SERVICE } from './helpers.js';
import { longUuid } from '../lib/hap.js';

test('configuration requires explicit hub addresses and rejects conflicting ports/commands', () => {
  const input = { advertiseAddress: '192.168.1.2', harmonyHubAddresses: ['192.168.1.3'] };
  assert.equal(validateConfig(input).huePort,18080);
  assert.throws(() => validateConfig({ ...input, harmonyHubAddresses: [] }),/hub address/);
  assert.throws(() => validateConfig({ ...input, huePort: 8060 }),/different ports/);
  const action = { serviceId: 'service', characteristic: ON, operation: 'set', value: false };
  assert.throws(() => validateConfig({ ...input, rokuButtons: [{ id: 'one',name: 'One',key: 'Play',action },{ id: 'two',name: 'Two',key: 'Play',action }] }),/once/);
  assert.throws(() => validateConfig({ ...input, rokuButtons: [{ id: 'one',name: 'One',key: 'Play',action: { ...action, value: null } }] }),/value/);
});
test('child bridge PINs are loaded locally and redacted from errors', () => {
  const credentials = bridgeCredentials({ bridge: { pin: '031-45-154' }, platforms: [{ _bridge: { username: 'aa:bb',pin: '031-45-155' } }] });
  assert.equal(credentials.pins['AA:BB'],'031-45-155');
  assert.equal(safeMessage(new Error('Use 031-45-155')),'Use [PIN redacted]');
});
test('Hue identities, users and numeric light IDs survive restart and IDs are never reused', async t => {
  const directory = await temporary(t); const one = await new StateStore(directory).load();
  await one.assignLightIds([{ id: 'first' }]); const uuid = one.uuid;
  one.data.users.key = { name: 'Harmony', created: 'date' }; await one.save();
  const two = await new StateStore(directory).load(); await two.assignLightIds([{ id: 'second' }]);
  assert.equal(two.uuid,uuid); assert.equal(two.data.lightIds.first,'1'); assert.equal(two.data.lightIds.second,'2'); assert.ok(two.data.users.key);
  assert.equal((await stat(join(directory,'state.json'))).mode & 0o777,0o600);
  assert.ok(JSON.parse(await readFile(join(directory,'state.json'),'utf8')));
});
test('discovery includes custom controls, respects child PIN and excludes timed writes', async t => {
  const f = await fixture(t); const services = f.access.list(); assert.equal(services.length,1);
  assert.equal(services[0].name,'Reading lamp'); assert.ok(services[0].characteristics.find(c => c.id === CUSTOM).canWrite);
  assert.equal(services[0].characteristics.find(c => c.id === longUuid('F00')).canWrite,false);
  assert.ok(f.seenPins.every(pin => pin === '031-45-155'));
  assert.ok(!JSON.stringify(services).includes('031-45'));
});
test('toggle commands are serialized and read fresh state, including false values', async t => {
  const f = await fixture(t); const action = { serviceId: SERVICE, characteristic: ON, operation: 'toggle' };
  await Promise.all([f.actions.execute(action),f.actions.execute(action)]);
  assert.deepEqual(f.writes.map(w => w.value),[true,false]); assert.equal(f.values[11],false);
});
test('numeric changes clamp, custom controls work, invalid writes never reach the accessory', async t => {
  const f = await fixture(t);
  await f.actions.execute({ serviceId: SERVICE,characteristic: BRI,operation: 'increase',value: 80 }); assert.equal(f.values[12],100);
  await f.actions.execute({ serviceId: SERVICE,characteristic: CUSTOM,operation: 'set',value: true }); assert.equal(f.values[13],true);
  const before = f.writes.length;
  await assert.rejects(f.actions.execute({ serviceId: SERVICE,characteristic: BRI,operation: 'set',value: 150 }),/range/);
  await assert.rejects(f.actions.execute({ serviceId: SERVICE,characteristic: longUuid('F00'),operation: 'set',value: true }),/read-only/);
  assert.equal(f.writes.length,before);
});
test('HAP partial failure is reported and does not poison subsequent commands', async t => {
  const f = await fixture(t); const action = { serviceId: SERVICE,characteristic: ON,operation: 'set',value: true };
  f.rejectWrites(true); await assert.rejects(f.actions.execute(action),/70402/); assert.equal(f.values[11],false); assert.equal(f.events.at(-1).ok,false);
  f.rejectWrites(false); await f.actions.execute(action); assert.equal(f.values[11],true);
});
test('unavailable mappings never fall back to another accessory with the same name', async t => {
  const f = await fixture(t);
  await assert.rejects(f.actions.execute({ serviceId: 'missing',characteristic: ON,operation: 'set',value: true }),/not found/);
  assert.equal(f.writes.length,0);
});
