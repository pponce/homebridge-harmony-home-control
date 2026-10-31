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
  try { ({ HapClient } = await import('@homebridge/hap-client')); await import('@homebridge/plugin-ui-utils'); await import('hb-hue-tools/HueClient'); await import('hb-hue-tools/HueDiscovery'); }
  catch (error) { if (process.env.CI) throw error; t.skip('Runtime dependencies cannot be downloaded in this environment; CI requires this check.'); return; }
  const client = new HapClient({ pin: '031-45-154',config: { autoStartDiscovery: false } }); client.destroy();
  const { HueClient } = await import('hb-hue-tools/HueClient');
  const config = { bridgeid: '001788FFFE123456', modelid: 'BSB002', swversion: '1970000000', name: 'Test Hue bridge' };
  assert.equal(HueClient.isHueBridge(config), true); assert.ok(HueClient.rootCertificates.length >= 1);
  const hueClient = new HueClient({ host: '192.0.2.10', config, timeout: 5, waitTimeResend: 0 });
  hueClient.on('error', () => {}); hueClient.destroy?.();
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
