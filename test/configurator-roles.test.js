import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY, activityDocument } from '../lib/configurator/activity-cloud.js';
import { rolesRequest, rolesCatalog, rolesValue, validateRoles, checkRoleRemoval, patchRoles } from '../lib/configurator/activity-roles.js';
import { COMMON } from '../lib/configurator/device-cloud.js';
import { HarmonyCloud } from '../lib/configurator/cloud.js';
import { parseXml, descendants, child, field, identity, standalone } from '../lib/configurator/xml.js';
import { draftChange } from '../lib/configurator/model.js';
import { modelFixture,activityXml,envelope } from './configurator-fixtures.js';
import { ownedHousehold,featuresResponse } from './device-cloud-fixtures.js';
const I='http://www.w3.org/2001/XMLSchema-instance';
const id=(name,n)=>`<a:${name}><c:Value>${n}</c:Value></a:${name}>`;
const pass=`<a:AbstractActivityRole xmlns:c="${COMMON}" i:type="a:PassThroughActivityRole">${id('DeviceId',102)}${id('Id',302)}<a:PowerOffOrder>0</a:PowerOffOrder><a:PowerOnOrder>1</a:PowerOnOrder><a:SelectedInput i:nil="true"/></a:AbstractActivityRole>`;
const source=()=>activityXml().replace('</a:Roles>',pass+'</a:Roles>').replace('</a:Activity>','<a:Type>PlayGame</a:Type></a:Activity>');
const raw=()=>activityDocument(source(),{id:'401'}).raw;
const devicesXml=()=>envelope('GetDevices',[101,102].map(n=>`<Device><Id><Value>${n}</Value></Id><DeviceCapabilitiesWithPriority><PrioritizedDeviceCapability xmlns="${COMMON}"><DeviceCapability>Input</DeviceCapability><HasCapability>true</HasCapability></PrioritizedDeviceCapability></DeviceCapabilitiesWithPriority></Device>`).join(''));
const templateXml=(metadata='keep')=>envelope('GetActivityRoles',`<KeyValueOfActivityTypeRoleToDeviceMapping_X><Key>PlayGame</Key><Value><Mapping>${[['DisplayActivityRole',[101]],['VolumeActivityRole',[101]],['PassThroughActivityRole',[101,102]]].map(([type,ids])=>`<KeyValueOfAbstractActivityRoleArrayOfDeviceId_X><Key xmlns:a="${ACTIVITY}" xmlns:i="${I}" i:type="a:${type}"><a:Id i:nil="true"/><a:SelectedInput i:nil="true"/><a:Future>${metadata}</a:Future></Key><Value>${ids.map(n=>`<DeviceId><Value>${n}</Value></DeviceId>`).join('')}</Value></KeyValueOfAbstractActivityRoleArrayOfDeviceId_X>`).join('')}</Mapping></Value></KeyValueOfActivityTypeRoleToDeviceMapping_X>`);
const nextRoles=()=>[{type:'DisplayActivityRole',deviceId:'101',input:'HDMI 1'},{type:'PassThroughActivityRole',deviceId:'102',input:''},{type:'VolumeActivityRole',deviceId:'101',input:'HDMI 1'}];
const catalog=()=>rolesCatalog(templateXml(),raw(),['101','102']);

test('activity role catalog matches the current type and account devices and requests typed IDs with capabilities',()=>{
  const c=catalog(),body=rolesRequest('PlayGame','900',devicesXml(),['101','102']);
  assert.equal(c.activityId,'401');assert.equal(c.type,'PlayGame');assert.equal(c.options.length,3);assert.match(body,/i:type="d:long"/);assert.match(body,/<PrioritizedCapabilities>/);assert.match(body,/HasCapability>true/);
  assert.throws(()=>rolesCatalog(templateXml(),raw(),['101']),/another account/);
  assert.throws(()=>rolesCatalog(templateXml().replace('<Key>PlayGame</Key>','<Key>WatchTV</Key>'),raw(),['101','102']),/unique template/);
  assert.throws(()=>rolesRequest('PlayGame','900',devicesXml().replaceAll('DeviceCapabilitiesWithPriority','Missing'),['101','102']),/capabilities/);
});
test('role drafts require a loaded catalog, required role selections, eligible devices and consistent inputs',()=>{
  const s=modelFixture(),input={kind:'activity',id:'401',field:'roles',value:nextRoles(),version:s.version},c=catalog();
  assert.throws(()=>draftChange(input,s),/Load role choices/);
  const draft=draftChange(input,s,c);assert.equal(draft.label,'Participating devices and roles');assert.equal(draft.cloud.field,'Roles');
  assert.throws(()=>validateRoles(nextRoles().slice(0,2),c,s.devices),/required activity role/);
  assert.throws(()=>validateRoles([...nextRoles(),nextRoles()[0]],c,s.devices),/only once/);
  assert.throws(()=>validateRoles(nextRoles().map(r=>r.type==='VolumeActivityRole'?{...r,deviceId:'102'}:r),c,s.devices),/offered/);
  assert.throws(()=>validateRoles(nextRoles().map(r=>r.type==='VolumeActivityRole'?{...r,input:'HDMI 2'}:r),c,s.devices),/same selected input/);
  assert.throws(()=>validateRoles(nextRoles().map(r=>({...r,input:'unknown'})),c,s.devices),/available input/);
});
test('role updates preserve existing identities and unknown fields, keep type and give shared devices consistent orders',()=>{
  const c=catalog(),change=draftChange({kind:'activity',id:'401',field:'roles',value:nextRoles(),version:modelFixture().version},modelFixture(),c);
  const updated=patchRoles(raw(),change,c),roles=descendants(parseXml(updated),'AbstractActivityRole');
  assert.deepEqual(rolesValue(updated),change.value);assert.equal(field(updated,parseXml(updated).children[0],'Type'),'PlayGame');
  assert.equal(identity(updated,roles.find(r=>r.attributes['i:type']==='a:DisplayActivityRole')),'301');assert.match(updated,/<a:Future z:mode="preserve">unchanged/);assert.match(updated,/<a:Future>keep/);
  const display=roles.find(r=>r.attributes['i:type']==='a:DisplayActivityRole'),volume=roles.find(r=>r.attributes['i:type']==='a:VolumeActivityRole');
  assert.equal(field(updated,display,'PowerOnOrder'),field(updated,volume,'PowerOnOrder'));assert.equal(field(updated,display,'PowerOffOrder'),field(updated,volume,'PowerOffOrder'));
  assert.throws(()=>patchRoles(updated,change,c),/roles changed/);
});
test('device removal blocks action, button and opaque sequence dependencies and unavailable maps',()=>{
  const next=nextRoles().filter(r=>r.deviceId!=='102'),emptyMap={raw:'<Map><Buttons/><Sequences/></Map>'};
  checkRoleRemoval(raw(),next,[emptyMap]);
  assert.throws(()=>checkRoleRemoval(raw(),next,[]),/button maps could not be checked/);
  assert.throws(()=>checkRoleRemoval(raw(),next,[{raw:'<Map><Buttons><Button><DeviceId><Value>102</Value></DeviceId></Button></Buttons></Map>'}]),/button assignments/);
  assert.throws(()=>checkRoleRemoval(raw(),next,[{raw:'<Map><Buttons/><Sequences>opaque</Sequences></Map>'}]),/named sequences/);
  const withAction=raw().replace('</a:Activity>','<a:EnterActions><a:AbstractActivityAction i:type="a:CommandActivityAction">'+id('DeviceId',102)+'</a:AbstractActivityAction></a:EnterActions></a:Activity>');
  assert.throws(()=>checkRoleRemoval(withAction,next,[emptyMap]),/start\/end actions/);
  checkRoleRemoval(raw(),nextRoles(),[]);
});
test('role cloud workflow fetches eligibility, rejects stale template review, preserves one activity and verifies saved roles',async()=>{
  let activity=source(),metadata='first',writes=0;
  const household=ownedHousehold().replace('</Devices>','<Device><Id><Value>102</Value></Id></Device></Devices>');
  const cloud=new HarmonyCloud({fetchImpl:async(url,options)=>{
    const name=options.headers.SOAPAction.split('/').at(-1).replace('"','');
    if(name==='GetMyHousehold') return new Response(household);
    if(name==='SimpleGetActivities') return new Response(activity);
    if(name==='GetDevices') return new Response(devicesXml());
    if(name==='GetActivityRoles') {assert.match(options.body,/<ActivityType[^>]*>PlayGame/);return new Response(templateXml(metadata));}
    if(name==='GetUserFeatures') return new Response(featuresResponse());
    if(name==='SaveActivities') {writes++;const nodes=descendants(parseXml(options.body),'Activity');assert.equal(nodes.length,1);activity=envelope('SimpleGetActivities',standalone(options.body,nodes[0]));return new Response(envelope(name));}
    assert.fail(`Unexpected operation ${name}`);
  }});cloud.target={remoteId:'800',accountId:'900'};
  const publicCatalog=await cloud.activityRoles('401');assert.ok(!Object.hasOwn(publicCatalog,'templates'));assert.ok(!Object.hasOwn(publicCatalog,'fingerprint'));
  const s=modelFixture(),draft=draftChange({kind:'activity',id:'401',field:'roles',value:nextRoles(),version:s.version},s,publicCatalog),review=await cloud.preview(draft);
  metadata='changed';await assert.rejects(cloud.apply(draft,()=>{},review),/changed after review/);assert.equal(writes,0);
  await cloud.apply(draft,()=>{},await cloud.preview(draft));assert.equal(writes,1);assert.deepEqual(rolesValue(activityDocument(activity,{id:'401'}).raw),draft.value);cloud.close();
});
