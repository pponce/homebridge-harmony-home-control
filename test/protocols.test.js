import test from 'node:test';
import assert from 'node:assert/strict';
import { HueServer } from '../lib/hue.js';
import { RokuServer } from '../lib/roku.js';
import { fixture, request } from './helpers.js';
import { matchSearch, searchResponse, hueAdvertisements, rokuAdvertisements, Discovery } from '../lib/ssdp.js';
import { createSocket } from 'node:dgram';

async function hueFixture(t) {
  const f = await fixture(t); let now = Date.now(); const hue = new HueServer({ ...f, now: () => now }); await hue.start(); t.after(() => hue.close());
  return { ...f, hue, expire: () => { now += 120001; }, async pair() { hue.openPairing(); return (await request(hue.port,'/api','POST',{ devicetype: 'Harmony' })).value[0].success.username; } };
}
test('Hue link window, authorization and hub-address filtering protect commands', async t => {
  const f = await hueFixture(t);
  assert.equal((await request(f.hue.port,'/api','POST',{ devicetype: 'Harmony' })).value[0].error.type,101);
  const user = await f.pair(); assert.equal((await request(f.hue.port,`/api/${user}/lights`)).value['1'].name,'Reading lamp');
  assert.equal((await request(f.hue.port,'/api/','POST',{ devicetype: 'Legacy Harmony',username: 'harmony-client' })).value[0].success.username,'harmony-client');
  assert.equal((await request(f.hue.port,'/api/','POST',{ devicetype: 'Invalid',username: '__proto__' })).value[0].error.type,7);
  assert.equal((await request(f.hue.port,'/api/not-paired/lights')).value[0].error.type,1);
  f.expire(); assert.equal((await request(f.hue.port,'/api','POST',{ devicetype: 'Other' })).value[0].error.type,101);
  f.config.harmonyHubAddresses = ['192.168.1.40'];
  assert.equal((await request(f.hue.port,`/api/${user}/lights/1/state`,'PUT',{ on: true },{ 'X-Forwarded-For': '192.168.1.40' })).status,403);
  assert.equal(f.writes.length,0); assert.equal((await request(f.hue.port,'/description.xml')).status,200);
});
test('Hue discovery descriptors and full resource responses are coherent', async t => {
  const f = await hueFixture(t); const user = await f.pair();
  assert.match((await request(f.hue.port,'/description.xml')).text,new RegExp(f.state.uuid));
  assert.equal((await request(f.hue.port,`/api/${user}`)).value.config.bridgeid,f.state.bridgeId);
  assert.equal((await request(f.hue.port,`/api/${user}/lights/new`)).value.lastscan,'none');
  assert.ok((await request(f.hue.port,`/api/${user}/lights`,'POST',{})).value[0].success);
  assert.deepEqual((await request(f.hue.port,`/api/${user}/scenes`)).value,{});
});
test('Hue brightness endpoints translate correctly, and off plus brightness ends off', async t => {
  const f = await hueFixture(t); const user = await f.pair(); const path = `/api/${user}/lights/1/state`;
  await request(f.hue.port,path,'PUT',{ on: true,bri: 254 }); assert.equal(f.values[12],100); assert.equal(f.values[11],true);
  await request(f.hue.port,path,'PUT',{ bri: 0,on: false }); assert.equal(f.values[12],0); assert.equal(f.values[11],false);
  assert.deepEqual(f.writes.slice(-2).map(w => w.iid),[12,11]);
  await request(f.hue.port,path,'PUT',{ bri_inc: 127 }); assert.equal(f.values[12],50);
  const before = f.writes.length; assert.equal((await request(f.hue.port,path,'PUT',{ on: true,bri: -1 })).value[0].error.type,7); assert.equal(f.writes.length,before);
  f.rejectWrites(true); assert.equal((await request(f.hue.port,path,'PUT',{ on: true })).value[0].error.type,901);
});
test('Hue group commands forward failures and preserve group IDs', async t => {
  const f = await hueFixture(t); const user = await f.pair(); const base = `/api/${user}/groups`;
  const group = (await request(f.hue.port,base,'POST',{ name: 'Room',lights: ['1'] })).value[0].success.id;
  assert.equal((await request(f.hue.port,`${base}/${group}`)).value.name,'Room');
  await request(f.hue.port,`${base}/${group}/action`,'PUT',{ on: true }); assert.equal(f.values[11],true);
  f.rejectWrites(true); assert.equal((await request(f.hue.port,`${base}/0/action`,'PUT',{ on: false })).value[0].error.type,901);
});
test('Roku descriptors, keypress and held-key handling do not double-trigger actions', async t => {
  const f = await fixture(t); const roku = new RokuServer(f); await roku.start(); t.after(() => roku.close());
  assert.match((await request(roku.port,'/query/device-info')).text,new RegExp(f.state.rokuSerial));
  await request(roku.port,'/keydown/Play','POST'); await request(roku.port,'/keydown/Play','POST'); await request(roku.port,'/keypress/Play','POST'); await request(roku.port,'/keyup/Play','POST');
  assert.equal(f.writes.length,1); assert.equal(f.values[11],true);
  await new Promise(resolve => setTimeout(resolve,160)); await request(roku.port,'/keypress/Play','POST'); assert.equal(f.values[11],false);
  const before = f.writes.length; await request(roku.port,'/keypress/PowerOff','POST'); await request(roku.port,'/keypress/Home','POST'); assert.equal(f.writes.length,before);
  assert.match(f.events.at(-1).name,/no action assigned/);
  f.config.harmonyHubAddresses = ['10.0.0.1']; assert.equal((await request(roku.port,'/keypress/Play','POST')).status,403);
});
test('SSDP responds to both discovery types with distinct device identities', () => {
  const hue = hueAdvertisements({ address: '192.168.1.2',port: 18080,uuid: 'hue-uuid',bridgeId: 'BRIDGE' });
  const roku = rokuAdvertisements({ address: '192.168.1.2',port: 8060,serial: 'ROKU' });
  const search = st => Buffer.from(`M-SEARCH * HTTP/1.1\r\nMAN: "ssdp:discover"\r\nST: ${st}\r\n\r\n`);
  assert.equal(matchSearch(search('roku:ecp'),[...hue,...roku]).length,1);
  assert.equal(matchSearch(search('ssdp:all'),[...hue,...roku]).length,4);
  assert.match(searchResponse(roku[0]),/LOCATION: http:\/\/192\.168\.1\.2:8060\//);
  assert.equal(matchSearch(Buffer.from('invalid'),hue).length,0);
});
test('SSDP listener answers an actual UDP search on loopback', async t => {
  const discovery = new Discovery({ interfaceAddress: '127.0.0.1',hubs: ['127.0.0.1'],advertisements: rokuAdvertisements({ address: '127.0.0.1',port: 8060,serial: 'TEST' }),port: 0 });
  t.after(() => discovery.close()); await discovery.start();
  const client = createSocket('udp4'); t.after(() => client.close());
  await new Promise(resolve => client.bind(0,'127.0.0.1',resolve));
  const received = new Promise((resolve,reject) => { const timeout = setTimeout(() => reject(new Error('SSDP reply timed out')),2000); client.once('message',message => { clearTimeout(timeout); resolve(message.toString()); }); });
  client.send(Buffer.from('M-SEARCH * HTTP/1.1\r\nMAN: "ssdp:discover"\r\nST: roku:ecp\r\n\r\n'),discovery.socket.address().port,'127.0.0.1');
  assert.match(await received,/USN: uuid:roku:ecp:TEST/);
});

test('Hue phone registration is window-limited, retry-stable and does not grant command access', async t => {
  const f = await hueFixture(t);
  f.config.harmonyHubAddresses = ['192.0.2.4'];
  assert.equal((await request(f.hue.port,'/api','POST',{ devicetype: 'phone' })).value[0].error.type,101);
  f.hue.openPairing();
  const first = (await request(f.hue.port,'/api','POST',{ devicetype: 'phone' })).value[0].success.username;
  const second = (await request(f.hue.port,'/api','POST',{ devicetype: 'phone' })).value[0].success.username;
  assert.equal(first,second);
  assert.equal((await request(f.hue.port,`/api/${first}/lights`)).value['1'].name,'Reading lamp');
  assert.equal((await request(f.hue.port,'/api/not-paired/lights')).value[0].error.type,1);
  assert.equal(Object.keys(f.state.data.users).length,1);
  assert.equal(f.hue.pairingDiagnostic.result,'paired');
  assert.ok(!JSON.stringify(f.hue.pairingDiagnostic).includes(first));
  assert.equal((await request(f.hue.port,`/api/${first}/lights/1/state`,'PUT',{on:true})).status,403);
  assert.equal(f.writes.length,0);
  f.expire();
  assert.equal((await request(f.hue.port,'/api','POST',{devicetype:'phone'})).value[0].error.type,101);
  assert.equal(f.hue.pairingDiagnostic.result,'window-closed');
});
test('Hue descriptor uses consistent BSB002 model and advertised address', async t => {
  const f = await hueFixture(t);
  const descriptor = (await request(f.hue.port,'/description.xml')).text;
  assert.match(descriptor, /<modelNumber>BSB002<\/modelNumber>/);
  assert.match(descriptor, /device:Basic:1/);
  assert.ok(descriptor.includes(`http://${f.config.advertiseAddress}:${f.hue.port}/`));
});
test('Hue SSDP accepts deCONZ-compatible searches from a phone outside hub allowlist', async t => {
  const ads = hueAdvertisements({ address:'127.0.0.1',port:18080,uuid:'test-hue',bridgeId:'TEST' });
  const discovery = new Discovery({ interfaceAddress:'127.0.0.1',hubs:['192.0.2.4'],advertisements:ads,port:0 });
  t.after(() => discovery.close());
  await discovery.start();
  assert.equal(discovery.interval._idleTimeout,20000);
  const client = createSocket('udp4'); t.after(() => client.close());
  await new Promise(resolve => client.bind(0,'127.0.0.1',resolve));
  const search = Buffer.from('M-SEARCH * HTTP/1.1\r\nST: upnp:rootdevice\r\n\r\n');
  const received = new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('Hue discovery reply timed out')),2000);
    client.once('message',message => { clearTimeout(timer); resolve(message.toString()); });
  });
  client.send(search,discovery.socket.address().port,'127.0.0.1');
  const response = await received;
  assert.match(response,/LOCATION: http:\/\/127.0.0.1:18080\/description.xml/);
  assert.match(response,/CACHE-CONTROL: max-age=100/);
  assert.equal(discovery.diagnostics.lastSearch.address,'127.0.0.1');
  assert.equal(discovery.diagnostics.searches,1);
  assert.equal(matchSearch(Buffer.from('M-SEARCH * HTTP/1.1\r\nMAN: ssdp:discover\r\nST: ssdp:all\r\n\r\n'),ads).length,3);
  assert.equal(matchSearch(Buffer.from('M-SEARCH * HTTP/1.1\r\nMAN: invalid\r\nST: ssdp:all\r\n\r\n'),ads).length,0);
});
test('SSDP send failures are surfaced without raw payloads', () => {
  const warnings = [];
  const discovery = new Discovery({ interfaceAddress:'192.0.2.2',hubs:[],advertisements:[],log:{warn:message => warnings.push(message)} });
  discovery.socket = { send(buffer,port,address,callback) { callback(Object.assign(new Error('private payload'),{code:'ENETUNREACH'})); } };
  discovery.send('private payload');
  assert.equal(discovery.diagnostics.sendErrors,1);
  assert.equal(discovery.diagnostics.lastError,'ENETUNREACH');
  assert.equal(warnings.length,1);
  assert.ok(!warnings[0].includes('private payload'));
});
