import test from 'node:test';
import assert from 'node:assert/strict';
import { draftChange, project } from '../lib/configurator/model.js';
import { activityDocument, activityValue, activityPatchDocument, ACTIVITY } from '../lib/configurator/activity-cloud.js';
import { HarmonyCloud } from '../lib/configurator/cloud.js';
import { parseXml, child, children, field, identity } from '../lib/configurator/xml.js';
import { modelFixture, nativeFixture, activityXml, envelope } from './configurator-fixtures.js';

const draft=(field,value,extra={})=>{const s=modelFixture();return draftChange({kind:'activity',id:'401',field,value,version:s.version,...extra},s);};
const sequenceXml=()=>activityXml().replace('<a:Future',`<a:EnterActions><a:AbstractActivityAction i:type="a:DelayActivityAction" z:extra="keep"><a:ActionOrder>0</a:ActionOrder><a:Id>action-7</a:Id><a:Duration>500</a:Duration><z:Future>retained</z:Future></a:AbstractActivityAction></a:EnterActions><a:Future`);
test('activity projection reads typed action order, device references and delay duration',()=>{
  const source=nativeFixture();source.resources.ActivityList.Activities[0].EnterActions=[{__type:'CommandActivityAction',ActionOrder:1,DeviceId:{Value:101},CommandName:'PowerOn'},{__type:'DelayActivityAction',ActionOrder:0,Duration:600}];
  const s=project(source),d=draftChange({kind:'activity',id:'401',field:'enter',value:[],actionSources:[],version:s.version},s);
  assert.deepEqual(d.before,[{kind:'delay',delay:600},{kind:'command',command:'PowerOn',deviceId:'101'}]);
  assert.equal(s.activities[0].enter[1].duration,null);
  for(const value of [[{kind:'command',deviceId:'999',command:'PowerOn'}],[{kind:'command',deviceId:'101',command:'Invented'}],[{kind:'command',deviceId:'101',command:'PowerOn',duration:20}],[{kind:'delay',delay:-1}]]) assert.throws(()=>draft('leave',value,{actionSources:[null]}),/available commands/);
});
test('start actions preserve retained IDs and metadata while adding device commands and reordering',()=>{
  const change=draft('enter',[{kind:'command',deviceId:'101',command:'PowerOn'},{kind:'delay',delay:800}],{actionSources:[null,0]});
  const doc=activityDocument(sequenceXml(),change),out=activityPatchDocument(doc.raw,change,{'101':['PowerOn']}),root=parseXml(out).children[0];
  assert.deepEqual(activityValue(out,change),change.value);
  assert.match(out,/<a:Id>action-7<\/a:Id>/);assert.match(out,/z:extra="keep"/);assert.match(out,/<z:Future>retained/);assert.match(out,/<a:Name>HDMI 1/);
  const rows=children(child(root,'EnterActions'),'AbstractActivityAction');
  assert.equal(field(out,rows[1],'ActionOrder'),'1');assert.equal(identity(out,rows[0],'DeviceId'),'101');
  assert.throws(()=>activityPatchDocument(doc.raw,change,{'101':[]}),/available/);
  assert.throws(()=>activityPatchDocument(doc.raw,{...change,actionSources:[0,null]},{'101':['PowerOn']}),/Remove and add/);
  const emptied=activityPatchDocument(doc.raw,draft('enter',[],{actionSources:[]}));assert.deepEqual(activityValue(emptied,change),[]);
});
test('missing and nil activity sequences can be populated after cloud review without inventing a before value',()=>{
  const source=nativeFixture();delete source.resources.ActivityList.Activities[0].LeaveActions;
  const s=project(source),change=draftChange({kind:'activity',id:'401',field:'leave',value:[{kind:'delay',delay:1000}],actionSources:[null],version:s.version},s);
  assert.equal(change.before,null);assert.equal(change.cloud.field,'LeaveActions');
  for(const xml of [activityXml(),activityXml().replace('<a:Name>Play a game','<a:LeaveActions i:nil="true"/><a:Name>Play a game')]) {
    const out=activityPatchDocument(activityDocument(xml,change).raw,change);assert.deepEqual(activityValue(out,change),change.value);assert.equal(parseXml(out).children[0].namespaces.a,ACTIVITY);
  }
});
test('selected inputs and missing role delays are editable with role identity and input validation',()=>{
  const change=draft('input','HDMI 2',{role:0}),doc=activityDocument(activityXml(),change);
  const out=activityPatchDocument(doc.raw,change,{},['HDMI 1','HDMI 2']);assert.equal(activityValue(out,change),'HDMI 2');
  const role=children(child(parseXml(out).children[0],'Roles'),'AbstractActivityRole')[0];
  assert.equal(identity(out,child(role,'SelectedInput')),'');assert.equal(field(out,role,'PowerOnOrder'),'0');
  assert.throws(()=>activityPatchDocument(doc.raw,change,{},['HDMI 1']),/input is unavailable/);
  assert.throws(()=>activityPatchDocument(doc.raw,{...change,roleTarget:{...change.roleTarget,deviceId:'102'}},{},['HDMI 2']),/differs/);
  const delay={...draft('nextDeviceDelay',200,{role:0}),before:null};const delayed=activityPatchDocument(doc.raw,delay);assert.equal(activityValue(delayed,delay),200);
});
test('activity cloud review detects concurrent changes and verifies the saved sequence',async()=>{
  const change=draft('enter',[{kind:'delay',delay:800}],{actionSources:[0]});let current=sequenceXml(),writes=0;
  const cloud=new HarmonyCloud();cloud.target={accountId:'900',remoteId:'800'};
  cloud.verifyAccount=async()=>{};cloud.activities=async()=>current;cloud.activityDependencies=async()=>({commands:{},inputs:[]});
  cloud.soap=async(service,name,body)=>{assert.equal(name,'SaveActivities');writes++;const root=parseXml(`<root>${body}</root>`).children[0];const activity=child(child(root,'activities'),'Activity');current=envelope('SimpleGetActivities',body.slice(activity.start-6,activity.end-6));return envelope(name);};
  let review=await cloud.preview(change);current=current.replace('unchanged','another edit');
  await assert.rejects(cloud.apply(change,()=>{},review),/changed after review/);assert.equal(writes,0);
  review=await cloud.preview(change);await cloud.apply(change,()=>{},review);assert.equal(writes,1);
  cloud.close();
});
