import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { makeServer, listen, closeServer } from '../lib/http.js';
import { HarmonyPlatform } from '../lib/platform.js';

for (const asynchronous of [false, true]) test(`HTTP ${asynchronous ? 'rejection' : 'throw'} is contained and redacted`, async () => {
  const logs = [];
  const fail = () => { throw new Error('secret-password'); };
  const server = makeServer(asynchronous ? async () => fail() : fail, {error: m => logs.push(m)});
  const port = await listen(server, 0, '127.0.0.1');
  try {
    const response = await fetch(`http://127.0.0.1:${port}/secret-token`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {error:'Request failed.'});
    server.emit('error', new Error('secret-password'));
    assert.equal(logs.length, 2);
    assert.ok(logs.every(m => !m.includes('secret')));
  } finally { await closeServer(server); }
});

test('shutdown catches rejection and cleanup continues after component failures', async () => {
  const api = new EventEmitter(); api.user = {storagePath: () => '/nonexistent-hhc-test'};
  const logs = [], closed = [];
  const platform = new HarmonyPlatform({error: m => logs.push(m),warn: m => logs.push(m)}, {}, api);
  platform.access = {close() {closed.push('access'); throw new Error('secret');}};
  platform.hue = {async close() {closed.push('hue'); throw new Error('secret');}};
  platform.roku = {close() {closed.push('roku');}};
  api.emit('shutdown'); await platform.stopping;
  assert.deepEqual(closed, ['access','hue','roku']);
  assert.equal(logs.length, 2);
  platform.close = async () => {throw new Error('secret');};
  api.emit('shutdown'); await platform.stopping;
  assert.equal(logs.at(-1), 'Plugin shutdown failed.');
  assert.ok(logs.every(m => !m.includes('secret')));
});
