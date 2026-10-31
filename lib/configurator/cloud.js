import { ConfiguratorError, fail, limitedText } from './hub.js';
import { parseXml, child, children, descendants, identity, field, value, escape, standalone, patchScalar } from './xml.js';

const SERVICES = 'https://svcs.myharmony.com';
const COMMON = 'http://schemas.datacontract.org/2004/07/Logitech.Harmony.Services.Common.Contracts.Data';
const id = v => `<Value xmlns="${COMMON}" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:d="http://www.w3.org/2001/XMLSchema" i:type="d:long">${escape(v)}</Value>`;
const operation = (name, inner = '') => `<${name} xmlns="http://tempuri.org/">${inner}</${name}>`;
const remote = rid => `<remoteId>${id(rid)}</remoteId>`;
const endpoints = { AccountManager: 'HarmonyPlatform', UserAccountDirector: 'UserAccountDirectorPlatform', ActivityManager: 'ActivityPlatform', CompileManager: 'SyncPlatform', RemoteManager: 'RemotePlatform' };

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
  const root = parseXml(xml), matches = descendants(root,'Activity').filter(a => identity(xml,a) === change.id);
  if (matches.length !== 1) fail('The activity is missing or ambiguous in the cloud. Refresh your configuration.',409);
  let raw = standalone(xml,matches[0]), node = parseXml(raw).children[0];
  if (change.role !== undefined) {
    const matching = children(child(node,'Roles'),'AbstractActivityRole').filter(r => {
      const subtype = Object.entries(r.attributes).find(([key]) => key.split(':').at(-1) === 'type')?.[1]?.split(':').at(-1);
      return identity(raw,r,'DeviceId') === change.cloud.deviceId && subtype === change.cloud.roleType && (!change.cloud.roleId || identity(raw,r) === change.cloud.roleId);
    });
    if (matching.length !== 1) fail('The cloud activity role differs from the imported role. Refresh before editing.',409);
    node = matching[0];
  }
  const allowed = change.role === undefined ? ['Name','ActivityOrder'] : ['PowerOnOrder','PowerOffOrder'];
  if (!allowed.includes(change.cloud?.field)) fail('This field needs the Harmony app.');
  const target = child(node,change.cloud.field), current = value(raw,target);
  if (current !== String(change.before)) fail('The cloud setting has changed since import. Refresh and create a new draft.',409);
  raw = patchScalar(raw,target,change.value);
  return raw;
}

// Protocol facts: steverice/terraform-provider-harmony and congruity/congruity.
// No external project code is included. Cookies live only in this browser session's
// backend client. Neither passwords nor tokens are persisted or returned to the page.
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
      if (!response.ok) fail(`Logitech returned HTTP ${response.status}. Check your login or try again later.`,502);
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
  async apply(change, submitted = () => {}) {
    const raw = await this.activities(), updated = activityPatch(raw,change);
    submitted();
    await this.soap('ActivityManager','SaveActivities',`<accountId>${id(this.target.accountId)}</accountId><activities>${updated}</activities>`);
    // Verify by reading back rather than interpreting an empty Save response as proof.
    const after = await this.activities();
    activityPatch(after,{...change,before:change.value});
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
