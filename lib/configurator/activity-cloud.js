import { fail } from './hub.js';
import { parseXml, child, children, descendants, field, identity, escape, standalone } from './xml.js';
import { cloudId, rootOf, nil, subtype, one, scalar, fingerprint, setMember, scalarMember } from './device-cloud.js';
import { settingSpec, sameValue } from '../../configurator-web/settings.js';

// Activity service member names and ordering from activity.xsd. Retained nodes
// keep their vendor metadata, namespace declarations and action identities.
export const ACTIVITY = 'http://schemas.datacontract.org/2004/07/Logitech.Harmony.Services.DataContract.Activity';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const schema = names => ({namespace:ACTIVITY,order:names.split(' ')});
const activitySchema = schema('AccountId ActivityDisplayName ActivityGroup ActivityOrder Alternatives BaseImageUri DateCreated DateModified DefaultChannel DefaultStation DefaultStationName EnterActions Icon Id ImageKey IsDefault IsMultiZone IsTuningDefault LeaveActions Name Roles StartScreen State SuggestedDisplay Type Zones');
const roleSchema = schema('DeviceId Id NextDevicePowerOnDelay PowerOffOrder PowerOnOrder SelectedInput');
const inputSchema = schema('ChannelNumber Id Name');
const actionSchemas = {command:schema('ActionOrder Id CommandName DeviceId'),delay:schema('ActionOrder Id Duration')};
const routes = {name:'Name',order:'ActivityOrder',enter:'EnterActions',leave:'LeaveActions'};
const roleRoutes = {powerOnOrder:'PowerOnOrder',powerOffOrder:'PowerOffOrder',nextDeviceDelay:'NextDevicePowerOnDelay',input:'SelectedInput'};
export function activityRoute(change) {
  const fields=change.role === undefined ? routes : roleRoutes;
  return change.kind === 'activity' && Object.hasOwn(fields,change.field) ? {field:fields[change.field]} : null;
}
export function activityDocument(xml,change) {
  const n=one(descendants(parseXml(xml),'Activity').filter(a=>identity(xml,a)===change.id),'The activity is missing or ambiguous in Logitech. Read the hub again.');
  const raw=standalone(xml,n);return {raw,fingerprint:fingerprint(raw)};
}
function targetNode(raw,change) {
  const root=rootOf(raw);if(identity(raw,root)!==change.id) fail('The cloud returned a different activity.',409);
  if(change.role===undefined) return root;
  const target=change.roleTarget || {id:change.cloud?.roleId,deviceId:change.cloud?.deviceId,type:change.cloud?.roleType};
  return one(children(child(root,'Roles'),'AbstractActivityRole').filter(r=>identity(raw,r,'DeviceId')===target.deviceId && subtype(r)===target.type && (!target.id || identity(raw,r)===target.id)),'The cloud activity role differs from the imported role. Read the hub again.');
}
function actionRows(raw,container) {
  if(nil(container)) return [];
  const rows=children(container,'AbstractActivityAction');
  const orders=rows.map(r=>field(raw,r,'ActionOrder'));
  if(container.children.length!==rows.length || rows.length>32 || orders.some(o=>!/^\d+$/.test(o)) || new Set(orders.map(Number)).size!==rows.length) fail('This activity sequence uses unsupported ordering or action types. Edit it in Harmony.',409);
  return rows.sort((a,b)=>Number(field(raw,a,'ActionOrder'))-Number(field(raw,b,'ActionOrder')));
}
function actionValue(raw,row) {
  const type=subtype(row);
  if(type==='CommandActivityAction' && field(raw,row,'CommandName') && identity(raw,row,'DeviceId')) return {kind:'command',command:field(raw,row,'CommandName'),deviceId:identity(raw,row,'DeviceId')};
  if(type==='DelayActivityAction' && /^\d+$/.test(field(raw,row,'Duration'))) return {kind:'delay',delay:Number(field(raw,row,'Duration'))};
  return {kind:'unsupported',type:type || 'unknown'};
}
export function activityValue(raw,change) {
  const route=activityRoute(change);if(!route) fail('Unsupported activity setting.');
  const node=child(targetNode(raw,change),route.field);
  if(settingSpec(change).type==='activity-actions') return nil(node) ? null : actionRows(raw,node).map(r=>actionValue(raw,r));
  if(change.field==='input') return nil(node) ? null : scalar(raw,child(node,'Name'));
  const current=scalar(raw,node);if(current===null) return null;
  if(settingSpec(change).type==='number') {if(!/^\d+$/.test(current)) fail('Unsupported activity numeric value.',409);return Number(current);}
  return current;
}
export function activityPatchDocument(raw,change,commands={},inputs=[]) {
  const route=activityRoute(change), spec=settingSpec(change);if(!route || !spec) fail('Unsupported activity setting.');
  const before=activityValue(raw,change);
  if(change.before!==null && !sameValue(before,change.before)) fail('The cloud setting has changed since import. Sync, Read hub and create a new draft.',409);
  const target=targetNode(raw,change), targetSchema=change.role===undefined ? activitySchema : roleSchema;
  if(spec.type==='activity-actions') {
    const rows=actionRows(raw,child(target,route.field));
    if(rows.some(r=>actionValue(raw,r).kind==='unsupported')) fail('This activity contains an unsupported action. Edit it in Harmony.',409);
    const sources=change.actionSources;
    if(!Array.isArray(sources) || sources.length!==change.value.length || sources.some(i=>i!==null && (!Number.isInteger(i) || i<0 || i>=rows.length || change.before===null)) || new Set(sources.filter(i=>i!==null)).size!==sources.filter(i=>i!==null).length) fail('The sequence changed. Read the hub and reopen the editor.',409);
    const next=change.value.map((a,index)=>{
      if(a.kind==='command' ? !commands[a.deviceId]?.includes(a.command) : a.kind!=='delay' || !Number.isInteger(a.delay) || a.delay<0 || a.delay>60000) fail('Choose commands available on this activity’s devices and valid delays.',409);
      const type=a.kind==='command' ? 'CommandActivityAction' : 'DelayActivityAction', source=rows[sources[index]];
      if(source && subtype(source)!==type) fail('Remove and add a step to change its type.');
      const order=actionSchemas[a.kind];
      let row=source ? standalone(raw,source) : `<AbstractActivityAction xmlns="${ACTIVITY}" xmlns:i="${XSI}" xmlns:a="${ACTIVITY}" i:type="a:${type}"><ActionOrder>${index}</ActionOrder><Id>0</Id></AbstractActivityAction>`;
      row=scalarMember(row,'ActionOrder',index,order);
      if(a.kind==='command') {row=scalarMember(row,'CommandName',a.command,order);row=setMember(row,rootOf(row),'DeviceId',cloudId(a.deviceId),order);}
      else row=scalarMember(row,'Duration',a.delay,order);
      return row;
    }).join('');
    return setMember(raw,target,route.field,next,targetSchema);
  }
  if(change.field==='input') {
    if(!inputs.includes(change.value)) fail('This input is unavailable in the current cloud device profile.',409);
    const existing=child(target,'SelectedInput');
    let input=nil(existing) ? `<SelectedInput xmlns="${ACTIVITY}"/>` : standalone(raw,existing);
    input=scalarMember(input,'Name',change.value,inputSchema);
    input=setMember(input,rootOf(input),'Id','',inputSchema,true);
    return setMember(raw,target,'SelectedInput',rootOf(input).children.map(n=>standalone(input,n)).join(''),targetSchema);
  }
  return setMember(raw,target,route.field,escape(change.value),targetSchema);
}
