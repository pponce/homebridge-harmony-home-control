import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSurfaces, mapRequest, mapDocuments, mapView, selectMap, buttonDraft, buttonPatch, buttonValue, canvasDocuments } from '../lib/configurator/button-cloud.js';
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
  const {doc,map}=fixture();assert.equal(map.target.mapId,'501');assert.equal(map.buttons[0].press.deviceId,'101');assert.deepEqual(map.buttons[0].long,{kind:'system',name:'Help'});
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
  const cleared=buttonDraft({...base,field:'long',value:null},s,[map]);assert.equal(buttonValue(buttonPatch(doc.raw,cleared),cleared),null);
  assert.throws(()=>buttonDraft({...base,value:null},s,[map]),/primary button/);
  assert.throws(()=>buttonDraft({...base,value:{kind:'command',deviceId:'999',command:'Home'}},s,[map]),/device in this map/);
});

test('adding a physical button requires its remote catalog, preserves the map and reads back after ID allocation',()=>{
  const {doc,map,s,base}=fixture(),canvas=canvasDocuments(buttonXml().replace('<u:ButtonKey>Power</u:ButtonKey>','<u:ButtonKey>Menu</u:ButtonKey>'));
  const catalog={ownerKind:'activity',ownerId:'401',remoteId:'800',skinId:'104',buttons:canvas.map(d=>d.button)};
  const input={...base,field:'add',button:{key:'Menu'},value:{kind:'command',deviceId:'101',command:'PowerOff'}};
  assert.throws(()=>buttonDraft(input,s,[map]),/catalog/);
  assert.throws(()=>buttonDraft(input,s,[map],{...catalog,remoteId:'wrong'}),/catalog/);
  const change=buttonDraft(input,s,[map],catalog),out=buttonPatch(doc.raw,change,[{name:'PowerOff',functionId:'602'}],canvas);
  assert.equal(mapView({raw:out,target:map.target},owner).buttons.length,2);assert.deepEqual(buttonValue(out,change),change.value);
  assert.deepEqual(buttonValue(out.replace('<u:ButtonId>0</u:ButtonId>','<u:ButtonId>allocated-id</u:ButtonId>'),change),change.value);
  assert.match(out,/<u:Sequences>vendor data/);assert.match(out,/<z:Extra>untouched/);
  assert.throws(()=>buttonPatch(out,change,[{name:'PowerOff'}],canvas),/changed/);
  assert.throws(()=>buttonPatch(doc.raw,change,[{name:'PowerOff'}],[]),/not available/);
});

test('system assignments accept only names reported for the same remote button and gesture',()=>{
  const {doc,map,s,base}=fixture();
  const xml=buttonXml().replace(/<u:ButtonAction\b[\s\S]*?<\/u:ButtonAction>/,'<u:ButtonAction i:type="u:ButtonClientAction"><u:EventType>7</u:EventType><u:Id>0</u:Id><u:Order>0</u:Order><u:ActionName>Help</u:ActionName><z:CatalogMetadata>retain</z:CatalogMetadata></u:ButtonAction>');
  const canvas=canvasDocuments(xml),catalog={ownerKind:'activity',ownerId:'401',remoteId:'800',skinId:'104',buttons:canvas.map(d=>d.button)},input={...base,value:{kind:'system',name:'Help'}};
  assert.throws(()=>buttonDraft(input,s,[map]),/remote catalog/);
  const change=buttonDraft(input,s,[map],catalog),out=buttonPatch(doc.raw,change,[],canvas);
  assert.deepEqual(buttonValue(out,change),change.value);assert.match(out,/<u:EventType>7/);assert.match(out,/<z:CatalogMetadata>retain/);
  assert.throws(()=>buttonPatch(doc.raw,change,[],[]),/remote catalog/);
  assert.throws(()=>buttonDraft({...input,value:{kind:'system',name:'UnverifiedAction'}},s,[map],catalog),/remote catalog/);
  assert.throws(()=>buttonDraft({...input,field:'double'},s,[map],catalog),/remote catalog/);
  assert.match(out,/<u:ButtonLongPressAction/);assert.match(out,/<u:Sequences>vendor data/);
});

test('touchscreen edits preserve actions and icons, escape labels and reorder only existing positions in a menu',()=>{
  const {doc,map,s,base}=fixture();
  const soft=(id,label,position)=>`<u:AbstractRemoteButton i:type="u:SoftRemoteButton" z:future="keep"><u:ButtonAction i:type="u:ButtonCommandAction"><u:CommandName>PowerOn</u:CommandName>${'<u:DeviceId><c:Value>101</c:Value></u:DeviceId>'}</u:ButtonAction><u:ButtonId>${id}</u:ButtonId><u:ButtonImageKey>keep-icon</u:ButtonImageKey><u:MenuItem><u:IndexInMenu>${position}</u:IndexInMenu><u:MenuName>Main</u:MenuName></u:MenuItem><u:TextOnRemote>${label}</u:TextOnRemote></u:AbstractRemoteButton>`;
  const raw=doc.raw.replace('</u:Buttons>',soft('soft-1','TV',1)+soft('soft-2','Movies',2)+'</u:Buttons>'),view=mapView({...doc,raw},owner),next=structuredClone(view.layout);
  next[0].label='TV & games';next[0].position=2;next[1].position=1;
  const change=buttonDraft({...base,field:'layout',value:next},s,[view]),out=buttonPatch(raw,change);
  assert.deepEqual(buttonValue(out,change),change.value);assert.match(out,/TV &amp; games/);assert.match(out,/<u:ButtonImageKey>keep-icon/);assert.match(out,/z:future="keep"/);assert.match(out,/<u:Sequences>vendor data/);
  const bad=structuredClone(next);bad[1].position=2;assert.throws(()=>buttonDraft({...base,field:'layout',value:bad},s,[view]),/existing positions/);
  bad[1].position=1;bad[1].menu='New';assert.throws(()=>buttonDraft({...base,field:'layout',value:bad},s,[view]),/current menu/);
  assert.throws(()=>buttonDraft({...base,field:'layout',value:[]},s,[view]),/layout/);
  assert.equal(map.layout,null);
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
const irResponse=commands=>envelope('GetCommands',`<KeyValueOfDeviceIdArrayOfCommand><Key><Value>101</Value></Key><Value>${commands}</Value></KeyValueOfDeviceIdArrayOfCommand>`);
test('command codes preserve keycodes, raw data and supplied metadata',()=>{
  const xml=irResponse(`<Command><Name>PowerOn</Name><KeyCode>\nG:Sony 12 Bit:()(0x8D1)():3\n</KeyCode><Raw xmlns:i="${I}" i:nil="true"/><IsLearned>false</IsLearned><ProtocolId>9</ProtocolId><TransportType>32</TransportType></Command><Command><Name>Learned</Name><Raw>\n0000 006D 0002\n</Raw><KeyCode>encoded &amp; &lt;command&gt;</KeyCode><IsLearned>true</IsLearned></Command>`);
  const result=commandDetails(xml,'101');
  assert.equal(result[0].keyCode,'\nG:Sony 12 Bit:()(0x8D1)():3\n');assert.equal(result[0].keyCodeState,'supplied');assert.equal(result[0].rawState,'not-supplied');assert.equal(result[0].learned,false);
  assert.equal(result[0].protocolId,'9');assert.equal(result[0].transport,'32');
  assert.equal(result[1].raw,'\n0000 006D 0002\n');assert.equal(result[1].rawState,'supplied');assert.equal(result[1].keyCode,'encoded & <command>');assert.equal(result[1].learned,true);
});
test('command codes distinguish absent, nil and blank values from unsupported structures',()=>{
  const result=commandDetails(irResponse(`<Command><Name>Absent</Name><IsLearned>unknown</IsLearned></Command><Command xmlns:i="${I}"><Name>Nil</Name><Raw i:nil="true">ignored</Raw><KeyCode i:nil="1">ignored</KeyCode></Command><Command><Name>Empty</Name><Raw> \n </Raw><KeyCode/></Command><Command><Name>Structured</Name><Raw><Bytes>not a scalar</Bytes></Raw><KeyCode><Encoding>not a scalar</Encoding></KeyCode></Command>`),'101');
  for(const code of result.slice(0,3)) {assert.equal(code.rawState,'not-supplied');assert.equal(code.keyCodeState,'not-supplied');assert.equal(code.learned,null);}
  assert.equal(result[1].raw,'');assert.equal(result[1].keyCode,'');
  assert.equal(result[3].rawState,'unsupported');assert.equal(result[3].keyCodeState,'unsupported');assert.equal(result[3].raw,'');assert.equal(result[3].keyCode,'');
});
test('IR reads retain command code data regardless of transport metadata and reject non-infrared profiles',async()=>{
  const xml=irResponse(`<Command><Name>PowerOn</Name><KeyCode>G:Sony 12 Bit:()(0x8D1)():3</KeyCode><ProtocolId>9</ProtocolId><TransportType>32</TransportType><IsLearned>false</IsLearned><Secret>never return</Secret></Command><Command><Name>PowerOff</Name><Raw>\n0000 006D 0002\n</Raw><TransportType>unknown</TransportType></Command><Command><Name>No codes</Name></Command><Command><Name>Structured</Name><KeyCode><Private>never return</Private></KeyCode></Command>`);
  const cloud=new HarmonyCloud();let transport='1',reads=0;cloud.readDevice=async()=>({raw:`<Device><Transport>${transport}</Transport></Device>`});cloud.soap=async(service,operation)=>{assert.equal(service,'DeviceManager');assert.equal(operation,'GetCommands');reads++;return xml;};
  const result=await cloud.infraredCodes('101');assert.equal(result[0].raw,null);assert.equal(result[0].keyCode,'G:Sony 12 Bit:()(0x8D1)():3');assert.equal(result[0].learned,false);assert.equal(result[0].transport,'32');assert.equal(result[1].raw,'\n0000 006D 0002\n');assert.equal(result[1].transport,'unknown');
  assert.equal(result[2].raw,null);assert.equal(result[2].keyCode,null);assert.equal(result[2].learned,null);assert.equal(result[3].keyCode,null);assert.equal(result[3].keyCodeState,'unsupported');assert.ok(!JSON.stringify(result).includes('never return'));
  transport='2';await assert.rejects(cloud.infraredCodes('101'),/infrared/);assert.equal(reads,1);cloud.close();
});
