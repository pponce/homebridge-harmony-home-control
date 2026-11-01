import { fail } from './hub.js';
import { parseXml, child, children, descendants, field, identity, escape, standalone } from './xml.js';
import { COMMON, cloudId, rootOf, nil, subtype, one, setMember, scalarMember, renameRoot, fingerprint } from './device-cloud.js';
import { canonicalRoles, sameValue } from '../../configurator-web/settings.js';

const A='http://schemas.datacontract.org/2004/07/Logitech.Harmony.Services.DataContract.Activity';
const XSI='http://www.w3.org/2001/XMLSchema-instance';
const roleSchema={namespace:A,order:'DeviceId Id NextDevicePowerOnDelay PowerOffOrder PowerOnOrder SelectedInput'.split(' ')};
const activitySchema={namespace:A,order:'AccountId ActivityDisplayName ActivityGroup ActivityOrder Alternatives BaseImageUri DateCreated DateModified DefaultChannel DefaultStation DefaultStationName EnterActions Icon Id ImageKey IsDefault IsMultiZone IsTuningDefault LeaveActions Name Roles StartScreen State SuggestedDisplay Type Zones'.split(' ')};
const inputSchema={namespace:A,order:['ChannelNumber','Id','Name']};
const walk=n=>(n?.children || []).flatMap(c=>[c,...walk(c)]);
const roleNodes=raw=>children(child(rootOf(raw),'Roles'),'AbstractActivityRole');
export function rolesValue(raw) {return canonicalRoles(roleNodes(raw).map(r=>({type:subtype(r),deviceId:identity(raw,r,'DeviceId'),input:field(raw,child(r,'SelectedInput'),'Name')})));}

// GetActivityRoles and SaveActivities are used by congruity's existing-activity
// editor. Eligibility comes from the service's device capabilities and templates.
export function rolesRequest(type,accountId,devicesXml,deviceIds) {
  if(!type || type.length>100 || !deviceIds.length || deviceIds.length>100) fail('This activity does not expose a supported type and device catalog.');
  const devices=descendants(parseXml(devicesXml),'Device');
  const rows=deviceIds.map(id=>{
    const device=one(devices.filter(d=>identity(devicesXml,d)===id),'A participating-device profile is missing or ambiguous in Logitech.');
    const capabilities=child(device,'DeviceCapabilitiesWithPriority');
    if(!capabilities) fail('Logitech did not supply device capabilities for activity role selection.',409);
    return `<DeviceWithCapabilities xmlns="${A}"><DeviceId>${cloudId(id)}</DeviceId><DeviceType>Unknown</DeviceType><PrioritizedCapabilities>${capabilities.children.map(n=>standalone(devicesXml,n)).join('')}</PrioritizedCapabilities></DeviceWithCapabilities>`;
  }).join('');
  return `<accountId>${cloudId(accountId)}</accountId><activityTypes><ActivityType xmlns="${A}">${escape(type)}</ActivityType></activityTypes><devicesWithCapabilities>${rows}</devicesWithCapabilities>`;
}
export const roleDeviceIds=ids=>`<deviceIds>${ids.map(id=>`<DeviceId xmlns="${COMMON}">${cloudId(id)}</DeviceId>`).join('')}</deviceIds>`;
export function rolesCatalog(xml,raw,deviceIds) {
  const root=rootOf(raw),type=field(raw,root,'Type');
  const mapping=one(walk(parseXml(xml)).filter(n=>n.name.startsWith('KeyValueOfActivityTypeRoleToDeviceMapping') && field(xml,n,'Key')===type),'Logitech did not return a unique template for this activity type.');
  const templates=walk(child(mapping,'Value')).filter(n=>n.name.startsWith('KeyValueOfAbstractActivityRoleArrayOfDeviceId')).map(n=>{
    const key=child(n,'Key'),type=subtype(key),ids=children(child(n,'Value'),'DeviceId').map(d=>field(xml,d,'Value'));
    if(!type || !/^[A-Za-z]+ActivityRole$/.test(type) || ids.some(id=>!deviceIds.includes(id))) fail('This activity role template is unsupported or refers to another account.',409);
    return {type,deviceIds:[...new Set(ids)].sort(),raw:standalone(xml,key)};
  }).sort((a,b)=>a.type.localeCompare(b.type));
  if(!templates.length || new Set(templates.map(t=>t.type)).size!==templates.length) fail('Logitech supplied missing or duplicate activity role templates.',409);
  return {activityId:identity(raw,root),type,roles:rolesValue(raw),options:templates.map(({type,deviceIds})=>({type,deviceIds})),templates,fingerprint:fingerprint(JSON.stringify(templates))};
}
export function validateRoles(next,catalog,devices) {
  if(!Array.isArray(next) || !next.length || next.length>32 || next.some(r=>!r || typeof r!=='object' || Array.isArray(r) || Object.keys(r).some(k=>!['type','deviceId','input'].includes(k)))) fail('Choose 1–32 activity roles.');
  for(const r of next) {
    const option=catalog.options.find(o=>o.type===r.type),device=devices.find(d=>d.id===r.deviceId);
    if(!option?.deviceIds.includes(r.deviceId) || !device) fail('Choose a device offered for each role by Logitech.');
    if(typeof r.input!=='string' || r.input.length>100 || r.input && !device.inputs.some(i=>i.name===r.input)) fail('Choose an available input for each participating device.');
  }
  if(new Set(next.map(r=>JSON.stringify([r.type,r.deviceId]))).size!==next.length) fail('Assign each device to a role only once.');
  for(const option of catalog.options.filter(o=>o.type!=='PassThroughActivityRole' && o.deviceIds.length)) if(next.filter(r=>r.type===option.type).length!==1) fail('Choose exactly one device for each required activity role.');
  for(const id of new Set(next.map(r=>r.deviceId))) if(new Set(next.filter(r=>r.deviceId===id).map(r=>r.input)).size!==1) fail('Use the same selected input for all roles served by one device.');
}
export function removedRoleDevices(before,next) {const keep=new Set(next.map(r=>r.deviceId));return [...new Set(before.map(r=>r.deviceId))].filter(id=>!keep.has(id));}
export function checkRoleRemoval(raw,next,maps) {
  const removed=removedRoleDevices(rolesValue(raw),next);if(!removed.length) return;
  const references=(xml,node)=>descendants(node,'DeviceId').some(n=>removed.includes(field(xml,n,'Value')));
  for(const name of ['EnterActions','LeaveActions']) {
    const actions=child(rootOf(raw),name);
    if(references(raw,actions) || children(actions,'AbstractActivityAction').some(n=>!['CommandActivityAction','DelayActivityAction'].includes(subtype(n)))) fail('Update this activity’s start/end actions before removing a device they may use.',409);
  }
  if(!maps.length) fail('This activity’s button maps could not be checked. Use Harmony to remove its participating devices.',409);
  for(const map of maps) {
    const root=rootOf(map.raw),sequences=child(root,'Sequences');
    if(!nil(sequences) && (sequences.children.length || field(map.raw,root,'Sequences').trim())) fail('This activity has named sequences whose device references cannot be checked. Use Harmony to remove participating devices.',409);
    if(references(map.raw,child(root,'Buttons'))) fail('Update button assignments that use the removed device before changing participating devices.',409);
  }
}
export function patchRoles(raw,change,catalog) {
  if(!sameValue(rolesValue(raw),change.before)) fail('The cloud activity roles changed. Load role choices and create a new draft.',409);
  const old=roleNodes(raw),numeric=(r,name)=>/^\d+$/.test(field(raw,r,name)) ? Number(field(raw,r,name)) : null;
  const max=Math.max(-1,...old.flatMap(r=>['PowerOnOrder','PowerOffOrder'].map(n=>numeric(r,n) ?? -1)));
  const addedOrders=new Map();
  const rows=change.value.map(value=>{
    const matches=old.filter(r=>subtype(r)===value.type && identity(raw,r,'DeviceId')===value.deviceId);
    if(matches.length>1) fail('This activity has ambiguous roles. Use Harmony activity setup.',409);
    const template=one(catalog.templates.filter(t=>t.type===value.type && t.deviceIds.includes(value.deviceId)),'This role/device combination is no longer available.');
    let row=matches.length ? standalone(raw,matches[0]) : renameRoot(template.raw,'AbstractActivityRole',A);
    row=setMember(row,rootOf(row),'DeviceId',cloudId(value.deviceId),roleSchema);
    if(!matches.length) {
      row=setMember(row,rootOf(row),'Id','',roleSchema,true);
      const peer=old.find(r=>identity(raw,r,'DeviceId')===value.deviceId);
      if(!addedOrders.has(value.deviceId)) addedOrders.set(value.deviceId,max+addedOrders.size+1);
      for(const name of ['PowerOnOrder','PowerOffOrder']) row=scalarMember(row,name,(peer && numeric(peer,name)) ?? addedOrders.get(value.deviceId),roleSchema);
    }
    if(field(row,child(rootOf(row),'SelectedInput'),'Name')!==value.input) {
      if(!value.input) row=setMember(row,rootOf(row),'SelectedInput','',roleSchema,true);
      else {
        const selected=child(rootOf(row),'SelectedInput');let input=nil(selected)?`<SelectedInput xmlns="${A}" xmlns:i="${XSI}"/>`:standalone(row,selected);
        input=scalarMember(input,'Name',value.input,inputSchema);input=setMember(input,rootOf(input),'Id','',inputSchema,true);
        row=setMember(row,rootOf(row),'SelectedInput',rootOf(input).children.map(n=>standalone(input,n)).join(''),roleSchema);
      }
    }
    return row;
  }).join('');
  return setMember(raw,rootOf(raw),'Roles',rows,activitySchema);
}
