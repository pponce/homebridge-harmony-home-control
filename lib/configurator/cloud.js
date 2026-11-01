import { ConfiguratorError, fail, limitedText } from './hub.js';
import { parseXml, child, children, descendants, identity, field, value, escape } from './xml.js';
import { deviceRoute, cloudId, deviceIds, ownedDevice, deviceDocument, deviceValue, devicePatch, deviceSaveBody, commandNames, commandDetails } from './device-cloud.js';
import { settingSpec, sameValue, isInfrared } from '../../configurator-web/settings.js';
import { activityDocument, activityValue, activityPatchDocument } from './activity-cloud.js';
import { mapSurfaces, mapRequest, mapDocuments, mapView, selectMap, buttonValue, buttonPatch } from './button-cloud.js';

const SERVICES = 'https://svcs.myharmony.com';
const COMMON = 'http://schemas.datacontract.org/2004/07/Logitech.Harmony.Services.Common.Contracts.Data';
const id = v => `<Value xmlns="${COMMON}" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:d="http://www.w3.org/2001/XMLSchema" i:type="d:long">${escape(v)}</Value>`;
const operation = (name, inner = '') => `<${name} xmlns="http://tempuri.org/">${inner}</${name}>`;
const remote = rid => `<remoteId>${id(rid)}</remoteId>`;
const endpoints = { AccountManager: 'HarmonyPlatform', UserAccountDirector: 'UserAccountDirectorPlatform', ActivityManager: 'ActivityPlatform', CompileManager: 'SyncPlatform', RemoteManager: 'RemotePlatform', DeviceManager:'HarmonyPlatform', UserFeatureManager:'UserFeaturePlatform', UserButtonMappingManager:'UserButtonMappingPlatform' };

export function selectHousehold(xml, remoteId, accountId) {
  const root = parseXml(xml);
  for (const account of descendants(root,'Account')) {
    if (identity(xml,account) !== accountId) continue;
    const selected = children(child(account,'Remotes'),'Remote').find(r => identity(xml,r) === remoteId);
    if (selected) return { remoteId, accountId };
  }
  fail('This Logitech login does not contain the selected hub and account. No changes were made.',409);
}
export function activityPatch(xml, change) {
  return activityPatchDocument(activityDocument(xml,change).raw,change);
}

// Protocol facts: steverice/terraform-provider-harmony and congruity/congruity.
// No external project code is included. Cookies live only in this browser session's
// backend client. This client never persists credentials or returns them to the
// page; opt-in saved logins are handled separately by the encrypted vault.
export class HarmonyCloud {
  constructor({ fetchImpl = fetch, timeout = 15000 } = {}) { this.fetch = fetchImpl; this.timeout = timeout; this.cookies = new Map(); this.abort = new AbortController(); }
  async post(url, body, headers = {}) {
    const target = new URL(url); let response;
    try {
      response = await this.fetch(url,{ method: 'POST', redirect: 'error', signal: AbortSignal.any([this.abort.signal,AbortSignal.timeout(this.timeout)]), headers: { ...headers, ...(target.origin === SERVICES && this.cookies.size ? { Cookie: [...this.cookies].map(([k,v]) => `${k}=${v}`).join('; ') } : {}) }, body });
      if (target.origin === SERVICES) for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';',1)[0], split = pair.indexOf('=');
        if (split > 0 && split < 200 && pair.length < 8192) this.cookies.set(pair.slice(0,split),pair.slice(split+1));
      }
      const raw = await limitedText(response);
      if (!response.ok) fail(`Logitech returned HTTP ${response.status}. Check your login or try again later.`,response.status === 401 ? 401 : 502);
      return raw;
    } catch (error) { if (error instanceof ConfiguratorError) throw error; fail('The Logitech request did not complete. A submitted change may need verification before retrying.',502); }
  }
  async login(email, password, target) {
    if (typeof email !== 'string' || !email.includes('@') || email.length > 254 || typeof password !== 'string' || !password || password.length > 1024) fail('Enter your Logitech email and password.');
    this.cookies.clear(); this.target = null;
    const raw = await this.post('https://setup.myharmony.com/martiniweb/account/ProceedWithLIPLogin?provider=hp&state=&toucheck=True',JSON.stringify({ email,password }),{'Content-Type':'application/json'});
    let token; try { token = JSON.parse(raw); if (typeof token === 'string') token = JSON.parse(token); } catch { fail('Logitech returned an unsupported sign-in response.',502); }
    if (!token?.id_token || !token?.access_token) fail('This login method is not supported. Use a Logitech email/password account; social and legacy logins are not supported.',401);
    await this.post(`${SERVICES}/CompositeSecurityServices/Security.svc/json2/signin`,JSON.stringify({id_token:token.id_token,access_token:token.access_token}),{'Content-Type':'application/json'});
    const household = await this.soap('AccountManager','GetMyHousehold');
    this.target = selectHousehold(household,target.remoteId,target.accountId);
  }
  async soap(service, name, inner = '') {
    const xml = await this.post(`${SERVICES}/${endpoints[service]}/${service}.svc`, `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${operation(name,inner)}</s:Body></s:Envelope>`,{ 'Content-Type':'text/xml; charset=utf-8', SOAPAction:`"http://tempuri.org/I${service}/${name}"` });
    const parsed = parseXml(xml);
    if (descendants(parsed,'Fault').length) fail('Logitech rejected the operation. Refresh your configuration before trying another change.',502);
    if (!descendants(parsed,`${name}Response`).length) fail('Logitech did not confirm this operation.',502);
    return xml;
  }
  async activities() {
    if (!this.target) fail('Sign in to Logitech first.',401);
    return this.soap('UserAccountDirector','SimpleGetActivities',`<accountId>${id(this.target.accountId)}</accountId>`);
  }
  async verifyAccount() {
    if(!this.target) fail('Connect to Logitech first.',401);
    selectHousehold(await this.soap('AccountManager','GetMyHousehold'),this.target.remoteId,this.target.accountId);
  }
  async readDevice(change) {
    if(!this.target) fail('Connect to Logitech first.',401);
    const route=deviceRoute(change);if(!route) fail('Unsupported device setting.');
    const account=ownedDevice(await this.soap('AccountManager','GetMyHousehold'),this.target,change.id);
    const xml=route.resource === 'Device'
      ? await this.soap('DeviceManager','GetDevice',`<deviceId>${cloudId(change.id)}</deviceId>`)
      : await this.soap('UserFeatureManager','GetUserFeatures',deviceIds(change.id));
    return {...deviceDocument(xml,change),account};
  }
  async preview(change) {
    if(change.kind==='button') {
      const doc=await this.readButton(change), commands=await this.buttonCommands(change);
      buttonPatch(doc.raw,change,commands);
      return {before:buttonValue(doc.raw,change),fingerprint:doc.fingerprint};
    }
    if(change.kind==='activity') {
      const doc=await this.readActivity(change), dependencies=await this.activityDependencies(doc.raw,change);
      activityPatchDocument(doc.raw,change,dependencies.commands,dependencies.inputs);
      return {before:activityValue(doc.raw,change),fingerprint:doc.fingerprint};
    }
    const doc=await this.readDevice(change);
    const commands=settingSpec(change).type === 'actions' ? commandNames(await this.soap('DeviceManager','GetCommands',deviceIds(change.id)),change.id) : [];
    devicePatch(doc.raw,change,commands);
    return {before:deviceValue(doc.raw,change),fingerprint:doc.fingerprint};
  }
  async applyDevice(change,submitted,review) {
    const doc=await this.readDevice(change);
    if(!review || review.fingerprint !== doc.fingerprint) fail('The cloud device changed after review. Review the current cloud value again before saving.',409);
    const commands=settingSpec(change).type === 'actions' ? commandNames(await this.soap('DeviceManager','GetCommands',deviceIds(change.id)),change.id) : [];
    const patched=devicePatch(doc.raw,change,commands), body=deviceSaveBody(patched,change,doc.account);
    submitted();
    if(deviceRoute(change).resource === 'Device') await this.soap('DeviceManager','UpdateMyData',body);
    else await this.soap('UserFeatureManager','SaveUserFeatures',body);
    const after=await this.readDevice(change);
    if(!sameValue(deviceValue(after.raw,change),change.value)) fail('Logitech did not return the proposed value after saving. Check the setting in Harmony before retrying.',502);
  }
  async apply(change, submitted = () => {}, review) {
    if(change.kind==='button') {
      const doc=await this.readButton(change);
      if(!review || review.fingerprint!==doc.fingerprint) fail('The cloud button map changed after review. Review the current value again.',409);
      const patched=buttonPatch(doc.raw,change,await this.buttonCommands(change));
      submitted();await this.soap('UserButtonMappingManager','SaveButtonMaps',`<buttonMaps>${patched}</buttonMaps>`);
      // Saving a base map can assign a new map ID. Re-read by its owner/surface,
      // but refuse an ambiguous result rather than selecting another map.
      const docs=await this.readMaps({kind:change.ownerKind,id:change.id},change.mapTarget.surfaceId);
      const after=docs.length===1 ? docs[0] : selectMap(docs,change.mapTarget);
      if(!sameValue(buttonValue(after.raw,change),change.value)) fail('Logitech did not return the proposed button assignment. Verify it in Harmony before retrying.',502);
      return;
    }
    if(change.kind === 'device') return this.applyDevice(change,submitted,review);
    const doc=await this.readActivity(change);
    if(!review || review.fingerprint!==doc.fingerprint) fail('The cloud activity changed after review. Review the current cloud value again.',409);
    const dependencies=await this.activityDependencies(doc.raw,change), updated=activityPatchDocument(doc.raw,change,dependencies.commands,dependencies.inputs);
    submitted();
    await this.soap('ActivityManager','SaveActivities',`<accountId>${id(this.target.accountId)}</accountId><activities>${updated}</activities>`);
    // Verify by reading back rather than interpreting an empty Save response as proof.
    const after = await this.readActivity(change);
    if(!sameValue(activityValue(after.raw,change),change.value)) fail('Logitech did not return the proposed activity value after saving. Verify it in Harmony before retrying.',502);
  }
  async readActivity(change) {
    await this.verifyAccount();
    return activityDocument(await this.activities(),change);
  }
  async activityDependencies(raw,change) {
    const commands={}, inputs=[];
    if(settingSpec(change).type==='activity-actions') {
      const roles=children(child(parseXml(raw).children[0],'Roles'),'AbstractActivityRole');
      const household=await this.soap('AccountManager','GetMyHousehold');
      for(const device of new Set(change.value.filter(a=>a.kind==='command').map(a=>a.deviceId))) {
        if(!roles.some(r=>identity(raw,r,'DeviceId')===device)) fail('An action device no longer participates in this activity. Read the hub again.',409);
        ownedDevice(household,this.target,device);
        commands[device]=commandNames(await this.soap('DeviceManager','GetCommands',deviceIds(device)),device);
      }
    }
    if(change.field==='input') {
      const doc=await this.readDevice({kind:'device',id:change.roleTarget.deviceId,field:'inputOrder'});
      inputs.push(...children(child(parseXml(doc.raw).children[0],'Inputs'),'Input').map(n=>field(doc.raw,n,'InputName')));
    }
    return {commands,inputs};
  }
  async readMaps(owner,surfaceId) {
    if(!this.target) fail('Connect to Logitech first.',401);
    const household=await this.soap('AccountManager','GetMyHousehold');
    selectHousehold(household,this.target.remoteId,this.target.accountId);
    if(owner.kind==='device') ownedDevice(household,this.target,owner.id);
    else activityDocument(await this.activities(),owner);
    const surfaces=mapSurfaces(household,this.target).filter(s=>!surfaceId || s.surfaceId===surfaceId);
    if(!surfaces.length) fail('This remote surface is no longer available.',409);
    const docs=[];
    for(const surface of surfaces) docs.push(...mapDocuments(await this.soap('UserButtonMappingManager','GetButtonMaps',mapRequest(owner,surface,this.target.accountId)),owner,surface));
    return docs;
  }
  async buttonMaps(owner) {return (await this.readMaps(owner)).map(doc=>mapView(doc,owner));}
  async readButton(change) {return selectMap(await this.readMaps({kind:change.ownerKind,id:change.id},change.mapTarget.surfaceId),change.mapTarget);}
  async buttonCommands(change) {
    if(change.value===null) return [];
    const device=change.value.deviceId;
    ownedDevice(await this.soap('AccountManager','GetMyHousehold'),this.target,device);
    if(change.ownerKind==='device' && device!==change.id) fail('Choose this map’s device.',409);
    if(change.ownerKind==='activity') {
      const doc=activityDocument(await this.activities(),{id:change.id});
      if(!children(child(parseXml(doc.raw).children[0],'Roles'),'AbstractActivityRole').some(r=>identity(doc.raw,r,'DeviceId')===device)) fail('The selected device no longer belongs to this activity.',409);
    }
    return change.value.kind==='command' ? commandDetails(await this.soap('DeviceManager','GetCommands',deviceIds(device)),device) : [];
  }
  async infraredCodes(deviceId) {
    const doc=await this.readDevice({kind:'device',id:deviceId,field:'repeats'});
    if(!isInfrared({transport:field(doc.raw,parseXml(doc.raw).children[0],'Transport')})) fail('This device profile does not use confirmed infrared control.');
    return commandDetails(await this.soap('DeviceManager','GetCommands',deviceIds(deviceId)),deviceId).map(c=>({name:c.name,raw:c.raw.trim() && (!c.transport || isInfrared({transport:c.transport})) ? c.raw : null,protocolId:c.protocolId,transport:c.transport}));
  }
  async sync(progress = () => {}) {
    if (!this.target) fail('Sign in to Logitech first.',401);
    const { remoteId,accountId } = this.target;
    progress('Compiling the cloud configuration');
    await this.soap('CompileManager','StartCompileWithLocale',`${remote(remoteId)}<localeId>en-US</localeId>`);
    await this.soap('RemoteManager','SetRemoteSyncRequired',`${remote(remoteId)}<isRemoteSyncRequired>true</isRemoteSyncRequired>`);
    progress('Waiting for the hub to pull the configuration');
    for (let attempt = 0; attempt < 60; attempt++) {
      const xml = await this.soap('CompileManager','IsRemoteSyncRequired',remote(remoteId));
      const required = value(xml,descendants(parseXml(xml),'IsRemoteSyncRequiredResult')[0]);
      if (required === 'false') {
        await this.soap('RemoteManager','RegisterSuccessfulSync',`<accountId>${escape(accountId)}</accountId><remoteId>${escape(remoteId)}</remoteId>`);
        return;
      }
      if (required !== 'true') fail('The cloud returned an unknown sync status. Check the hub in the Harmony app.',502);
      await new Promise((resolve,reject) => {
        if (this.abort.signal.aborted) return reject(new ConfiguratorError('Sync interrupted.',503));
        const abort = () => { clearTimeout(timer); reject(new ConfiguratorError('Sync interrupted.',503)); };
        const timer = setTimeout(() => { this.abort.signal.removeEventListener('abort',abort); resolve(); },3000);
        this.abort.signal.addEventListener('abort',abort,{once:true});
      });
    }
    fail('Logitech saved the configuration, but the hub has not confirmed sync. Check its network connection and use Sync in the Harmony app.',504);
  }
  close() { this.abort.abort(); this.cookies.clear(); this.target = null; }
}
