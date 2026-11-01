import { createHash } from 'node:crypto';
import { fail } from './hub.js';
import { parseXml, child, children, descendants, value, field, identity, escape, standalone } from './xml.js';
import { settingSpec, sameValue, normalizeInputMethod, isInfrared } from '../../configurator-web/settings.js';

// Service/type contracts: congruity/congruity's harmony.wsdl, user_feature.xsd,
// dm_data.xsd and dm_operation.xsd. Only the selected field is changed; fetched
// vendor members and namespace declarations are retained, including on actions.
export const COMMON = 'http://schemas.datacontract.org/2004/07/Logitech.Harmony.Services.Common.Contracts.Data';
const UF = 'http://schemas.datacontract.org/2004/07/Logitech.Harmony.Services.DataContract.UserFeature';
const DM = 'http://schemas.datacontract.org/2004/07/Logitech.Harmony.Services.Manager.DeviceManager.Contracts.Data';
const DM_OP = `${DM}.Operation`;
const COMMON_OP = `${COMMON}.Operation`;
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const routes = {
  name:['Device','Name'],
  'delays.interDevice':['Device','InterDeviceDelay'], 'delays.interKey':['Device','InterKeyDelay'],
  repeats:['Device','PressMinRepeats'], controlPort:['Device','ControlPort'],
  'delays.powerOn':['PowerFeature','PowerOnDelay'], 'power.alwaysOn':['PowerFeature','IsPowerAlwaysOn'],
  'power.betweenActivities':['PowerFeature','IsPoweredOnBetweenActivities'], 'power.type':['PowerFeature','PowerTypeId'],
  'power.on':['PowerFeature','PowerOnActions'], 'power.off':['PowerFeature','PowerOffActions'], 'power.toggle':['PowerFeature','PowerToggleActions'],
  'delays.input':['InputFeature','InputDelay'], inputMethod:['InputFeature','InputType'], inputOrder:['InputFeature','Inputs'], inputCommands:['InputFeature','Actions'],
  'inputActions.start':['InputFeature','StartActions'], 'inputActions.next':['InputFeature','NextActions'],
  'inputActions.previous':['InputFeature','PreviousActions'], 'inputActions.finish':['InputFeature','FinishActions'],
};
export function deviceRoute(change) {
  const route=change.kind === 'device' && Object.hasOwn(routes,change.field) && routes[change.field];
  return route ? {resource:route[0],field:route[1]} : null;
}
export const fingerprint = raw => createHash('sha256').update(raw).digest('hex');
export const rootOf = raw => parseXml(raw).children[0];
const attr = (node,name) => Object.entries(node?.attributes || {}).find(([k])=>k.includes(':') && node.namespaces[k.split(':')[0]] === XSI && k.split(':')[1] === name)?.[1];
export const nil = node => !node || ['true','1'].includes(attr(node,'nil'));
export const subtype = node => attr(node,'type')?.split(':').at(-1);
export const one = (nodes,message) => { if(nodes.length !== 1) fail(message,409);return nodes[0]; };
export const scalar = (raw,node) => {
  if(nil(node)) return null;
  if(node.children.length) fail('This cloud field has an unsupported structure. Use Harmony for this setting.',409);
  return value(raw,node) || null;
};
const integer = text => text !== null && /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
// Value is polymorphic in the live service, despite the older XSD's long type.
// Declare its numeric type explicitly, as in live GetMyHousehold responses.
export const cloudId = id => `<IsPersisted xmlns="${COMMON}">true</IsPersisted><Value xmlns="${COMMON}" xmlns:i="${XSI}" xmlns:d="http://www.w3.org/2001/XMLSchema" i:type="d:long">${escape(id)}</Value>`;
export const deviceIds = id => `<deviceIds><DeviceId xmlns="${COMMON}">${cloudId(id)}</DeviceId></deviceIds>`;

export function ownedDevice(xml,target,id) {
  const account=one(descendants(parseXml(xml),'Account').filter(a=>identity(xml,a) === target.accountId && children(child(a,'Remotes'),'Remote').some(r=>identity(xml,r) === target.remoteId)), 'The selected hub/account no longer matches this Logitech connection. Reconnect.');
  one(children(child(account,'Devices'),'Device').filter(d=>identity(xml,d) === id), 'This device is not in the selected hub’s cloud account. Read the hub and reconnect.');
  return standalone(xml,one(children(account,'Id'),'Cloud account identity is missing.'));
}
function dictionary(xml,id,prefix) {
  const root=parseXml(xml), rows=[];
  const visit = n => { for(const c of n.children) {if(c.name.startsWith(prefix) && identity(xml,c,'Key') === id) rows.push(c);visit(c);} };
  visit(root);
  return one(rows,'The cloud device result is missing or ambiguous. Read the hub and reconnect.');
}
export function commandNames(xml,id) {
  const entry=dictionary(xml,id,'KeyValueOfDeviceIdArrayOfCommand');
  return children(child(entry,'Value'),'Command').map(n=>field(xml,n,'Name')).filter(Boolean);
}
export function commandDetails(xml,id) {
  const entry=dictionary(xml,id,'KeyValueOfDeviceIdArrayOfCommand');
  return children(child(entry,'Value'),'Command').map(n=>({name:field(xml,n,'Name'),functionId:identity(xml,n,'FunctionId'),raw:value(xml,child(n,'Raw'),false),protocolId:field(xml,n,'ProtocolId'),transport:field(xml,n,'TransportType')}));
}
export function deviceDocument(xml,change) {
  const route=deviceRoute(change);if(!route) fail('This device setting is not supported.');
  let node;
  if(route.resource === 'Device') {
    node=one(descendants(parseXml(xml),'GetDeviceResult'),'The cloud device is missing or ambiguous.');
    if(identity(xml,node) !== change.id) fail('The cloud returned a different device. No changes were made.',409);
  } else {
    const entry=dictionary(xml,change.id,'KeyValueOfDeviceIdArrayOfDeviceFeature');
    node=one(children(child(entry,'Value'),'DeviceFeature').filter(n=>subtype(n) === route.resource && identity(xml,n,'DeviceId') === change.id),'This device feature is missing or ambiguous in Logitech. Complete its initial setup in Harmony, then sync and Read hub.');
  }
  const raw=standalone(xml,node);
  return {raw,fingerprint:fingerprint(raw)};
}
function inputs(raw,node) {
  const rows=children(child(node,'Inputs'),'Input'), names=rows.map(n=>field(raw,n,'InputName'));
  if(!rows.length || names.some(n=>!n) || new Set(names).size !== names.length) fail('The cloud input names are missing or ambiguous. Configure them in Harmony first.',409);
  return rows;
}
function targetNode(raw,change) {
  const root=rootOf(raw);
  return change.field === 'inputCommands' ? one(inputs(raw,root).filter(n=>field(raw,n,'InputName') === change.inputName),'This input no longer exists in Logitech. Read the hub and create a new draft.') : root;
}
function actionRows(raw,node) {
  if(nil(node)) return [];
  if(node.children.some(n=>n.name !== 'AbstractIRAction')) fail('This sequence contains an unsupported cloud action. Configure it in Harmony.',409);
  const rows=children(node,'AbstractIRAction');
  if(rows.length > 32 || rows.some(n=>integer(scalar(raw,child(n,'Order'))) === null) || new Set(rows.map(n=>field(raw,n,'Order'))).size !== rows.length) fail('This sequence has unsupported action ordering. Configure it in Harmony.',409);
  return rows.sort((a,b)=>Number(field(raw,a,'Order'))-Number(field(raw,b,'Order')));
}
function actionValue(raw,n) {
  const type=subtype(n);
  if(type === 'IRPressAction') {
    const command=scalar(raw,child(n,'IRCommandName')), duration=scalar(raw,child(n,'Duration'));
    if(command && (duration === null || integer(duration) !== null)) return {kind:'command',command,duration:integer(duration)};
  } else if(type === 'IRDelayAction') {
    const delay=integer(scalar(raw,child(n,'Delay')));if(delay !== null) return {kind:'delay',delay};
  }
  return {kind:'unsupported',type:type || 'unknown'};
}
export function deviceValue(raw,change) {
  const route=deviceRoute(change), spec=settingSpec(change), node=targetNode(raw,change);
  if(change.field === 'inputOrder') {
    const rows=inputs(raw,node), order=rows.map(n=>integer(scalar(raw,child(n,'InputOrder'))));
    if(order.some(n=>n === null) || new Set(order).size !== order.length) return null;
    return rows.sort((a,b)=>Number(field(raw,a,'InputOrder'))-Number(field(raw,b,'InputOrder'))).map(n=>field(raw,n,'InputName'));
  }
  const target=child(node,route.field);
  if(spec.type === 'actions') return nil(target) ? null : actionRows(raw,target).map(n=>actionValue(raw,n));
  const current=scalar(raw,target);if(current === null) return null;
  if(spec.type === 'boolean') {if(!['true','false','1','0'].includes(current)) fail('The cloud returned an unknown boolean value.',409);return ['true','1'].includes(current);}
  if(spec.type === 'number') {const n=integer(current);if(n === null) fail('The cloud returned an unsupported numeric value.',409);return n;}
  return change.field === 'inputMethod' ? normalizeInputMethod(current) : current;
}
// Replace a field, or insert a missing optional field in the schema's member order.
// Existing attributes and unknown children elsewhere in the document stay intact.
const baseOrder=['DateModified','DeviceId','GlobalDeviceVersionId','State'];
const orders={
  Device:'DecodedEdid DefaultInterDeviceDelay DefaultInterKeyDelay DefaultPressMinRepeats DeviceOrder DeviceType EncodedEdid HoldInterDeviceDelay HoldInterKeyDelay HoldMinRepeats InterDeviceDelay InterKeyDelay Manufacturer Model Name PictureId PressMinRepeats ActivityIds AppLaunchConfigs AutoDetectedDevice BTAddress Characterization ContentProfileKey ControlPort CopiedDeviceSource DeviceAddedDate DeviceCapabilitiesWithPriority DeviceClassification DeviceProfileUri DeviceSearchType DeviceTypeDisplayName DongleIndex DongleRFID FriendlyName GlobalDeviceVersionId GlobalLanguageVersionId GroupName Icon Id IsInterKeyDelayOptimized IsKeyboardAssociated IsMultiCode IsScartCableSupported ParentDevice ParentDeviceId ParentDeviceManufacturer ParentDeviceModel PrivateAddType RegionalCharset RegisterSection RenewSection SetupState State SuggestedDisplay Tokens Transport'.split(' '),
  InputFeature:[...baseOrder,...'CanSkipInputs DefaultInputDelay FinishActions HasAdditionalActions Id InputDelay InputType Inputs IsActiveInput NextActions PreviousActions StartActions'.split(' ')],
  PowerFeature:[...baseOrder,...'ConnectedAppPowerOnDelay DefaultPowerOnDelay HasAdditionalActions Id IsPowerAlwaysOn IsPoweredOnBetweenActivities PowerOffActionId PowerOffActions PowerOffSetType PowerOnActionId PowerOnActions PowerOnDelay PowerOnResetActions PowerOnResetInputName PowerOnSetType PowerToggleActionId PowerToggleActions PowerTypeId'.split(' ')],
  Input:'ActionId ActionName ActionSetTypeId Actions Attributes DevActionType HasAdditionalActions Id InputName InputOrder IsActiveInput IsAutoSwitch IsOnline PortTypes PressDuration StateName StateValue'.split(' '),
  IRPressAction:['ActionId','Order','Duration','IRCommandName'], IRDelayAction:['ActionId','Order','Delay'],
};
function replaceContent(raw,node,content,isNil=false) {
  let open=raw.slice(node.start,node.openEnd);
  for(const [key] of Object.entries(node.attributes).filter(([k])=>k.includes(':') && node.namespaces[k.split(':')[0]] === XSI && k.split(':')[1] === 'nil')) {
    const literal=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    open=open.replace(new RegExp(`\\s${literal}\\s*=\\s*(?:"[^"]*"|'[^']*')`),'');
  }
  let prefix=Object.entries(node.namespaces).find(([key,ns])=>key && ns===XSI)?.[0];
  const declared=!!prefix;if(!prefix) {prefix='cnil';while(Object.hasOwn(node.namespaces,prefix)) prefix+='x';}
  open=open.replace(/\/?>(\s*)$/,isNil ? `${declared?'':` xmlns:${prefix}="${XSI}"`} ${prefix}:nil="true">$1` : '>$1');
  return raw.slice(0,node.start)+open+content+`</${node.qname}>`+raw.slice(node.end);
}
export function setMember(raw,parent,name,content,type,isNil=false) {
  const existing=children(parent,name);if(existing.length>1) fail('Duplicate cloud setting. Configure it in Harmony.',409);
  if(existing.length) return replaceContent(raw,existing[0],content,isNil);
  const order=typeof type === 'object' ? type.order : orders[type], rank=order.indexOf(name), ns=typeof type === 'object' ? type.namespace : type === 'Device' ? DM : UF;
  if(rank<0) fail('Unsupported cloud field.');
  const next=parent.children.find(n=>order.indexOf(n.name)>rank);
  const node=`<${name} xmlns="${ns}"${isNil?` xmlns:i="${XSI}" i:nil="true"`:''}>${content}</${name}>`;
  const at=next?.start ?? parent.contentEnd;
  if(raw.slice(parent.start,parent.openEnd).endsWith('/>')) return replaceContent(raw,parent,node);
  return raw.slice(0,at)+node+raw.slice(at);
}
export function scalarMember(raw,name,next,type) {
  const parent=rootOf(raw), target=child(parent,name);
  if(target?.children.length) fail('This cloud setting has an unsupported structure.',409);
  return setMember(raw,parent,name,next === null ? '' : escape(next),type,next === null);
}
function renameRoot(raw,name,namespace) {
  const root=rootOf(raw);let prefix='cwrite';while(Object.hasOwn(root.namespaces,prefix)) prefix+='x';
  let open=raw.slice(root.start,root.openEnd).replace(`<${root.qname}`,`<${prefix}:${name}`).replace(/(\/?>)$/,` xmlns:${prefix}="${namespace}"$1`);
  return open + (open.endsWith('/>') ? '' : raw.slice(root.contentStart,root.contentEnd)+`</${prefix}:${name}>`);
}
function validateActions(actions,commands) {
  if(!Array.isArray(actions) || actions.length>32 || actions.some(a=>a.kind === 'command' ? !commands.includes(a.command) || !(a.duration === null || Number.isInteger(a.duration) && a.duration>=0 && a.duration<=60000) : a.kind === 'delay' ? !Number.isInteger(a.delay) || a.delay<0 || a.delay>60000 : true)) fail('The proposed commands are unavailable or invalid in the current cloud profile. Read the hub and create a new draft.',409);
}
export function devicePatch(raw,change,commands=[]) {
  const route=deviceRoute(change), spec=settingSpec(change);if(!route || !spec) fail('Unsupported device setting.');
  const before=deviceValue(raw,change);
  if(change.before !== null && !sameValue(before,change.before)) fail('The cloud setting has changed since import. Sync, Read hub and create a new draft.',409);
  if(sameValue(before,change.value)) fail('Logitech already has this value. Sync and Read hub to verify it.',409);
  if(change.field === 'controlPort' && !isInfrared({transport:field(raw,rootOf(raw),'Transport')})) fail('The cloud device does not use confirmed infrared control.',409);
  if(spec.type === 'actions') {
    const target=targetNode(raw,change), container=child(target,route.field), rows=actionRows(raw,container);
    if(rows.some(n=>actionValue(raw,n).kind === 'unsupported')) fail('This cloud sequence contains an unsupported action. Configure it in Harmony.',409);
    validateActions(change.value,commands);
    if(!Array.isArray(change.actionSources) || change.actionSources.length !== change.value.length || change.actionSources.some(i=>i!==null && (!Number.isInteger(i) || i<0 || i>=rows.length || change.before===null)) || new Set(change.actionSources.filter(i=>i!==null)).size!==change.actionSources.filter(i=>i!==null).length) fail('The sequence changed. Read the hub and reopen the editor.',409);
    const next=change.value.map((action,index)=>{
      const type=action.kind === 'command' ? 'IRPressAction' : 'IRDelayAction', source=rows[change.actionSources[index]];
      if(source && subtype(source)!==type) fail('Change action types by removing the old row and adding a new one.');
      let item=source ? standalone(raw,source) : `<AbstractIRAction xmlns="${UF}" xmlns:i="${XSI}" xmlns:u="${UF}" i:type="u:${type}"><ActionId>${action.kind === 'command' ? '0' : '3'}</ActionId><Order>${index+1}</Order></AbstractIRAction>`;
      item=scalarMember(item,'Order',index+1,type);
      if(action.kind === 'command') {item=scalarMember(item,'Duration',action.duration,type);item=scalarMember(item,'IRCommandName',action.command,type);}
      else item=scalarMember(item,'Delay',action.delay,type);
      return item;
    }).join('');
    return setMember(raw,target,route.field,next,change.field === 'inputCommands' ? 'Input' : route.resource);
  }
  if(change.field === 'inputOrder') {
    const current=inputs(raw,rootOf(raw)).map(n=>field(raw,n,'InputName'));
    if(current.length !== change.value.length || new Set(change.value).size!==current.length || change.value.some(n=>!current.includes(n))) fail('The cloud input list changed. Read the hub and create a new draft.',409);
    for(const [index,name] of change.value.entries()) {
      const n=inputs(raw,rootOf(raw)).find(n=>field(raw,n,'InputName') === name);
      raw=setMember(raw,n,'InputOrder',String(index+1),'Input');
    }
    return raw;
  }
  let next=change.value;
  if(change.field === 'inputMethod') {
    const current=scalar(raw,child(rootOf(raw),'InputType'));
    // Numeric hub methods are not assumed to be valid SOAP enum names. Discrete
    // is confirmed by the UserFeature client; other named forms remain guided.
    if(!['1','2','4'].includes(next)) fail('Choose a supported input method.');
    if(current === 'Discrete' && next === '1') next='Discrete';
    else if(!['1','2','4'].includes(current)) fail('This cloud profile uses a method representation this editor cannot safely change. Choose the method in Harmony Input Settings; input commands and order can still be edited here.',409);
    const node=rootOf(raw), hasCommands=n=>actionRows(raw,n).some(a=>actionValue(raw,a).kind === 'command');
    if(next === '1' || next === 'Discrete') {if(inputs(raw,node).some(i=>!hasCommands(child(i,'Actions')))) fail('Save a selection command for every input before choosing direct input commands.');}
    else if(!hasCommands(child(node,'NextActions')) || next === '4' && !hasCommands(child(node,'StartActions'))) fail('Save the required Next input and, for a menu, Start input selection commands before changing the method.');
  }
  return scalarMember(raw,route.field,next,route.resource);
}
export function deviceSaveBody(raw,change,accountXml) {
  if(deviceRoute(change).resource !== 'Device') return `<deviceFeatures>${raw}</deviceFeatures>`;
  if(change.field==='name') return `<operation xmlns:i="${XSI}" xmlns:o="${DM_OP}" i:type="o:UpdateDeviceNameOperation">${renameRoot(accountXml,'ParentAccount',COMMON_OP)}<o:DeviceId>${cloudId(change.id)}</o:DeviceId><o:DeviceName>${escape(change.value)}</o:DeviceName></operation>`;
  return `<operation xmlns:i="${XSI}" xmlns:o="${DM_OP}" xmlns:b="${COMMON_OP}" i:type="o:UpdateUserDeviceOperation">${renameRoot(accountXml,'ParentAccount',COMMON_OP)}<b:Object i:nil="true"/>${renameRoot(raw,'Device',DM_OP)}<o:RegionalCharset i:nil="true"/></operation>`;
}
