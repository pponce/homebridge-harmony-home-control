import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSurfaces, mapRequest, mapDocuments, mapView, selectMap, buttonDraft, buttonPatch, buttonValue } from '../lib/configurator/button-cloud.js';
import { COMMON, commandDetails } from '../lib/configurator/device-cloud.js';
import { HarmonyCloud } from '../lib/configurator/cloud.js';
import { parseXml, descendants, identity } from '../lib/configurator/xml.js';
import { modelFixture, envelope } from './configurator-fixtures.js';
const U='http://schemas.datacontract.org/2004/07/Logitech.Harmony.Services.DataContract.UserButtonMapping';
const I='http://www.w3.org/2001/XMLSchema-instance';
const id=(name,n)=>`<u:${name}><c:IsPersisted>true</c:IsPersisted><c:Value>${n}</c:Value></u:${name}>`;
const owner={kind:'activity',id:'401'},surface={remoteId:'800',skinId:'104',surfaceId:'7'};
export const buttonXml=()=>envelope('GetButtonMaps',`<u:AbstractButtonMap xmlns:u="${U}" xmlns:c="${COMMON}" xmlns:i="${I}" xmlns:z="urn:future" i:type="u:ActivityButtonMap">${id('ButtonMapId',501)}<u:ButtonMapIdentifier i:nil="true"/><u:Buttons><u:AbstractRemoteButton i:type="u:HardRemoteButton"><u:ButtonAction i:type="u:ButtonCommandAction" z:metadata="keep"><u:EventType>0</u:EventType><u:Id>action-1</u:Id><u:Order>0</u:Order><u:CommandName>PowerOn</u:CommandName>${id('DeviceId',101)}${id('FunctionId',601)}<z:Extra>untouched</z:Extra></u:ButtonAction><u:ButtonDoublePressAction i:nil="true"/><u:ButtonId>button-1</u:ButtonId><u:ButtonLongPressAction i:type="u:ButtonClientAction"><u:ActionName>Help</u:ActionName></u:ButtonLongPressAction><u:FunctionGroupType>Power</u:FunctionGroupType><u:ButtonKey>Power</u:ButtonKey></u:AbstractRemoteButton></u:Buttons>${id('RemoteId',800)}<u:Sequences>vendor data</u:Sequences>${id('SurfaceId',7)}${id('ActivityId',401)}</u:AbstractButtonMap>`);
const fixture=()=>{const doc=mapDocuments(buttonXml(),owner,surface)[0],map=mapView(doc,owner),s=modelFixture();return {doc,map,s,base:{kind:'button',id:'401',ownerKind:'activity',field:'press',button:{key:'Power',id:'button-1',type:'HardRemoteButton'},mapTarget:map.target,version:s.version}};};
test('button maps use their actual map ID and reject mismatched surfaces, owners and ambiguous documents',()=>{
  const {doc,map}=fixture();assert.equal(map.target.mapId,'501');assert.equal(map.buttons[0].press.deviceId,'101');assert.equal(map.buttons[0].long.kind,'unsupported');
  assert.equal(mapDocuments(buttonXml(),{kind:'activity',id:'999'},surface).length,0);
  assert.equal(mapDocuments(buttonXml(),owner,{...surface,surfaceId:'8'}).length,0);
  assert.equal(mapDocuments(buttonXml(),owner,{...surface,remoteId:'999'}).length,0);
  assert.throws(()=>selectMap([doc,doc],map.target),/ambiguous/);
  const body=mapRequest(owner,surface,'900');assert.match(body,/<deviceIds><\/deviceIds>/);assert.match(body,/i:type="c:ActivityId"/);assert.match(body,/<surfaceId>7<\/surfaceId>/);
});
test('surface lookup selects the paired remote instead of the first account or surface',()=>{
  const xml=`<root><Account><Id><Value>900</Value></Id><Remotes><Remote><Id><Value>799</Value></Id></Remote><Remote><Id><Value>800</Value></Id><SkinId>104</SkinId><Surfaces><Surface><Id><Value>7</Value></Id></Surface><Surface><Id><Value>8</Value></Id></Surface></Surfaces></Remote></Remotes></Account></root>`;
  assert.deepEqual(mapSurfaces(xml,{accountId:'900',remoteId:'800'}),[surface,{...surface,surfaceId:'8'}]);
  assert.throws(()=>mapSurfaces(xml,{accountId:'900',remoteId:'799'}),/unique remote/);
});
test('button edits update function identity and preserve other gestures and unknown metadata',()=>{
  const {doc,map,s,base}=fixture(),change=buttonDraft({...base,value:{kind:'command',deviceId:'101',command:'PowerOff'}},s,[map]);
  const out=buttonPatch(doc.raw,change,[{name:'PowerOff',functionId:'602'}]);
  assert.deepEqual(buttonValue(out,change),change.value);assert.equal(identity(out,descendants(parseXml(out),'ButtonAction')[0],'FunctionId'),'602');assert.match(out,/<u:Id>action-1/);assert.match(out,/z:metadata="keep"/);assert.match(out,/<z:Extra>untouched/);assert.match(out,/<u:ActionName>Help/);assert.match(out,/<u:Sequences>vendor data/);
  assert.throws(()=>buttonPatch(doc.raw,change,[]),/missing or ambiguous/);
  assert.throws(()=>buttonPatch(out,change,[{name:'PowerOff'}]),/changed/);
  assert.throws(()=>buttonDraft({...base,field:'long',value:null},s,[map]),/system action/);
  assert.throws(()=>buttonDraft({...base,value:null},s,[map]),/primary button/);
  assert.throws(()=>buttonDraft({...base,value:{kind:'command',deviceId:'999',command:'Home'}},s,[map]),/device in this map/);
});
test('optional unassigned gestures can receive commands without changing the primary action',()=>{
  const {doc,map,s,base}=fixture(),change=buttonDraft({...base,field:'double',value:{kind:'command',deviceId:'102',command:'Home'}},s,[map]);
  const out=buttonPatch(doc.raw,change,[{name:'Home',functionId:'603'}]);assert.deepEqual(buttonValue(out,change),change.value);assert.deepEqual(buttonValue(out,{...change,field:'press'}),map.buttons[0].press);
  const cleared=buttonPatch(out,{...change,before:change.value,value:null});assert.equal(buttonValue(cleared,change),null);
});
test('nil surface IDs are bound to the verified control surface and populated mismatches are rejected',()=>{
  const {doc,map,s,base}=fixture(),change=buttonDraft({...base,value:{kind:'command',deviceId:'101',command:'PowerOff'}},s,[map]);
  const raw=doc.raw.replace(id('SurfaceId',7),'<u:SurfaceId i:nil="true"/>');
  const out=buttonPatch(raw,change,[{name:'PowerOff'}]),root=parseXml(out).children[0];
  assert.equal(identity(out,root,'SurfaceId'),'7');assert.equal(identity(out,root,'ButtonMapSurfaceId'),'7');
  assert.throws(()=>buttonPatch(doc.raw.replace(id('SurfaceId',7),id('SurfaceId',8)),change,[{name:'PowerOff'}]),/different control surface/);
});
test('button saves require unchanged review and verify readback even when Logitech assigns a new map ID',async()=>{
  const {map,s,base}=fixture(),change=buttonDraft({...base,value:{kind:'command',deviceId:'101',command:'PowerOff'}},s,[map]);let current=buttonXml(),writes=0;
  const cloud=new HarmonyCloud();cloud.readMaps=async()=>mapDocuments(current,owner,surface);cloud.buttonCommands=async()=>[{name:'PowerOff',functionId:'602'}];
  cloud.soap=async(service,name,body)=>{assert.equal(service,'UserButtonMappingManager');assert.equal(name,'SaveButtonMaps');writes++;current=envelope('GetButtonMaps',body.slice('<buttonMaps>'.length,-'</buttonMaps>'.length).replace(id('ButtonMapId',501),id('ButtonMapId',502)));return envelope(name);};
  let review=await cloud.preview(change);current=current.replace('vendor data','new metadata');
  await assert.rejects(cloud.apply(change,()=>{},review),/changed after review/);assert.equal(writes,0);
  review=await cloud.preview(change);await cloud.apply(change,()=>{},review);assert.equal(writes,1);cloud.close();
});
test('IR reads return only supplied command payloads and reject non-infrared profiles',async()=>{
  const xml=envelope('GetCommands',`<KeyValueOfDeviceIdArrayOfCommand><Key><Value>101</Value></Key><Value><Command><Name>PowerOn</Name><Raw>0000 006D 0002</Raw><ProtocolId>9</ProtocolId><Secret>never return</Secret></Command><Command><Name>PowerOff</Name><Raw xmlns:i="${I}" i:nil="true"/></Command></Value></KeyValueOfDeviceIdArrayOfCommand>`);
  assert.equal(commandDetails(xml,'101')[0].raw,'0000 006D 0002');
  assert.equal(commandDetails(xml.replace('0000 006D 0002','\n0000 006D 0002\n'),'101')[0].raw,'\n0000 006D 0002\n');
  const cloud=new HarmonyCloud();let transport='1';cloud.readDevice=async()=>({raw:`<Device><Transport>${transport}</Transport></Device>`});cloud.soap=async()=>xml;
  const result=await cloud.infraredCodes('101');assert.equal(result[0].raw,'0000 006D 0002');assert.equal(result[1].raw,null);assert.ok(!JSON.stringify(result).includes('never return'));
  cloud.soap=async()=>xml.replace('<ProtocolId>9</ProtocolId>','<TransportType>32</TransportType><ProtocolId>9</ProtocolId>');assert.equal((await cloud.infraredCodes('101'))[0].raw,null);
  transport='2';await assert.rejects(cloud.infraredCodes('101'),/infrared/);cloud.close();
});
