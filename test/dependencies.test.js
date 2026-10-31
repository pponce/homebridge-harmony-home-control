import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import register from '../index.js';
import { temporary } from './helpers.js';

test('Homebridge entry point registers one platform and creates no HomeKit accessories', () => {
  const calls = []; register({ registerPlatform: (...args) => calls.push(args) });
  assert.equal(calls.length,1); assert.equal(calls[0][0],'homebridge-harmony-home-control'); assert.equal(calls[0][1],'HarmonyHomeControl');
});
test('installed HAP client and custom UI IPC load successfully', async t => {
  let HapClient;
  try { ({ HapClient } = await import('@homebridge/hap-client')); await import('@homebridge/plugin-ui-utils'); }
  catch (error) { if (process.env.CI) throw error; t.skip('Runtime dependencies cannot be downloaded in this environment; CI requires this check.'); return; }
  const client = new HapClient({ pin: '031-45-154',config: { autoStartDiscovery: false } }); client.destroy();
  const directory = await temporary(t), configPath = join(directory,'config.json'); await writeFile(configPath,JSON.stringify({ bridge: { pin: '031-45-154' },platforms: [] }));
  const child = fork(new URL('../homebridge-ui/server.js',import.meta.url),[],{ env: { ...process.env,HOMEBRIDGE_STORAGE_PATH: directory,HOMEBRIDGE_CONFIG_PATH: configPath },stdio: ['ignore','ignore','pipe','ipc'] });
  t.after(() => child.kill());
  const response = await new Promise((resolve,reject) => {
    const timeout = setTimeout(() => reject(new Error('UI IPC timed out')),5000);
    child.on('message',message => { if (message.action === 'ready') child.send({ action: 'request',requestId: 'bootstrap',path: '/bootstrap',body: {} }); if (message.action === 'response') { clearTimeout(timeout); resolve(message.payload); } });
    child.on('error',reject); child.on('exit',code => { if (code) reject(new Error(`UI exited ${code}`)); });
  });
  assert.equal(response.success,true); assert.ok(Array.isArray(response.data.addresses)); assert.ok(response.data.keys.includes('Play'));
});
