import test from 'node:test';
import assert from 'node:assert/strict';
import { HarmonyCloud,activityPatch,selectHousehold } from '../lib/configurator/cloud.js';
import { parseXml,descendants,field,identity } from '../lib/configurator/xml.js';
import { draftChange } from '../lib/configurator/model.js';
import { modelFixture,activityXml,householdXml,envelope } from './configurator-fixtures.js';
import { ownedHousehold,deviceResponse,deviceXml,commandsResponse } from './device-cloud-fixtures.js';

test('multi-hub account selection matches both provisioning IDs, never the first account',() => {
  assert.deepEqual(selectHousehold(householdXml(),'800','900'),{remoteId:'800',accountId:'900'});
  assert.throws(()=>selectHousehold(householdXml(),'800','901'),/does not contain/);
});
test('activity edits preserve unknown XML, inputs, nested names and namespace scope',() => {
  const s=modelFixture(),change=draftChange({kind:'activity',id:'401',field:'name',value:'Games & TV',version:s.version},s),xml=activityXml();
  const updated=activityPatch(xml,change),root=parseXml(updated).children[0];
  assert.equal(field(updated,root,'Name'),'Games & TV');assert.ok(updated.includes('Games &amp; TV'));assert.ok(updated.includes('<a:Future z:mode="preserve">unchanged</a:Future>'));assert.ok(updated.includes('<a:Name>HDMI 1</a:Name>'));assert.equal(root.namespaces.z,'urn:future');
  assert.equal(identity(updated,root),'401');assert.throws(()=>activityPatch(xml,{...change,before:'Already changed'}),/changed since import/);
  const role=draftChange({kind:'activity',id:'401',field:'powerOnOrder',role:0,value:3,version:s.version},s);const patched=activityPatch(xml,role);
  assert.ok(patched.includes('<a:PowerOnOrder>3</a:PowerOnOrder>'));assert.ok(patched.includes('<a:PowerOffOrder>1</a:PowerOffOrder>'));
  assert.throws(()=>activityPatch(xml,{...role,roleTarget:{...role.roleTarget,id:'wrong'}}),/differs/);
});
test('XML fails closed on expanding entities, malformed nesting and absent edit fields',() => {
  assert.throws(()=>parseXml('<!DOCTYPE x [<!ENTITY x "bad">]><x>&x;</x>'),/Unsupported/);
  assert.throws(()=>parseXml('<x><a></x>'),/Malformed/);
  const s=modelFixture(),change=draftChange({kind:'activity',id:'401',field:'name',value:'New',version:s.version},s);
  assert.throws(()=>activityPatch(activityXml().replace('<a:Name>Play a game</a:Name>','<a:Name i:nil="true"/>'),change),/changed since import|missing/);
});
test('cloud auth exchanges tokens only with Logitech, saves a single activity, reads it back and syncs in contract order',async () => {
  const calls=[],s=modelFixture();let saved=false;
  const cloud=new HarmonyCloud({fetchImpl:async(url,options)=>{
    calls.push({url,...options});
    if(url.includes('ProceedWithLIPLogin')) {assert.deepEqual(JSON.parse(options.body),{email:'fake@example.invalid',password:'fake-password'});assert.equal(options.headers.Cookie,undefined);return new Response(JSON.stringify(JSON.stringify({id_token:'fake-id',access_token:'fake-access'})));}
    if(url.includes('json2/signin')) {assert.deepEqual(JSON.parse(options.body),{id_token:'fake-id',access_token:'fake-access'});return new Response('{}',{headers:{'Set-Cookie':'harmony=fake-cookie; Path=/; Secure'}});}
    assert.equal(options.headers.Cookie,'harmony=fake-cookie');assert.equal(options.redirect,'error');
    const name=options.headers.SOAPAction.split('/').at(-1).replace('"','');
    if(name==='GetMyHousehold')return new Response(householdXml());
    if(name==='SimpleGetActivities')return new Response(activityXml(saved?'New game':'Play a game'));
    if(name==='SaveActivities'){saved=true;const root=parseXml(options.body);assert.equal(descendants(root,'Activity').length,1);assert.ok(options.body.includes('unchanged'));return new Response(envelope(name));}
    if(name==='IsRemoteSyncRequired')return new Response(envelope(name,'false'));
    return new Response(envelope(name));
  }});
  await cloud.login('fake@example.invalid','fake-password',{remoteId:'800',accountId:'900'});
  const change=draftChange({kind:'activity',id:'401',field:'name',value:'New game',version:s.version},s);
  await cloud.apply(change,()=>{},await cloud.preview(change));
  let triggers=0;
  await cloud.sync(()=>{},async(target,signal)=>{triggers++;assert.deepEqual(target,{remoteId:'800',accountId:'900'});assert.equal(signal.aborted,false);assert.ok(calls.at(-1).headers.SOAPAction.includes('SetRemoteSyncRequired'));});
  assert.equal(triggers,1);
  const ops=calls.filter(c=>c.headers.SOAPAction).map(c=>c.headers.SOAPAction.split('/').at(-1).replace('"',''));
  assert.deepEqual(ops,['GetMyHousehold','GetMyHousehold','SimpleGetActivities','GetMyHousehold','SimpleGetActivities','SaveActivities','GetMyHousehold','SimpleGetActivities','StartCompileWithLocale','SetRemoteSyncRequired']);
  assert.ok(calls.find(c=>c.headers.SOAPAction?.includes('StartCompileWithLocale')).body.includes('<localeId>en-US</localeId>'));

  cloud.close();assert.equal(cloud.cookies.size,0);assert.equal(cloud.target,null);
});
test('SOAP faults and authentication errors do not expose response bodies',async () => {
  const cloud=new HarmonyCloud({fetchImpl:async()=>new Response('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultstring>private-token-do-not-echo</faultstring></s:Fault></s:Body></s:Envelope>')});
  await assert.rejects(cloud.soap('AccountManager','GetMyHousehold'),error=>/rejected/.test(error.message)&&!error.message.includes('private-token'));
  const denied=new HarmonyCloud({fetchImpl:async()=>new Response('password-and-cookie-in-body',{status:401})});
  await assert.rejects(denied.login('fake@example.invalid','password',{remoteId:'800',accountId:'900'}),error=>error.message.includes('HTTP 401')&&!error.message.includes('password-and-cookie'));
});

test('IR and button-map loads declare numeric ID types on every outgoing SOAP request',async()=>{
  const calls=[],cloud=new HarmonyCloud({fetchImpl:async(url,options)=>{
    const name=options.headers.SOAPAction.split('/').at(-1).replace('"','');calls.push(name);
    const root=parseXml(options.body),values=descendants(root,'Value');
    for(const n of values) {
      const type=Object.entries(n.attributes).find(([key])=>key.endsWith(':type'))?.[1];
      assert.ok(type,`${name} must declare the numeric ID type`);
      assert.equal(type.split(':')[1],'long');assert.equal(n.namespaces[type.split(':')[0]],'http://www.w3.org/2001/XMLSchema');
    }
    if(name==='GetMyHousehold') return new Response(ownedHousehold().replace('<Remote><Id><Value>800</Value></Id>','<Remote><Id><Value>800</Value></Id><SkinId>104</SkinId><Surfaces><Surface><Id><Value>7</Value></Id></Surface></Surfaces>'));
    assert.ok(values.length>0);
    if(name==='GetDevice') return new Response(deviceResponse(deviceXml()));
    if(name==='GetCommands') return new Response(commandsResponse());
    if(name==='GetButtonMaps') {assert.match(options.body,/<activityIds><\/activityIds>/);return new Response(envelope(name));}
    assert.fail(`Unexpected operation ${name}`);
  }});
  cloud.target={accountId:'900',remoteId:'800'};
  assert.equal((await cloud.infraredCodes('101')).length,4);
  assert.deepEqual(await cloud.buttonMaps({kind:'device',id:'101'}),[]);
  assert.deepEqual(calls,['GetMyHousehold','GetDevice','GetCommands','GetMyHousehold','GetButtonMaps']);cloud.close();
});

test('read faults identify the operation and numeric code without exposing fault details or suggesting a change',async()=>{
  for(const status of [200,500]) {
    const cloud=new HarmonyCloud({fetchImpl:async()=>new Response('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultstring>private-account-and-token</faultstring><detail><ErrorCode>2001</ErrorCode><Secret>private-password</Secret></detail></s:Fault></s:Body></s:Envelope>',{status})});
    for(const name of ['GetDevice','GetCommands','GetButtonMaps']) await assert.rejects(cloud.soap('DeviceManager',name),error=>{
      assert.equal(error.message,`Logitech rejected ${name} (code 2001). The requested data could not be loaded.`);return true;
    });
    cloud.close();
  }
});
