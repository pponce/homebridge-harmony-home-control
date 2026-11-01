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
import { deviceFields, draftValue, connectionsFor, methodsFor, inputMethodLabel } from '../configurator-web/settings.js';

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
test('draft validation accepts unknown supported values without inventing a before value',() => {
  const s=modelFixture(),base={kind:'device',id:'101',field:'delays.powerOn',value:1500,version:s.version};
  assert.equal(draftChange(base,s).cloud.resource,'PowerFeature');assert.equal(draftChange(base,s).before,1000);
  assert.throws(()=>draftChange({...base,version:'old'},s),/changed/);assert.throws(()=>draftChange({...base,value:-1},s),/valid value/);assert.throws(()=>draftChange({...base,field:'__proto__'},s),/not editable/);
  for (const [field,spec] of Object.entries(deviceFields)) {
    if (['name','controlPort','inputOrder','inputCommands'].includes(field) || spec.type === 'actions') continue;
    const value=spec.options?.[0][0] ?? (spec.type === 'boolean' ? false : 0);
    const change=draftChange({...base,id:'102',field,value},s);
    assert.equal(change.before,null);assert.equal(change.value,value);assert.ok(change.cloud);
    assert.equal(JSON.parse(JSON.stringify(change)).before,null);
  }
  for (const [field,value] of [['delays.powerOn',''],['delays.powerOn',null],['delays.input',-1],['delays.input',60001],['delays.interKey',10001],['repeats',6],['power.type',99],['power.alwaysOn','true'],['inputMethod','99']]) assert.throws(()=>draftChange({...base,id:'102',field,value},s),/valid value/);
  assert.throws(()=>draftChange({...base,id:'102',field:'controlPort',value:'1'},s),/infrared/);
  s.devices[0].controlPort='';assert.equal(draftChange({...base,field:'controlPort',value:'2'},s).before,null);
  const a=draftChange({kind:'activity',id:'401',field:'powerOnOrder',role:0,value:2,version:s.version},s);assert.equal(a.cloud.field,'PowerOnOrder');assert.equal(a.cloud.roleId,'301');
  s.activities[0].order=null;s.activities[0].roles[0].powerOnOrder=null;
  for (const extra of [{field:'order'},{field:'powerOnOrder',role:0},{field:'nextDeviceDelay',role:1}]) {
    const change=draftChange({kind:'activity',id:'401',value:1,version:s.version,...extra},s);assert.equal(change.before,null);assert.ok(change.cloud);
  }
});
test('input-method drafts retain missing values and label only recognized codes',() => {
  const source=nativeFixture(),feature=source.resources.DeviceList.DevicesWithFeatures[0].DeviceFeatures[1];
  delete feature.InputType;
  const s=project(source),base={kind:'device',id:'101',field:'inputMethod',version:s.version};
  assert.equal(s.devices[0].inputs.length,2);
  for (const value of ['1','2','4']) { const d=draftChange({...base,value},s);assert.equal(d.before,null);assert.equal(d.cloud.resource,'InputFeature');assert.match(inputMethodLabel(value),/code/); }
  assert.equal(inputMethodLabel('99'),'Reported method code 99');assert.equal(inputMethodLabel(''),null);
});
test('reported defaults stay separate from unknown active values and preserve zero',() => {
  const source=nativeFixture();delete source.resources.DeviceList.DevicesWithFeatures[0].DeviceFeatures[0].PowerOnDelay;
  const devices=project(source).devices;
  assert.equal(devices[0].delays.powerOn,null);assert.equal(devices[0].defaults.delays.powerOn,1200);assert.equal(devices[0].defaults.delays.interKey,0);
  assert.equal(devices[1].delays.powerOn,null);assert.equal(devices[1].defaults.delays.powerOn,null);assert.equal(devices[1].repeats,null);assert.equal(devices[1].defaults.repeats,null);
});
test('input order drafts preserve every input, use stored order and never edit commands',() => {
  const s=modelFixture(),device=s.devices[0],before=structuredClone(device),base={kind:'device',id:device.id,field:'inputOrder',value:['HDMI 2','HDMI 1'],version:s.version};
  const change=draftChange(base,s);assert.deepEqual(change.before,['HDMI 1','HDMI 2']);assert.equal(change.cloud.resource,'InputFeature');assert.deepEqual(device,before);
  for (const value of [['HDMI 1'],['HDMI 2','HDMI 2'],['HDMI 1','HDMI 3']]) assert.throws(()=>draftChange({...base,value},s),/each imported input/);
  assert.throws(()=>draftChange({...base,value:['HDMI 1','HDMI 2']},s),/different value/);
  device.inputs[0].order=null;assert.equal(draftChange(base,s).before,null);
  device.inputs[0].order=2;device.inputs[1].order=1;assert.deepEqual(draftValue(device,'inputOrder'),['HDMI 2','HDMI 1']);
});
test('assistant rejects HDMI loops and keeps CEC advice dependent on user answers',() => {
  const s=modelFixture();
  assert.throws(()=>validateContext({devices:{101:{destination:'102'},102:{destination:'101'}}},s),/loop/);
  assert.ok(suggestions(s,{}).every(a=>a.confidence==='Needs your input'));
  const context=validateContext({devices:{102:{kind:'switch',wakeBy:'manual',sleepBy:'cec',cec:'on',offBehavior:'keep',destination:'101',port:'HDMI 2'}}},s);
  const advice=suggestions(s,context);assert.ok(advice.some(a=>a.id==='102/switch'));assert.ok(advice.some(a=>a.id==='102/cec-sleep'));assert.ok(advice.some(a=>a.confidence==='Possible mismatch'));
});
test('assistant preserves legacy cables and supports multiple outputs, return audio and independent controllers',() => {
  const s=modelFixture();s.devices.push({...structuredClone(s.devices[0]),id:'103',name:'Second display'});
  const saved=validateContext({devices:{102:{kind:'receiver',destination:'101',port:'HDMI 2'}}},s);
  assert.deepEqual(connectionsFor(saved.devices[102]),[{destination:'101',port:'HDMI 2',outputPort:'',audioReturn:'unknown'}]);
  const connections=[{destination:'101',port:'HDMI 2 (eARC)',outputPort:'OUT 1',audioReturn:'earc'},{destination:'103',port:'HDMI 1',outputPort:'OUT 2',audioReturn:'none'}];
  const powerPaths=[{direction:'sleep',method:'cec',controller:'101',trigger:'TV off'},{direction:'sleep',method:'cec',controller:'103',trigger:'Second TV off'},{direction:'wake',method:'automation',controller:'external',trigger:'HomeKit button'}];
  const context=validateContext({devices:{102:{kind:'receiver',cec:'off',connections,powerPaths}}},s);
  assert.deepEqual(context.devices[102].connections,connections);assert.deepEqual(context.devices[102].powerPaths,powerPaths);
  const advice=suggestions(s,context);assert.ok(advice.some(a=>a.id==='102/cec-off'));assert.ok(!advice.some(a=>a.id==='102/questions'));
  assert.throws(()=>validateContext({devices:{102:{connections},103:{connections:[{destination:'102'}]}}},s),/loop/);
  assert.throws(()=>validateContext({devices:{102:{connections:[{destination:'999'}]}}},s),/available setup answers/);
  for (const path of [{...powerPaths[0],controller:'999'},{...powerPaths[0],method:'invalid'},{...powerPaths[0],controller:'102'}]) assert.throws(()=>validateContext({devices:{102:{powerPaths:[path]}}},s));
});
test('available power methods stay separate from preferred controllers and migrate older answers',() => {
  const s=modelFixture(),legacy={kind:'receiver',wakeBy:'harmony',sleepBy:'cec',powerPaths:[{direction:'sleep',method:'automation',controller:'external',trigger:'HomeKit button'}]};
  const migrated=validateContext({devices:{101:legacy}},s).devices[101];
  assert.deepEqual(methodsFor(migrated,'wake'),['harmony']);assert.deepEqual(methodsFor(migrated,'sleep'),['cec','automation']);assert.equal(migrated.sleepBy,'cec');
  const device={...legacy,cec:'off',powerMethods:{wake:['harmony','cec','automation'],sleep:['cec','automation']}};
  let context=validateContext({devices:{101:device}},s),advice=suggestions(s,context);
  assert.ok(advice.some(a=>a.id==='101/cec-off'));assert.ok(!advice.some(a=>a.id==='101/two-owners')); // Capability alone is not an active CEC wake path.
  s.devices[0].power.type=2;
  context=validateContext({devices:{101:{...device,sleepBy:'harmony'}}},s);advice=suggestions(s,context);
  assert.ok(advice.some(a=>a.id==='101/preferred-sleep'));assert.ok(advice.some(a=>a.id==='101/toggle-sleep'));
  for (const powerMethods of [null,[],{wake:'cec'},{wake:['cec','cec']},{wake:['invalid']}]) assert.throws(()=>validateContext({devices:{101:{...device,powerMethods}}},s));
  const unknown=validateContext({devices:{101:{}}},s).devices[101];assert.deepEqual(methodsFor(unknown,'wake'),[]);
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
test('cloud map drafts require a bound session catalog; IR payloads and map identities stay out of review exports',async t=>{
  const f=await serverFixture(t),button={key:'Power',id:'button-1',type:'HardRemoteButton',press:{kind:'command',deviceId:'101',command:'PowerOn'},long:null,double:null},target={remoteId:'800',skinId:'104',surfaceId:'7',mapId:'501',identifier:''};let writes=0;
  f.server.cloudFactory=()=>({target:null,async login(e,p,t){this.target=t;},close(){},async buttonMaps(owner){return [{ownerKind:owner.kind,ownerId:owner.id,target,buttons:[button]}];},async infraredCodes(){return [{name:'PowerOn',raw:'test-ir-payload'}];},async preview(d){return {before:d.before,fingerprint:'map-review'};},async apply(d,submitted){writes++;submitted();},async sync(){}});
  const {result}=await f.call('refresh',{});await f.call('login',{email:'fake@example.invalid',password:'test-password'});
  const change={kind:'button',id:'401',ownerKind:'activity',field:'press',button:{key:button.key,id:button.id,type:button.type},mapTarget:target,version:result.snapshot.version,value:{kind:'command',deviceId:'101',command:'PowerOff'}};
  assert.equal((await f.call('draft',{change})).status,409);
  assert.equal((await f.call('button-maps',{owner:{kind:'activity',id:'999'}})).status,400);
  assert.equal((await f.call('button-maps',{owner:{kind:'activity',id:'401'}})).status,200);
  const drafted=await f.call('draft',{change});assert.equal(drafted.status,200);const key=drafted.result.drafts[0].key;
  await f.call('ir-codes',{owner:{kind:'device',id:'101'}});
  const exported=(await f.call('export')).result;assert.ok(!JSON.stringify(exported).includes('test-ir-payload'));assert.equal(exported.drafts[0].mapTarget,undefined);
  assert.ok(!String(await readFile(join(f.directory,'configurator.json'))).includes('test-ir-payload'));
  assert.equal((await f.call('apply',{key,confirm:true})).status,409);assert.equal(writes,0);
  const review=(await f.call('preview',{key})).result.cloud.review;assert.equal((await f.call('apply',{key,confirm:true,reviewToken:review.token})).status,200);assert.equal(writes,1);
  await f.call('refresh',{});assert.equal((await f.call('state')).result.drafts[0].status,'cloud-saved');
  const session=f.server.sessions.get(f.cookie.split('=')[1]);f.server.job={host:'192.0.2.70'};await f.server.runSync('192.0.2.70',session);
  assert.equal((await f.call('state')).result.drafts[0].status,'remote-check');
  assert.equal((await f.call('remote-verified',{key,confirm:true})).result.drafts[0].status,'remote-confirmed');
  f.imported.accountId='901';await f.call('refresh',{});assert.deepEqual((await f.call('state')).result.cloud.maps,[]);
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
test('missing-value and input-order drafts persist, stay unconfirmed while absent, and verify only on a matching read',async t => {
  const f=await serverFixture(t),first=await f.call('refresh',{}),version=first.result.snapshot.version;
  let writes=0;f.server.cloudFactory=()=>({target:null,async login(){this.target={accountId:'900',remoteId:'800'};},close(){},async apply(){writes++;}});
  await f.call('login',{email:'fake@example.invalid',password:'test-only'});
  const power=await f.call('draft',{change:{kind:'device',id:'102',field:'delays.powerOn',value:0,version}});
  assert.equal(power.status,200);assert.equal(power.result.drafts[0].before,null);assert.equal(power.result.drafts[0].cloud.resource,'PowerFeature');
  let state=await f.call('refresh',{});assert.equal(state.result.drafts[0].status,'draft');
  assert.equal((await f.call('apply',{key:state.result.drafts[0].key,confirm:true})).status,409);
  assert.equal(writes,0);
  await f.call('manual',{key:state.result.drafts[0].key});state=await f.call('refresh',{});assert.equal(state.result.drafts[0].status,'manual-pending');
  const order=['HDMI 2','HDMI 1'];
  await f.call('draft',{change:{kind:'device',id:'101',field:'inputOrder',value:order,version:state.result.snapshot.version}});
  const stored=await new ConfiguratorStore(f.directory).load();assert.equal(stored.hub('192.0.2.70').drafts[0].before,null);assert.deepEqual(stored.hub('192.0.2.70').drafts[1].value,order);
  f.imported.resources.DeviceList.DevicesWithFeatures[1].DeviceFeatures.push({__type:'PowerFeature',PowerOnDelay:0});
  const inputs=f.imported.resources.DeviceList.DevicesWithFeatures[0].DeviceFeatures[1].Inputs;inputs[0].InputOrder=2;inputs[1].InputOrder=1;
  state=await f.call('refresh',{});assert.ok(state.result.drafts.every(d=>d.status==='hub-confirmed'));
  inputs[0].InputOrder=1;inputs[1].InputOrder=2;
  state=await f.call('refresh',{});assert.equal(state.result.drafts.find(d=>d.field==='inputOrder').status,'changed-again');
});
test('failed refresh preserves the prior import and surfaces staleness',async t => {
  const f=await serverFixture(t);await f.call('refresh',{});f.server.reader.read=async()=>{throw new ConfiguratorError('Hub offline',502);};
  assert.equal((await f.call('refresh',{})).status,502);
  const {result}=await f.call('state');assert.equal(result.lastError,'Hub offline');assert.equal(result.snapshot.devices.length,2);
});
test('missing activity-role drafts verify the original device after roles move or disappear',async t => {
  const f=await serverFixture(t),roles=f.imported.resources.ActivityList.Activities[0].Roles;
  delete roles[1].PowerOnOrder;
  const {result}=await f.call('refresh',{});
  await f.call('draft',{change:{kind:'activity',id:'401',field:'powerOnOrder',role:1,value:2,version:result.snapshot.version}});
  roles[0].PowerOnOrder=2;roles.reverse();
  let state=await f.call('refresh',{});assert.equal(state.result.drafts[0].status,'draft');
  roles[0].PowerOnOrder=2;
  state=await f.call('refresh',{});assert.equal(state.result.drafts[0].status,'hub-confirmed');
  roles.shift();
  state=await f.call('refresh',{});assert.equal(state.result.drafts[0].status,'changed-again');
});
test('a possibly submitted cloud save cannot be blindly replayed',async t => {
  const f=await serverFixture(t);let writes=0;f.server.cloudFactory=()=>({target:null,login:async function(){this.target={accountId:'900',remoteId:'800'};},close(){},async preview(d){return {before:d.before,fingerprint:'activity-review'};},apply:async(d,submitted)=>{writes++;submitted();throw new ConfiguratorError('Transport interrupted',502);}});
  const {result}=await f.call('refresh',{});await f.call('login',{email:'fake@example.invalid',password:'test-only'});
  const drafted=await f.call('draft',{change:{kind:'activity',id:'401',field:'name',value:'New game',version:result.snapshot.version}});const key=drafted.result.drafts[0].key;
  assert.equal((await f.call('apply',{key,confirm:true})).status,409);
  const review=(await f.call('preview',{key})).result.cloud.review;
  assert.equal((await f.call('apply',{key,confirm:true,reviewToken:review.token})).status,502);
  const current=await f.call('state');assert.equal(current.result.drafts[0].status,'unconfirmed');
  assert.equal((await f.call('apply',{key,confirm:true})).status,409);assert.equal(writes,1);
  const disk=await readFile(join(f.directory,'configurator.json'),'utf8');assert.ok(!disk.includes('test-only'));assert.ok(!disk.includes('fake@example'));
});
test('device saves require a fresh session-bound review; previews and credentials never enter persisted state',async t=>{
  const f=await serverFixture(t);let writes=0;
  f.server.cloudFactory=()=>({target:null,async login(email,password,target){this.target=target;},close(){},async preview(){return {before:1200,fingerprint:'test-fingerprint'};},async apply(d,submitted,review){assert.equal(review.before,1200);writes++;submitted();}});
  const first=await f.call('refresh',{});await f.call('login',{email:'fake@example.invalid',password:'review-password'});
  const drafted=await f.call('draft',{change:{kind:'device',id:'102',field:'delays.powerOn',value:1500,version:first.result.snapshot.version}}), key=drafted.result.drafts[0].key;
  assert.equal((await f.call('apply',{key,confirm:true})).status,409);assert.equal(writes,0);
  let review=(await f.call('preview',{key})).result.cloud.review;
  assert.equal(review.before,1200);assert.equal(review.fingerprint,undefined);
  const disk=await readFile(join(f.directory,'configurator.json'),'utf8');assert.ok(!disk.includes(review.token));assert.ok(!disk.includes('test-fingerprint'));assert.ok(!disk.includes('review-password'));
  assert.equal((await f.call('apply',{key,confirm:true,reviewToken:'bad'})).status,409);assert.equal(writes,0);
  review=(await f.call('preview',{key})).result.cloud.review;
  f.server.sessions.get(f.cookie.split('=')[1]).review.expires=Date.now()-1;
  assert.equal((await f.call('apply',{key,confirm:true,reviewToken:review.token})).status,409);
  review=(await f.call('preview',{key})).result.cloud.review;
  await f.call('draft',{change:{kind:'device',id:'102',field:'delays.powerOn',value:1600,version:first.result.snapshot.version}});
  assert.equal((await f.call('apply',{key,confirm:true,reviewToken:review.token})).status,409);
  review=(await f.call('preview',{key})).result.cloud.review;
  const saved=await f.call('apply',{key,confirm:true,reviewToken:review.token});assert.equal(saved.status,200);assert.equal(writes,1);assert.equal(saved.result.drafts[0].status,'cloud-saved');
  assert.equal((await f.call('apply',{key,confirm:true,reviewToken:review.token})).status,409);
});
test('saved login automatically reconnects for cloud work; only pre-submission authentication failures retry',async t=>{
  const f=await serverFixture(t);let logins=0,writes=0,expire=false,failAfterSubmit=false;
  f.server.cloudFactory=()=>({target:null,async login(email,password,target){assert.equal(password,'reusable-test-secret');logins++;this.target=target;},close(){this.target=null;},async preview(){if(expire){expire=false;throw new ConfiguratorError('Session expired',401);}return {before:1000,fingerprint:'fingerprint'};},async apply(d,submitted){writes++;submitted();if(failAfterSubmit)throw new ConfiguratorError('Authentication failed after submission',401);}});
  const first=await f.call('refresh',{});
  let state=await f.call('login',{email:'fake@example.invalid',password:'reusable-test-secret',remember:true});assert.equal(state.result.cloud.saved,true);assert.equal(logins,1);
  assert.ok(!JSON.stringify(state.result).includes('reusable-test-secret'));
  await f.call('draft',{change:{kind:'device',id:'101',field:'delays.powerOn',value:1500,version:first.result.snapshot.version}});
  const key='device/101//delays.powerOn';await f.call('logout',{});
  state=await f.call('preview',{key});assert.equal(state.status,200);assert.equal(logins,2);
  expire=true;state=await f.call('preview',{key});assert.equal(state.status,200);assert.equal(logins,3);
  const exported=await f.call('export');assert.ok(!JSON.stringify(exported.result).includes('reusable-test-secret'));assert.equal(exported.result.cloud,undefined);
  failAfterSubmit=true;const before=logins;
  assert.equal((await f.call('apply',{key,confirm:true,reviewToken:state.result.cloud.review.token})).status,401);assert.equal(logins,before);assert.equal(writes,1);
  state=await f.call('state');assert.equal(state.result.drafts[0].status,'unconfirmed');
  state=await f.call('forget-login',{});assert.equal(state.result.cloud.saved,false);assert.equal(state.result.cloud.connected,false);
  await assert.rejects(stat(join(f.directory,'configurator-logitech.key')),{code:'ENOENT'});
});
test('per-input sequence drafts verify the same input on hub refresh',async t=>{
  const f=await serverFixture(t),first=await f.call('refresh',{}),value=[{kind:'command',command:'InputHdmi2',duration:400}];
  const drafted=await f.call('draft',{change:{kind:'device',id:'101',field:'inputCommands',inputName:'HDMI 1',actionSources:[0],value,version:first.result.snapshot.version}});assert.equal(drafted.status,200);
  const inputs=f.imported.resources.DeviceList.DevicesWithFeatures[0].DeviceFeatures[1].Inputs;inputs.reverse();
  let state=await f.call('refresh',{});assert.equal(state.result.drafts[0].status,'draft');
  inputs.find(i=>i.InputName==='HDMI 1').Actions=[{__type:'IRPressAction',IRCommandName:'InputHdmi2',Duration:400,Order:1}];
  state=await f.call('refresh',{});assert.equal(state.result.drafts[0].status,'hub-confirmed');
});
test('saved Logitech login survives a server restart and a new browser session without returning credentials',async t=>{
  const f=await serverFixture(t);let logins=0;
  const factory=()=>({target:null,async login(email,password,target){assert.equal(email,'restart@example.invalid');assert.equal(password,'restart-secret');logins++;this.target=target;},async preview(){return {before:1000,fingerprint:'restart-test'};},close(){this.target=null;}});
  f.server.cloudFactory=factory;
  const first=await f.call('refresh',{});await f.call('login',{email:'restart@example.invalid',password:'restart-secret',remember:true});
  await f.call('draft',{change:{kind:'device',id:'101',field:'delays.powerOn',value:1600,version:first.result.snapshot.version}});
  await f.server.close();
  const restarted=new ConfiguratorServer({directory:f.directory,config:f.server.config,reader:{async read(){return f.imported;},close(){}},cloudFactory:factory});
  await restarted.start();t.after(()=>restarted.close());
  const origin=`http://127.0.0.1:${restarted.port}`, access=new URL(restarted.accessLink().url).hash.slice(8);
  const response=await fetch(`${origin}/api/session`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({access})});
  const cookie=response.headers.get('set-cookie').split(';')[0], {csrf}=await response.json();
  let state=await (await fetch(`${origin}/api/state`,{headers:{Cookie:cookie}})).json();assert.equal(state.cloud.saved,true);assert.equal(state.cloud.connected,false);assert.equal(logins,1);
  const review=await fetch(`${origin}/api/preview`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie,'X-Configurator-CSRF':csrf},body:JSON.stringify({host:'192.0.2.70',revision:state.revision,key:'device/101//delays.powerOn'})});
  assert.equal(review.status,200);state=await review.json();assert.equal(logins,2);assert.equal(state.cloud.connected,true);
  assert.ok(!JSON.stringify(state).includes('restart-secret'));assert.ok(!JSON.stringify(state).includes('restart@example.invalid'));
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
