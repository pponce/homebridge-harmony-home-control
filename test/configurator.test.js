import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer, request } from 'node:http';
import { temporary } from './helpers.js';
import { HubReader, ConfiguratorError } from '../lib/configurator/hub.js';
import { project, draftChange, validateContext } from '../lib/configurator/model.js';
import { suggestions } from '../lib/configurator/advice.js';
import { ConfiguratorServer } from '../lib/configurator/server.js';
import { ConfiguratorStore } from '../lib/configurator/store.js';
import { HarmonyPlatform } from '../lib/platform.js';
import { normalizeConfig,validateConfig } from '../lib/config.js';
import { listen,closeServer } from '../lib/http.js';
import { nativeFixture,modelFixture } from './configurator-fixtures.js';

test('device projection preserves native numeric control settings and labels only known mappings',() => {
  const snapshot=nativeFixture(), device=snapshot.resources.DeviceList.DevicesWithFeatures[0].Device;
  const projected=()=>project(snapshot).devices[0];
  assert.equal(projected().transport,'1');assert.equal(projected().transportLabel,'Infrared (IR) (code 1)');
  assert.equal(projected().controlPort,'7');assert.equal(projected().controlPortLabel,'Hub + Mini blaster 1 + Mini blaster 2 (code 7)');
  for (const [port,label] of [[1,'Hub'],[2,'Mini blaster 1'],[3,'Hub + Mini blaster 1'],[4,'Mini blaster 2'],[5,'Hub + Mini blaster 2'],[6,'Mini blaster 1 + Mini blaster 2']]) {
    device.ControlPort=port;assert.equal(projected().controlPortLabel,`${label} (code ${port})`);
  }
  device.Transport='32';device.ControlPort='7';
  assert.equal(projected().transportLabel,'Bluetooth (code 32)');assert.equal(projected().controlPortLabel,'Not used for Bluetooth (stored: 7)');
  device.Transport='IR';device.ControlPort='2';assert.equal(projected().controlPortLabel,'Mini blaster 1 (code 2)');
  device.Transport=64;device.ControlPort=99;
  assert.equal(projected().transport,'64');assert.match(projected().transportLabel,/Unrecognized.*64/);
  assert.equal(projected().controlPort,'99');assert.equal(projected().controlPortLabel,'Reported port code 99');
  device.Transport=0;device.ControlPort=0;device.PressMinRepeats=0;
  assert.equal(projected().transport,'0');assert.equal(projected().controlPort,'0');assert.equal(projected().repeats,0);
  device.Transport='Network';device.ControlPort='Custom output';
  assert.equal(projected().transportLabel,'Network');assert.equal(projected().controlPortLabel,'Custom output');
  for (const absent of [undefined,null,'','  ',false,{},[],NaN,Infinity]) {
    device.Transport=absent;device.ControlPort=absent;
    assert.equal(projected().transport,'');assert.equal(projected().transportLabel,'');
    assert.equal(projected().controlPort,'');assert.equal(projected().controlPortLabel,'');
  }
  snapshot.resources.DeviceList.DevicesWithFeatures[0].DeviceFeatures[1].InputType=0;
  assert.equal(projected().inputMethod,'0');
});

test('root-free reads use account resources, accept numeric IDs/string resources and never send commands',async () => {
  const calls = [], fixture = nativeFixture(); let socket,closed=false;
  class Socket extends EventTarget {
    constructor(url) {super();socket=this;this.url=url;queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
    send(raw) {
      const payload=JSON.parse(raw);calls.push(payload);
      const name=payload.hbus.params.uri.split('/').at(-1);
      queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id:payload.hbus.id,code:'200',data:{code:200,resource:JSON.stringify(fixture.resources[name])}})})));
    }
    close(){closed=true;this.dispatchEvent(new Event('close'));}
  }
  const reader=new HubReader({Socket,fetchImpl:async (url,options)=>{assert.equal(url,'http://192.0.2.70:8088/');assert.equal(options.redirect,'error');assert.equal(JSON.parse(options.body).cmd,'setup.account?getProvisionInfo');return new Response(JSON.stringify({data:{activeRemoteId:800,accountId:900,email:'private@example.invalid'}}));}});
  const snapshot=await reader.read('192.0.2.70');
  assert.equal(snapshot.remoteId,'800');assert.equal(snapshot.accountId,'900');assert.ok(socket.url.includes('hubId=800'));
  assert.deepEqual(calls.map(c=>c.hbus.cmd),Array(4).fill('proxy.resource?get'));assert.ok(calls.every(c=>c.hbus.params.uri.startsWith('harmony://Account/900/')));assert.ok(closed);
  const safe=JSON.stringify(project(snapshot));assert.ok(!safe.includes('never-export'));assert.ok(!safe.includes('not-for-export'));assert.ok(!safe.includes('private@example'));
  assert.equal(project(snapshot).activities[0].roles[0].nextDeviceDelay,500);
});
test('hub reader bounds a stalled response and closes its socket',async () => {
  let closed=false;
  class Socket extends EventTarget {constructor(){super();queueMicrotask(()=>this.dispatchEvent(new Event('open')));}send(){}close(){closed=true;}}
  const reader=new HubReader({timeout:15,Socket,fetchImpl:async()=>new Response(JSON.stringify({data:{activeRemoteId:'800',accountId:'900'}}))});
  await assert.rejects(reader.read('192.0.2.70'),/DeviceList was not returned/);assert.ok(closed);
  await assert.rejects(reader.read('127.0.0.1'),/LAN address/);
});
test('missing optional maps are reported without inventing data',async () => {
  class Socket extends EventTarget {constructor(){super();queueMicrotask(()=>this.dispatchEvent(new Event('open')));}send(raw){const p=JSON.parse(raw),name=p.hbus.params.uri.split('/').at(-1),required=['DeviceList','ActivityList'].includes(name);queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id:p.hbus.id,code:required?200:404,data:{resource:nativeFixture().resources[name]}})})));}close(){}}
  const result=await new HubReader({Socket,fetchImpl:async()=>new Response(JSON.stringify({data:{activeRemoteId:800,accountId:900}}))}).read('192.0.2.70');
  assert.deepEqual(result.unavailable,['MapList','FunctionList']);assert.deepEqual(project(result).maps,[]);
});
test('draft validation refuses stale, absent and unrecognized fields; device changes stay manual',() => {
  const s=modelFixture(),base={kind:'device',id:'101',field:'delays.powerOn',value:1500,version:s.version};
  assert.equal(draftChange(base,s).cloud,null);assert.equal(draftChange(base,s).before,1000);
  assert.throws(()=>draftChange({...base,version:'old'},s),/changed/);assert.throws(()=>draftChange({...base,value:-1},s),/valid value/);assert.throws(()=>draftChange({...base,id:'102'},s),/not supplied/);assert.throws(()=>draftChange({...base,field:'__proto__'},s),/not editable/);
  const a=draftChange({kind:'activity',id:'401',field:'powerOnOrder',role:0,value:2,version:s.version},s);assert.equal(a.cloud.field,'PowerOnOrder');assert.equal(a.cloud.roleId,'301');
});
test('assistant rejects HDMI loops and keeps CEC advice dependent on user answers',() => {
  const s=modelFixture();
  assert.throws(()=>validateContext({devices:{101:{destination:'102'},102:{destination:'101'}}},s),/loop/);
  assert.ok(suggestions(s,{}).every(a=>a.confidence==='Needs your input'));
  const context=validateContext({devices:{102:{kind:'switch',wakeBy:'manual',sleepBy:'cec',cec:'on',offBehavior:'keep',destination:'101',port:'HDMI 2'}}},s);
  const advice=suggestions(s,context);assert.ok(advice.some(a=>a.id==='102/switch'));assert.ok(advice.some(a=>a.id==='102/cec-sleep'));assert.ok(advice.some(a=>a.confidence==='Possible mismatch'));
});
async function serverFixture(t, extraConfig = {}) {
  const directory=await temporary(t), imported=nativeFixture(); let reads=0,closed=false;
  const reader={read:async()=>{reads++;return structuredClone(imported);},close(){closed=true;}};
  const server=new ConfiguratorServer({directory,config:{...normalizeConfig(),advertiseAddress:'127.0.0.1',harmonyHubAddresses:['192.0.2.70'],configuratorPort:0,...extraConfig},reader});
  await server.start();t.after(()=>server.close());
  const origin=`http://127.0.0.1:${server.port}`;
  const access=new URL(server.accessLink().url).hash.slice(8);
  const opened=await fetch(`${origin}/api/session`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({access})});
  const cookie=opened.headers.get('set-cookie').split(';')[0],csrf=(await opened.json()).csrf;
  let revision=0;
  async function call(path,body,headers={}) {
    const response=await fetch(`${origin}/api/${path}`,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:origin,...(body?{'Content-Type':'application/json','X-Configurator-CSRF':csrf}:{}),...headers},body:body?JSON.stringify({host:'192.0.2.70',revision,...body}):undefined});
    const result=await response.json();if(result.revision!==undefined)revision=result.revision;return {status:response.status,result};
  }
  return {server,directory,origin,access,cookie,csrf,call,imported,reads:()=>reads,closed:()=>closed};
}
test('configurator requires one-use authentication and rejects CSRF, foreign origins and arbitrary hub targets',async t => {
  const f=await serverFixture(t);
  assert.equal((await fetch(`${f.origin}/api/state`)).status,401);
  assert.equal((await fetch(`${f.origin}/api/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access:f.access})})).status,401);
  assert.equal((await f.call('refresh',{}, {'X-Configurator-CSRF':'bad'})).status,403);
  assert.equal((await f.call('refresh',{}, {Origin:'https://evil.invalid'})).status,403);
  assert.equal((await f.call('refresh',{host:'169.254.169.254'})).status,400);
  const rebinding=await new Promise(resolve=>{const req=request(`${f.origin}/api/state`,{headers:{Host:`evil.invalid:${f.server.port}`,Cookie:f.cookie}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.end();});assert.equal(rebinding,403);
  assert.equal(f.reads(),0);
  assert.equal((await f.call('refresh',{})).status,200);assert.equal(f.reads(),1);
  const asset=await fetch(f.origin);assert.match(asset.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(await asset.text(),/Setup Assistant/);
});
test('answers and drafts survive restart; stale pages conflict and refreshed imports verify manual changes',async t => {
  const f=await serverFixture(t);const first=await f.call('refresh',{});const s=first.result.snapshot;
  await f.call('draft',{change:{kind:'device',id:'101',field:'delays.powerOn',value:1500,version:s.version}});
  const stale=await f.call('context',{revision:0,context:{devices:{}}});assert.equal(stale.status,409);
  await f.call('context',{context:{devices:{102:{kind:'switch',wakeBy:'manual'}}}});
  const stored=await new ConfiguratorStore(f.directory).load();assert.equal(stored.hub('192.0.2.70').context.devices['102'].kind,'switch');assert.equal(stored.hub('192.0.2.70').drafts[0].value,1500);
  const path=join(f.directory,'configurator.json');assert.equal((await stat(path)).mode & 0o777,0o600);assert.ok(!(await readFile(path,'utf8')).includes('never-export'));
  f.imported.resources.DeviceList.DevicesWithFeatures[0].DeviceFeatures[0].PowerOnDelay=1500;
  const refreshed=await f.call('refresh',{});assert.equal(refreshed.result.drafts[0].status,'hub-confirmed');
  const exported=await f.call('export');assert.equal(exported.result.format,'harmony-setup-review');assert.ok(!JSON.stringify(exported.result).includes('remoteId'));
});
test('failed refresh preserves the prior import and surfaces staleness',async t => {
  const f=await serverFixture(t);await f.call('refresh',{});f.server.reader.read=async()=>{throw new ConfiguratorError('Hub offline',502);};
  assert.equal((await f.call('refresh',{})).status,502);
  const {result}=await f.call('state');assert.equal(result.lastError,'Hub offline');assert.equal(result.snapshot.devices.length,2);
});
test('a possibly submitted cloud save cannot be blindly replayed',async t => {
  const f=await serverFixture(t);let writes=0;f.server.cloudFactory=()=>({target:null,login:async function(){this.target={accountId:'900',remoteId:'800'};},close(){},apply:async(d,submitted)=>{writes++;submitted();throw new ConfiguratorError('Transport interrupted',502);}});
  const {result}=await f.call('refresh',{});await f.call('login',{email:'fake@example.invalid',password:'test-only'});
  const drafted=await f.call('draft',{change:{kind:'activity',id:'401',field:'name',value:'New game',version:result.snapshot.version}});const key=drafted.result.drafts[0].key;
  assert.equal((await f.call('apply',{key,confirm:true})).status,502);
  const current=await f.call('state');assert.equal(current.result.drafts[0].status,'unconfirmed');
  assert.equal((await f.call('apply',{key,confirm:true})).status,409);assert.equal(writes,1);
  const disk=await readFile(join(f.directory,'configurator.json'),'utf8');assert.ok(!disk.includes('test-only'));assert.ok(!disk.includes('fake@example'));
});
test('disabled by default; listener follows child-bridge lifecycle and cannot share emulator ports',async t => {
  assert.equal(normalizeConfig().configuratorEnabled,false);
  const config={advertiseAddress:'192.0.2.10',harmonyHubAddresses:['192.0.2.70'],hueEnabled:false,rokuEnabled:false};
  assert.throws(()=>validateConfig({...config,hueEnabled:true,configuratorEnabled:true,configuratorPort:18080}),/different port/);
  const probe=createServer();const port=await listen(probe,0);await closeServer(probe);
  const directory=await temporary(t),handlers={},api={user:{storagePath:()=>directory,configPath:()=>join(directory,'config.json')},on:(name,fn)=>{handlers[name]=fn;}},log={info(){},warn(){},error(){}};
  const platform=new HarmonyPlatform(log,{...config,configuratorEnabled:true,configuratorPort:port},api);t.after(()=>platform.close());
  handlers.didFinishLaunching();await platform.starting;assert.ok(platform.configurator.server.listening);
  const admin=JSON.parse(await readFile(join(directory,'harmony-home-control','runtime.json'),'utf8'));
  const opened=await fetch(`http://127.0.0.1:${admin.port}/configurator/open`,{method:'POST',headers:{Authorization:`Bearer ${admin.token}`}});assert.equal(opened.status,200);
  await platform.close();assert.equal(platform.configurator.server.listening,false);assert.equal(platform.admin.listening,false);
});


test('public proxy URL validates origins and generates a secure authenticated access link',async t => {
  const base={advertiseAddress:'192.0.2.10',harmonyHubAddresses:['192.0.2.70']};
  for (const url of ['http://example.com','https://user:pass@example.com','https://example.com/path','https://example.com/?q=1','https://example.com/#hash']) assert.throws(()=>validateConfig({...base,configuratorPublicUrl:url}),/HTTPS origin/);
  assert.equal(validateConfig({...base,configuratorPublicUrl:'https://harmony.example.com/'}).configuratorPublicUrl,'https://harmony.example.com');
  const f=await serverFixture(t,{configuratorPublicUrl:'https://harmony.example.com'});
  const link=f.server.accessLink().url;assert.ok(link.startsWith('https://harmony.example.com/#access='));
  const send=(headers, payload) => new Promise((resolve,reject)=>{
    const req=request(`${f.origin}/api/session`,{method:'POST',headers:{Host:'harmony.example.com','Content-Type':'application/json',...headers}},res=>{let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text)}));});req.on('error',reject);req.end(JSON.stringify(payload));
  });
  const payload={access:new URLSearchParams(new URL(link).hash.slice(1)).get('access')};
  assert.equal((await send({Origin:'https://harmony.example.com'},payload)).status,403);
  assert.equal((await send({Origin:'https://evil.example','X-Forwarded-Proto':'https'},payload)).status,403);
  const valid=await send({Origin:'https://harmony.example.com','X-Forwarded-Proto':'https'},payload);assert.equal(valid.status,200);assert.match(valid.headers['set-cookie'][0],/; Secure/);assert.ok(valid.body.csrf);
  let status;
  await f.server.handle({headers:{host:'harmony.example.com','x-forwarded-proto':'https'},socket:{remoteAddress:'192.0.2.90'}},{setHeader(){},writeHead(code){status=code;},end(){}});
  assert.equal(status,403,'Forwarded headers from a non-loopback peer must not be trusted');
});
