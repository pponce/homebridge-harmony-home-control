import test from 'node:test';
import assert from 'node:assert/strict';
import { HarmonyCloud } from '../lib/configurator/cloud.js';
import { deviceDocument, devicePatch, deviceValue, deviceSaveBody, ownedDevice, commandNames } from '../lib/configurator/device-cloud.js';
import { parseXml, child, children, descendants, field, identity, standalone } from '../lib/configurator/xml.js';
import { draftChange } from '../lib/configurator/model.js';
import { modelFixture, envelope } from './configurator-fixtures.js';
import { inputFeature, powerFeature, deviceXml, deviceResponse, featuresResponse, commandsResponse, ownedHousehold, deviceNS, featureNS, commonNS } from './device-cloud-fixtures.js';

const target={accountId:'900',remoteId:'800'};
const draft=(field,value,extra={})=>{const s=modelFixture();return draftChange({kind:'device',id:'101',version:s.version,field,value,...extra},s);};
const root=raw=>parseXml(raw).children[0];
const commands=['PowerOn','PowerOff','InputHdmi1','InputHdmi2'];

test('device writes preserve vendor members, namespace scope and schema order for missing fields',()=>{
  const change=draft('delays.interKey',250), raw=deviceDocument(deviceResponse(deviceXml()),change).raw;
  const updated=devicePatch(raw,change), n=root(updated);
  assert.equal(field(updated,n,'InterKeyDelay'),'250');assert.equal(field(updated,n,'InterDeviceDelay'),'500');assert.equal(field(updated,n,'Name'),'Living room display');
  assert.ok(updated.includes('<z:Future z:keep="yes">do not change</z:Future>'));assert.equal(n.namespaces.z,'urn:future');
  const account=ownedDevice(ownedHousehold(),target,'101'), body=deviceSaveBody(updated,change,account), operation=root(body), device=child(operation,'Device');
  assert.equal(operation.attributes['i:type'],'o:UpdateUserDeviceOperation');
  assert.equal(child(operation,'ParentAccount').namespaces[child(operation,'ParentAccount').qname.split(':')[0]],`${commonNS}.Operation`);
  assert.equal(identity(body,operation,'ParentAccount'),'900');assert.equal(identity(body,device),'101');
  assert.equal(device.namespaces[device.qname.split(':')[0]],`${deviceNS}.Operation`);
  assert.equal(child(device,'InterKeyDelay').namespaces.d,deviceNS);
  const missing=raw.replace('<d:InterKeyDelay>100</d:InterKeyDelay>','');
  const inserted=devicePatch(missing,{...change,before:null});
  assert.ok(inserted.indexOf('<InterKeyDelay ')<inserted.indexOf('<d:Manufacturer>'));assert.equal(field(inserted,root(inserted),'InterKeyDelay'),'250');
  for(const fieldXml of ['<d:InterKeyDelay/>','<d:InterKeyDelay i:nil="true"/>']) {
    const patched=devicePatch(raw.replace('<d:InterKeyDelay>100</d:InterKeyDelay>',fieldXml),{...change,before:null});assert.equal(field(patched,root(patched),'InterKeyDelay'),'250');
    assert.ok(!child(root(patched),'InterKeyDelay').attributes['i:nil']);
  }
  assert.throws(()=>devicePatch(raw.replace('<d:Transport>1</d:Transport>','<d:Transport>32</d:Transport>'),draft('controlPort','2')),/infrared/);
});
test('feature saves preserve inputs and unknown fields while changing policy, timing or order',()=>{
  for(const [name,next,xmlField] of [['delays.powerOn',1500,'PowerOnDelay'],['power.alwaysOn',true,'IsPowerAlwaysOn'],['power.betweenActivities',false,'IsPoweredOnBetweenActivities'],['power.type',3,'PowerTypeId']]) {
    const change=draft(name,next), raw=deviceDocument(featuresResponse(),change).raw, updated=devicePatch(raw,change);
    assert.equal(field(updated,root(updated),xmlField),String(next));assert.ok(updated.includes('retain action metadata'));
    const body=deviceSaveBody(updated,change);assert.equal(descendants(parseXml(body),'DeviceFeature').length,1);assert.ok(body.includes('do not change'));
  }
  const change=draft('inputOrder',['HDMI 2','HDMI 1']), raw=deviceDocument(featuresResponse(),change).raw, updated=devicePatch(raw,change);
  const inputs=children(child(root(updated),'Inputs'),'Input');
  assert.deepEqual(inputs.map(n=>[field(updated,n,'InputName'),field(updated,n,'InputOrder')]),[['HDMI 1','2'],['HDMI 2','1']]);
  assert.equal(field(updated,descendants(inputs[0],'AbstractIRAction')[0],'IRCommandName'),'InputHdmi1');
  assert.ok(updated.includes('<z:Other>preserve input metadata</z:Other>'));
  assert.throws(()=>devicePatch(raw.replace('HDMI 2','HDMI 3'),change),/changed/);
  assert.throws(()=>ownedDevice(ownedHousehold(),target,'102'),/not in/);
  assert.throws(()=>ownedDevice(ownedHousehold(),{...target,accountId:'901'},'101'),/no longer matches/);
  assert.throws(()=>deviceDocument(featuresResponse().replaceAll('<c:Value>101</c:Value>','<c:Value>999</c:Value>'),change),/missing or ambiguous/);
});
test('input sequence editing preserves source metadata, escapes names and rejects unknown actions/commands',()=>{
  const change=draft('inputCommands',[{kind:'delay',delay:250},{kind:'command',command:'InputHdmi2',duration:500}],{inputName:'HDMI 1',actionSources:[null,0]});
  const raw=deviceDocument(featuresResponse(),change).raw, updated=devicePatch(raw,change,commands), inputs=children(child(root(updated),'Inputs'),'Input');
  const rows=children(child(inputs[0],'Actions'),'AbstractIRAction');
  assert.deepEqual(rows.map(n=>field(updated,n,'Order')),['1','2']);
  assert.equal(field(updated,rows[0],'ActionId'),'3');assert.equal(field(updated,rows[0],'Delay'),'250');
  assert.equal(field(updated,rows[1],'ActionId'),'42');assert.equal(field(updated,rows[1],'Duration'),'500');assert.equal(rows[1].attributes['z:keep'],'yes');
  assert.equal(field(updated,rows[1],'IRCommandName'),'InputHdmi2');assert.ok(updated.includes('retain action metadata'));
  assert.equal(field(updated,descendants(inputs[1],'AbstractIRAction')[0],'IRCommandName'),'InputHdmi2');
  const special={...change,value:[{kind:'command',command:'A & <B>',duration:null}],actionSources:[0]};
  const escaped=devicePatch(raw,special,['A & <B>']);assert.ok(escaped.includes('A &amp; &lt;B&gt;'));
  assert.throws(()=>devicePatch(raw,change,['PowerOn']),/unavailable/);
  assert.throws(()=>devicePatch(raw.replaceAll('u:IRPressAction','u:IRDevAction'),{...change,before:null,actionSources:[null,null]},commands),/unsupported action/);
  assert.throws(()=>devicePatch(raw,{...change,actionSources:[0,0]},commands),/sequence changed/);
  assert.deepEqual(commandNames(commandsResponse(),'101'),commands);
});
test('missing and empty sequences are distinct; shared actions and power sequences can be saved',()=>{
  const change=draft('inputActions.start',[{kind:'command',command:'InputHdmi1',duration:null}],{actionSources:[null]});
  for(const raw of [inputFeature(),inputFeature().replace('<u:StartActions/>','<u:StartActions i:nil="true"/>'),inputFeature().replace('<u:StartActions/>','')]) {
    const updated=devicePatch(raw,change,commands), node=child(root(updated),'StartActions'), action=children(node,'AbstractIRAction')[0];
    assert.equal(action.namespaces[action.qname.split(':').length===1?'':action.qname.split(':')[0]],featureNS);
    assert.equal(field(updated,action,'IRCommandName'),'InputHdmi1');assert.equal(child(action,'Duration').attributes['i:nil'],'true');
    assert.deepEqual(deviceValue(updated,change),change.value);
    const cleared=devicePatch(updated,{...change,before:change.value,value:[],actionSources:[]},commands);assert.deepEqual(deviceValue(cleared,change),[]);
  }
  const power=draft('power.on',[{kind:'command',command:'PowerOn',duration:800}],{actionSources:[0]});
  const updated=devicePatch(powerFeature(),power,commands);assert.equal(field(updated,descendants(root(updated),'AbstractIRAction')[0],'Duration'),'800');
});
test('method changes require commands and a known cloud representation; unrecognized enums are never guessed',()=>{
  const change=draft('inputMethod','2'), raw=inputFeature();
  assert.equal(field(devicePatch(raw,change),root(devicePatch(raw,change)),'InputType'),'2');
  assert.throws(()=>devicePatch(raw.replace('<u:InputType>1</u:InputType>','<u:InputType>Discrete</u:InputType>'),change),/representation/);
  assert.throws(()=>devicePatch(raw.replace(/<u:NextActions>.*?<\/u:NextActions>/,'<u:NextActions/>'),change),/required Next/);
  assert.throws(()=>devicePatch(raw,draft('inputMethod','4')),/Start input selection/);
});
test('cloud API reads ownership, reviews, saves one feature and verifies; stale documents block submission',async()=>{
  let documents=[inputFeature(),powerFeature()],writes=0;const calls=[];
  const cloud=new HarmonyCloud({fetchImpl:async(url,options)=>{
    const name=options.headers.SOAPAction.split('/').at(-1).replace('"','');calls.push(name);
    if(name==='GetMyHousehold') return new Response(ownedHousehold());
    if(name==='GetUserFeatures') return new Response(featuresResponse(documents));
    if(name==='GetCommands') return new Response(commandsResponse());
    if(name==='SaveUserFeatures') {
      assert.ok(url.includes('/UserFeaturePlatform/UserFeatureManager.svc'));writes++;
      const nodes=descendants(parseXml(options.body),'DeviceFeature');assert.equal(nodes.length,1);
      documents=[standalone(options.body,nodes[0]),documents[1]];return new Response(envelope(name));
    }
    throw new Error('Unexpected call '+name);
  }});cloud.target=target;
  const change=draft('inputCommands',[{kind:'command',command:'InputHdmi2',duration:400}],{inputName:'HDMI 1',actionSources:[0]});
  let review=await cloud.preview(change);assert.deepEqual(review.before,change.before);assert.equal(writes,0);
  documents[0]=documents[0].replace('do not change','concurrent metadata change');
  let submitted=false;await assert.rejects(cloud.apply(change,()=>{submitted=true;},review),/changed after review/);assert.equal(submitted,false);assert.equal(writes,0);
  review=await cloud.preview(change);await cloud.apply(change,()=>{submitted=true;},review);assert.equal(writes,1);assert.equal(submitted,true);
  assert.deepEqual(deviceValue(documents[0],change),change.value);assert.ok(documents[0].includes('concurrent metadata change'));
  assert.deepEqual(calls.slice(-6),['GetMyHousehold','GetUserFeatures','GetCommands','SaveUserFeatures','GetMyHousehold','GetUserFeatures']);cloud.close();
});
test('device operation sends the owned account and verifies its reread; mismatches remain failures after submission',async()=>{
  let doc=deviceXml(),ignoreWrite=false;
  const cloud=new HarmonyCloud({fetchImpl:async(url,options)=>{
    const name=options.headers.SOAPAction.split('/').at(-1).replace('"','');
    if(name==='GetMyHousehold') return new Response(ownedHousehold());
    if(name==='GetDevice') return new Response(deviceResponse(doc));
    if(name==='UpdateMyData') {
      assert.ok(url.includes('/HarmonyPlatform/DeviceManager.svc'));
      const op=descendants(parseXml(options.body),'operation')[0];assert.equal(identity(options.body,op,'ParentAccount'),'900');
      const device=child(op,'Device'), raw=standalone(options.body,device);if(!ignoreWrite) doc=raw.replaceAll(device.qname,'GetDeviceResult');
      return new Response(envelope(name));
    }
    throw new Error('Unexpected call');
  }});cloud.target=target;
  let change=draft('repeats',3),review=await cloud.preview(change);await cloud.apply(change,()=>{},review);assert.equal(field(doc,root(doc),'PressMinRepeats'),'3');
  change={...change,before:3,value:4};review=await cloud.preview(change);ignoreWrite=true;let submitted=false;
  await assert.rejects(cloud.apply(change,()=>{submitted=true;},review),/did not return/);assert.equal(submitted,true);cloud.close();
});
