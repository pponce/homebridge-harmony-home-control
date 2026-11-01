import { fail } from './hub.js';
import { parseXml, child, children, descendants, field, identity, escape, standalone } from './xml.js';
import { COMMON, cloudId, rootOf, nil, subtype, one, fingerprint, setMember, scalarMember } from './device-cloud.js';
import { sameValue } from '../../configurator-web/settings.js';

// UserButtonMapping service contracts from user_button_mapping.xsd. A map is
// always selected by its account, remote, surface and owner before editing.
const UBM='http://schemas.datacontract.org/2004/07/Logitech.Harmony.Services.DataContract.UserButtonMapping';
const XSI='http://www.w3.org/2001/XMLSchema-instance';
const schema=names=>({namespace:UBM,order:names.split(' ')});
const buttonSchema=schema('ButtonAction ButtonDoublePressAction ButtonId ButtonLongPressAction ButtonState FunctionGroupType ButtonKey ButtonImageKey ButtonImagePath ImageId MenuItem TextOnRemote');
const actionSchemas={command:schema('EventType Id Order CommandName DeviceId FunctionId'),channel:schema('EventType Id Order ChannelNumber DeviceId')};
const mapSchema=schema('ButtonMapId ButtonMapIdentifier ButtonMapSurfaceId Buttons DateModified RemoteId Sequences SurfaceId ActivityId DeviceId');
export const gestures={press:'ButtonAction',long:'ButtonLongPressAction',double:'ButtonDoublePressAction'};
export function mapSurfaces(xml,target) {
  const account=one(descendants(parseXml(xml),'Account').filter(a=>identity(xml,a)===target.accountId),'Cloud account is missing or ambiguous.');
  const remote=one(children(child(account,'Remotes'),'Remote').filter(r=>identity(xml,r)===target.remoteId),'The selected remote is missing or ambiguous.');
  const skinId=field(xml,remote,'SkinId'), surfaces=children(child(remote,'Surfaces'),'Surface').map(s=>({remoteId:target.remoteId,skinId,surfaceId:identity(xml,s)}));
  if(!skinId || !surfaces.length || surfaces.length>16 || surfaces.some(s=>!s.surfaceId) || new Set(surfaces.map(s=>s.surfaceId)).size!==surfaces.length) fail('Logitech did not provide a unique remote and control surface for these mappings. Use Harmony button customization.',409);
  return surfaces;
}
export function mapRequest(owner,surface,accountId) {
  const ids=(name,type,include)=>`<${name}>${include ? `<AbstractId xmlns="${COMMON}" xmlns:i="${XSI}" xmlns:c="${COMMON}" i:type="c:${type}">${cloudId(owner.id)}</AbstractId>` : ''}</${name}>`;
  return ids('deviceIds','DeviceId',owner.kind==='device')+ids('activityIds','ActivityId',owner.kind==='activity')+`<remoteSkinId>${escape(surface.skinId)}</remoteSkinId><accountId>${cloudId(accountId)}</accountId><surfaceId>${escape(surface.surfaceId)}</surfaceId>`;
}
function actionValue(raw,node) {
  if(nil(node)) return null;
  const type=subtype(node);
  if(type==='ButtonCommandAction') return {kind:'command',deviceId:identity(raw,node,'DeviceId'),command:field(raw,node,'CommandName')};
  if(type==='ButtonChannelAction') return {kind:'channel',deviceId:identity(raw,node,'DeviceId'),channel:field(raw,node,'ChannelNumber')};
  return {kind:'unsupported',type:type || 'unknown'};
}
function matchesOwner(raw,node,owner) {return subtype(node)===(owner.kind==='device'?'DeviceButtonMap':'ActivityButtonMap') && identity(raw,node,owner.kind==='device'?'DeviceId':'ActivityId')===owner.id;}
function matchesSurface(raw,node,surface) {const remote=identity(raw,node,'RemoteId'), id=identity(raw,node,'SurfaceId');return remote===surface.remoteId && (!id || id===surface.surfaceId);}
export function mapDocuments(xml,owner,surface) {
  return descendants(parseXml(xml),'AbstractButtonMap').filter(n=>matchesOwner(xml,n,owner) && matchesSurface(xml,n,surface)).map(n=> {
    const raw=standalone(xml,n), node=rootOf(raw);
    const target={...surface,mapId:identity(raw,node,'ButtonMapId'),identifier:field(raw,node,'ButtonMapIdentifier')};
    return {raw,fingerprint:fingerprint(raw),target};
  });
}
export function mapView(doc,owner) {
  const raw=doc.raw,root=rootOf(raw);
  return {ownerKind:owner.kind,ownerId:owner.id,target:doc.target,buttons:children(child(root,'Buttons'),'AbstractRemoteButton').map(n=>({key:field(raw,n,'ButtonKey'),id:field(raw,n,'ButtonId'),type:subtype(n),label:field(raw,n,'TextOnRemote'),group:field(raw,n,'FunctionGroupType'),...Object.fromEntries(Object.entries(gestures).map(([g,name])=>[g,actionValue(raw,child(n,name))]))}))};
}
export function selectMap(docs,target) {
  return one(docs.filter(d=>d.target.remoteId===target.remoteId && d.target.surfaceId===target.surfaceId && d.target.skinId===target.skinId && d.target.mapId===target.mapId && d.target.identifier===target.identifier),'The button map changed or is ambiguous. Load cloud button maps again.');
}
function buttonNode(raw,change) {
  return one(children(child(rootOf(raw),'Buttons'),'AbstractRemoteButton').filter(n=>field(raw,n,'ButtonKey')===change.button.key && field(raw,n,'ButtonId')===change.button.id && subtype(n)===change.button.type),'The button is missing or ambiguous in this map. Load cloud button maps again.');
}
export function buttonValue(raw,change) {return actionValue(raw,child(buttonNode(raw,change),gestures[change.field]));}
function bindSurface(raw,surfaceId) {
  // Live service behavior is also documented by terraform-provider-harmony:
  // base maps can omit both surface IDs; SaveButtonMaps requires Id wrappers.
  // Populated fields are retained and must agree with the requested surface.
  if(!/^\d{1,20}$/.test(surfaceId)) fail('This control surface has an unsupported identity.',409);
  for(const name of ['ButtonMapSurfaceId','SurfaceId']) {
    const root=rootOf(raw),node=child(root,name);
    if(nil(node)) raw=setMember(raw,root,name,cloudId(surfaceId),mapSchema);
    else if((identity(raw,root,name) || field(raw,root,name))!==surfaceId) fail('The map belongs to a different control surface. Load cloud button maps again.',409);
  }
  return raw;
}
export function buttonPatch(raw,change,commands=[]) {
  if(!Object.hasOwn(gestures,change.field)) fail('Choose a supported button gesture.');
  const before=buttonValue(raw,change);
  if(!sameValue(before,change.before)) fail('The cloud button assignment changed. Load cloud button maps and create a new draft.',409);
  if(before?.kind==='unsupported') fail('This system or sequence assignment must be edited in Harmony.',409);
  raw=bindSurface(raw,change.mapTarget.surfaceId);
  const n=buttonNode(raw,change),old=child(n,gestures[change.field]), next=change.value;
  if(next===null) {if(change.field==='press') fail('A primary button action is required.');return setMember(raw,n,gestures[change.field],'',buttonSchema,true);}
  if(before && before.kind!==next.kind) fail('Use Harmony to change between command and channel action types.');
  const type=next.kind==='command'?'ButtonCommandAction':'ButtonChannelAction';
  const command=next.kind==='command' ? one(commands.filter(c=>c.name===next.command),'This command is missing or ambiguous in Logitech.') : null;
  let row=!nil(old) && subtype(old)===type ? standalone(raw,old) : `<${gestures[change.field]} xmlns="${UBM}" xmlns:i="${XSI}" xmlns:u="${UBM}" i:type="u:${type}"><EventType>0</EventType><Id>0</Id><Order>0</Order></${gestures[change.field]}>`;
  const order=actionSchemas[next.kind];
  if(!order) fail('Choose a command or channel assignment.');
  row=scalarMember(row,next.kind==='command'?'CommandName':'ChannelNumber',next.kind==='command'?next.command:next.channel,order);
  row=setMember(row,rootOf(row),'DeviceId',cloudId(next.deviceId),order);
  if(command) row=setMember(row,rootOf(row),'FunctionId',command.functionId ? cloudId(command.functionId) : '',order,!command.functionId);
  // Replace this action's complete element, since its xsi:type may have changed.
  if(old) return raw.slice(0,old.start)+row+raw.slice(old.end);
  const rank=buttonSchema.order.indexOf(gestures[change.field]),at=n.children.find(c=>buttonSchema.order.indexOf(c.name)>rank)?.start ?? n.contentEnd;
  return raw.slice(0,at)+row+raw.slice(at);
}
export function buttonDraft(input,snapshot,maps) {
  if(!snapshot || input.version!==snapshot.version) fail('Read the hub and reopen the editor.',409);
  const owner=(input.ownerKind==='device'?snapshot.devices:input.ownerKind==='activity'?snapshot.activities:[]).find(d=>d.id===input.id);
  if(!owner || !Object.hasOwn(gestures,input.field)) fail('Choose a loaded device or activity button map.');
  const map=one(maps.filter(m=>m.ownerKind===input.ownerKind && m.ownerId===input.id && sameValue(m.target,input.mapTarget)),'Load cloud button maps before editing this assignment.');
  const button=one(map.buttons.filter(b=>sameValue({key:b.key,id:b.id,type:b.type},input.button)),'Choose one identified button.');
  const before=button[input.field],value=input.value;
  if(!['HardRemoteButton','SoftRemoteButton'].includes(button.type) || !button.key && !button.id || before?.kind==='unsupported') fail('This button type or system action must be edited in Harmony.');
  if(value===null) {if(input.field==='press') fail('Choose a primary button assignment.');}
  else {
    if(!value || typeof value!=='object' || Array.isArray(value)) fail('Choose a button assignment.');
    if(before && before.kind!==value.kind) fail('Use Harmony to change between command and channel action types.');
    const device=snapshot.devices.find(d=>d.id===value?.deviceId);
    if(!device || (input.ownerKind==='device' ? device.id!==owner.id : !owner.roles.some(r=>r.deviceId===device.id))) fail('Choose a device in this map.');
    if(value.kind==='command' ? !device.commands.includes(value.command) || Object.keys(value).some(k=>!['kind','command','deviceId'].includes(k)) : value.kind==='channel' ? typeof value.channel!=='string' || !/^[0-9.\-]{1,12}$/.test(value.channel) || Object.keys(value).some(k=>!['kind','channel','deviceId'].includes(k)) : true) fail('Choose an available command or a channel number.');
  }
  if(sameValue(before,value)) fail('Choose a different assignment.');
  const label=`${button.label || button.key || button.id} · ${{press:'Short press',long:'Long press',double:'Double press'}[input.field]}`;
  return {kind:'button',id:owner.id,ownerKind:input.ownerKind,name:owner.name,label,field:input.field,button:input.button,mapTarget:map.target,before,value,key:`button/${fingerprint(JSON.stringify([map.target,input.ownerKind,owner.id,input.button,input.field]))}`,cloud:{resource:'ButtonMap'},version:snapshot.version,status:'draft',createdAt:new Date().toISOString()};
}
