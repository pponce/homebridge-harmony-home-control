import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { listen, closeServer, json, remoteIp } from '../http.js';
import { HubReader, ConfiguratorError, fail } from './hub.js';
import { project, validateContext, draftChange, digest } from './model.js';
import { draftValue, sameValue } from '../../configurator-web/settings.js';
import { suggestions } from './advice.js';
import { ConfiguratorStore } from './store.js';
import { validateConfiguratorPublicUrl } from '../config.js';
import { ConfiguratorAuth } from './auth.js';
import { HarmonyCloud } from './cloud.js';
import { HubSync } from './hub-sync.js';
import { LogitechCredentials } from './credentials.js';
import { deviceRoute } from './device-cloud.js';
import { buttonDraft } from './button-cloud.js';
import { activityRoute } from './activity-cloud.js';
import { reconcileIrCodes, saveIrCodes, viewIrCodes } from './ir-cache.js';

const token = () => randomBytes(32).toString('hex');
const equal = (a,b) => typeof a === 'string' && typeof b === 'string' && /^[a-f0-9]{64}$/.test(a) && a.length === b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const publicError = error => error instanceof ConfiguratorError ? error.message : 'The operation could not complete. Check the connection and try refreshing.';
const assets = { '/':'index.html', '/app.js':'app.js', '/help.js':'help.js', '/ir-code.js':'ir-code.js', '/settings.js':'settings.js', '/style.css':'style.css', '/icon-small.png':'../assets/icon-small.png', '/apple-touch-icon.png':'../assets/icon-large.png', '/manifest.webmanifest':'manifest.webmanifest' };
async function readBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) fail('Use application/json.',415);
  let size = 0; const parts = [];
  for await (const part of request) { size += part.length; if (size > 65536) fail('Request is too large.',413); parts.push(part); }
  let body; try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { fail('Invalid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Expected a JSON object.');
  return body;
}

export class ConfiguratorServer {
  constructor({ config, directory, reader = new HubReader(), syncer = new HubSync(), cloudFactory = () => new HarmonyCloud() }) {
    this.config = config; this.directory = directory; this.reader = reader; this.syncer = syncer; this.cloudFactory = cloudFactory;
    this.sessions = new Map(); this.grants = new Map(); this.work = null; this.job = null; this.closing = false;
  }
  async start() {
    const publicUrl = validateConfiguratorPublicUrl(this.config.configuratorPublicUrl);
    this.publicUrl = publicUrl ? new URL(publicUrl) : null;
    this.auth = await new ConfiguratorAuth(this.directory).load();
    this.loginAttempts = [];
    this.store = await new ConfiguratorStore(this.directory).load();
    this.credentials = await new LogitechCredentials(this.directory).load();
    const handler = (request,response) => this.handle(request,response).catch(error => { if (!response.headersSent) json(response,{error:publicError(error)},error.status || 500); else response.end(); });
    if (this.config.configuratorTlsCert && this.config.configuratorTlsKey) {
      const [cert,key] = await Promise.all([readFile(this.config.configuratorTlsCert),readFile(this.config.configuratorTlsKey)]);
      this.server = createHttpsServer({cert,key,minVersion:'TLSv1.2'},handler); this.secure = true;
    } else { this.server = createServer(handler); this.secure = false; }
    this.server.requestTimeout = 15000; this.server.headersTimeout = 15000; this.server.keepAliveTimeout = 3000;
    this.port = await listen(this.server,this.config.configuratorPort);
    this.origin = this.publicUrl?.origin || `${this.secure ? 'https' : 'http'}://${this.config.advertiseAddress}:${this.port}`;
    return this.port;
  }
  prune() {
    const now = Date.now();
    for (const [k,v] of this.grants) if (v < now) this.grants.delete(k);
    for (const [k,v] of this.sessions) if (v.expires < now && v !== this.activeSession) { v.cloud?.close(); this.sessions.delete(k); }
  }
  accessLink() {
    if (!this.server?.listening) fail('Enable the configurator, save settings and restart this child bridge.',409);
    this.prune();
    if (this.grants.size >= 32) this.grants.delete(this.grants.keys().next().value);
    const grant = token(); this.grants.set(grant,Date.now()+120000);
    return { url:`${this.origin}/#access=${grant}`, expiresIn:120 };
  }
  clearSessions() { for(const s of this.sessions.values()) s.cloud?.close();this.sessions.clear();this.grants.clear(); }
  async setPassword(password,username) { await this.auth.setPassword(password,username);this.clearSessions();return {ok:true}; }
  async revokeSessions() { await this.auth.revoke();this.clearSessions();return {ok:true}; }
  state(host, session, request) {
    const h = this.store.hub(host);
    const catalog=session.catalog?.host===host && session.catalog.identity===digest(h.identity) ? session.catalog : null;
    const review=session.review?.host === host && session.review.expires>Date.now() ? {key:session.review.key,token:session.review.token,before:session.review.before,expires:session.review.expires} : null;
    return { revision:this.store.data.revision, hosts:this.config.harmonyHubAddresses, host, snapshot:h.model, context:h.context, drafts:h.drafts.map(d=>d.kind === 'device' ? {...d,cloud:deviceRoute(d)} : d.kind==='activity' ? {...d,cloud:activityRoute(d)} : d), lastError:h.lastError,
      suggestions:suggestions(h.model,h.context), busy:!!this.work, sync:this.job, cloud:{ connected:!!session.cloud?.target, host:session.host || null, saved:this.credentials.has(host,h.identity), savedNeedsUpdate:this.credentials.hasAny(host) && !this.credentials.has(host,h.identity), review, maps:catalog?.maps || [], mapOwner:catalog?.mapOwner || null, buttonCatalog:catalog?.buttonCatalog || null, activityRoles:catalog?.activityRoles || null, codes:viewIrCodes(h), loginAvailable:!!request.socket.encrypted || ['127.0.0.1','::1'].includes(remoteIp(request)) } };
  }
  async handle(request,response) {
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    response.setHeader('Referrer-Policy','no-referrer'); response.setHeader('X-Content-Type-Options','nosniff'); response.setHeader('Cache-Control','no-store');
    const hostHeader = request.headers.host;
    const proxied = !!this.publicUrl && hostHeader === this.publicUrl.host;
    if (proxied && (!['127.0.0.1','::1'].includes(remoteIp(request)) || request.headers['x-forwarded-proto'] !== 'https')) return json(response,{error:'The configured HTTPS proxy must connect over loopback and set X-Forwarded-Proto to https.'},403);
    if (!proxied && ![`${this.config.advertiseAddress}:${this.port}`,`127.0.0.1:${this.port}`,`localhost:${this.port}`].includes(hostHeader)) return json(response,{error:'Unrecognized configurator host.'},403);
    const expectedOrigin = proxied ? this.publicUrl.origin : `${this.secure ? 'https' : 'http'}://${hostHeader}`;
    if (request.headers.origin && request.headers.origin !== expectedOrigin) return json(response,{error:'Open the configurator directly from Homebridge settings.'},403);
    if (request.headers['sec-fetch-site'] === 'cross-site' && (request.url !== '/' || request.method !== 'GET')) return json(response,{error:'Cross-site request refused.'},403);
    const url = new URL(request.url,expectedOrigin);
    if (request.method === 'GET' && assets[url.pathname]) {
      const name = assets[url.pathname], data = await readFile(new URL(`../../configurator-web/${name}`,import.meta.url));
      response.writeHead(200,{'Content-Type':name.endsWith('.png') ? 'image/png' : name.endsWith('.webmanifest') ? 'application/manifest+json' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8'}); return response.end(data);
    }
    this.prune();
    const loginAvailable = this.secure || proxied || ['127.0.0.1','::1'].includes(remoteIp(request));
    if(url.pathname === '/api/auth' && request.method === 'GET') return json(response,{configured:!!this.auth.data.password,usernameRequired:!!this.auth.data.username,loginAvailable});
    if(url.pathname === '/api/auth/login' && request.method === 'POST') {
      if(!loginAvailable || request.headers.origin !== expectedOrigin) fail('Use the HTTPS configurator URL to sign in.',403);
      this.loginAttempts=this.loginAttempts.filter(t=>t>Date.now()-60000);
      if(this.loginAttempts.length>=10) fail('Too many sign-in attempts. Wait one minute before trying again.',429);
      this.loginAttempts.push(Date.now());
      const input=await readBody(request), {key,session}=await this.auth.login(input.password,input.remember===true,input.username);
      if(this.sessions.size>=32) {const old=this.sessions.keys().next().value;this.sessions.get(old)?.cloud?.close();this.sessions.delete(old);}
      this.sessions.set(key,session);
      response.setHeader('Set-Cookie',`harmony_config=${key}; Path=/; HttpOnly; SameSite=Strict${input.remember===true?'; Max-Age=2592000':''}${this.secure || proxied?'; Secure':''}`);
      return json(response,{csrf:session.csrf});
    }
    if (url.pathname === '/api/session' && request.method === 'POST') {
      const input = await readBody(request), expiry = this.grants.get(input.access); this.grants.delete(input.access);
      if (!expiry || expiry < Date.now()) fail('This access link expired or was already used. Open a new link from Homebridge settings.',401);
      if (this.sessions.size >= 32) fail('Too many open sessions. Close older sessions or restart the child bridge.',429);
      const key = token(), session = {generation:this.auth.data.generation,csrf:token(),expires:Date.now()+12*60*60*1000}; this.sessions.set(key,session);
      response.setHeader('Set-Cookie',`harmony_config=${key}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${this.secure || proxied ? '; Secure' : ''}`);
      return json(response,{csrf:session.csrf});
    }
    const cookie = /(?:^|;\s*)harmony_config=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie || '')?.[1];
    let session = this.sessions.get(cookie);
    if (!session) { session=this.auth.restore(cookie);if(session) {if(this.sessions.size>=32) fail('Too many active sessions.',429);this.sessions.set(cookie,session);} }
    if(session && session.generation!==this.auth.data.generation) {session.cloud?.close();this.sessions.delete(cookie);session=null;}
    if (!session) fail('Your configurator session expired. Reload this page to sign in again.',401);
    if (url.pathname === '/api/session' && request.method === 'GET') return json(response,{csrf:session.csrf});
    if (!['GET','POST'].includes(request.method)) fail('Method not allowed.',405);
    if (request.method === 'POST' && !equal(request.headers['x-configurator-csrf'],session.csrf)) fail('Session check failed. Reopen the page from Homebridge.',403);
    const input = request.method === 'POST' ? await readBody(request) : {};
    if (request.method==='POST' && ['/api/auth/logout','/api/auth/revoke'].includes(url.pathname)) {
      if(url.pathname.endsWith('/revoke')) await this.revokeSessions();
      else {await this.auth.logout(cookie);session.cloud?.close();this.sessions.delete(cookie);}
      response.setHeader('Set-Cookie',`harmony_config=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${this.secure || proxied?'; Secure':''}`);return json(response,{ok:true});
    }
    const host = input.host || url.searchParams.get('host') || this.config.harmonyHubAddresses[0];
    if (!this.config.harmonyHubAddresses.includes(host)) fail('Choose a hub saved in the plugin settings.');
    if (url.pathname === '/api/state' && request.method === 'GET') return json(response,this.state(host,session,request));
    if (url.pathname === '/api/export' && request.method === 'GET') {
      response.setHeader('Content-Disposition','attachment; filename="harmony-setup.json"');
      const {snapshot,context,drafts} = this.state(host,session,request);
      return json(response,{format:'harmony-setup-review',version:1,snapshot,context,drafts:drafts.map(({mapTarget,...d})=>d),note:'Review before sharing: device names, hub address and your automation notes may identify your setup.'});
    }
    if (request.method !== 'POST') fail('Not found.',404);
    if (this.work) fail('Another operation is running. Wait for it to finish.',409);
    if (this.closing) fail('The child bridge is stopping.',503);
    if (input.revision !== this.store.data.revision) fail('This page is out of date. Reload before saving changes.',409);
    const work = this.perform(url.pathname,input,host,session,request);
    this.work = work; this.activeSession = session;
    try { await work; }
    finally { this.work = null; this.activeSession = null; }
    if (url.pathname === '/api/sync') {
      this.activeSession = session;
      this.work = this.runSync(host,session).finally(() => { this.work = null; this.activeSession = null; });
    }
    return json(response,this.state(host,session,request));
  }
  async editHub(host,edit) {
    return this.store.mutate(null,async data => { data.hubs[host] ||= this.store.hub(host); await edit(data.hubs[host]); });
  }
  async refresh(host) {
    try {
      const imported = await this.reader.read(host), model = project(imported);
      await this.editHub(host,h => {
        const previous=h.model;
        h.model = model; h.identity = {accountId:imported.accountId,remoteId:imported.remoteId}; h.lastError = null;
        reconcileIrCodes(h);
        for (const draft of h.drafts) {
          // Hub MapList can omit the remote's surface identity. A cloud readback
          // is recorded separately; an absent hub mapping cannot confirm a save.
          if(draft.kind==='button') continue;
          let item = (draft.kind === 'device' ? model.devices : model.activities).find(x => x.id === draft.id);
          if (draft.role !== undefined) {
            const old=previous?.activities.find(a => a.id === draft.id)?.roles[draft.role];
            draft.roleTarget ||= draft.cloud ? {id:draft.cloud.roleId,deviceId:draft.cloud.deviceId,type:draft.cloud.roleType} : old ? {id:old.id,deviceId:old.deviceId,type:old.type?.split(':')[0]} : null;
            const reference=draft.roleTarget;
            const matches=reference ? item?.roles.filter(r => r.id === reference.id && r.deviceId === reference.deviceId && r.type?.split(':')[0] === reference.type) || [] : [];
            item=matches.length === 1 ? matches[0] : undefined;
          }
          const observed = draftValue(item,draft.field,draft.inputName);
          if (item && sameValue(observed,draft.value)) { draft.status = 'hub-confirmed'; draft.verifiedAt = model.readAt; }
          else if (draft.status === 'draft' && (!item || !sameValue(observed,draft.before))) draft.status = 'conflict';
          else if (draft.status === 'hub-confirmed') draft.status = 'changed-again';
        }
      });
    } catch (error) { await this.editHub(host,h => {h.lastError = publicError(error);}); throw error; }
  }
  async perform(path,input,host,session,request) {
    if (path === '/api/refresh') return this.refresh(host);
    if (path === '/api/context') return this.editHub(host,h => { h.context = validateContext(input.context,h.model); });
    if (path === '/api/draft') return this.editHub(host,h => {
      const catalog=session.catalog?.host===host && session.catalog.identity===digest(h.identity) ? session.catalog : null;
      const draft = input.change?.kind==='button' ? buttonDraft(input.change,h.model,catalog?.maps || [],catalog?.buttonCatalog) : draftChange(input.change,h.model,catalog?.activityRoles), existing = h.drafts.find(d => d.key === draft.key);
      if (existing && !['draft','conflict','hub-confirmed','remote-confirmed','changed-again'].includes(existing.status)) fail('Verify the previous change before replacing it.',409);
      if (h.drafts.length >= 100 && !existing) fail('Review or discard existing changes before adding more.');
      h.drafts = h.drafts.filter(d => d.key !== draft.key); h.drafts.push(draft);
    });
    if (path === '/api/discard') return this.editHub(host,h => { h.drafts = h.drafts.filter(d => d.key !== input.key); });
    if (path === '/api/manual') return this.editHub(host,h => { const d = h.drafts.find(d => d.key === input.key); if (!d) fail('Change not found.',404); d.status = 'manual-pending'; });
    if(path==='/api/remote-verified') return this.editHub(host,h=>{const d=h.drafts.find(d=>d.key===input.key);if(d?.kind!=='button' || d.status!=='remote-check' || input.confirm!==true) fail('Sync this button change and check the remote first.');d.status='remote-confirmed';d.verifiedAt=new Date().toISOString();});
    if (path === '/api/logout') { session.cloud?.close(); session.cloud = null; session.host = null; session.review=null; return; }
    if (path === '/api/forget-login') {
      await this.credentials.forget(host,this.store.hub(host).identity);
      for(const s of this.sessions.values()) if(s.host===host) {s.cloud?.close();s.cloud=null;s.host=null;s.review=null;}
      return;
    }
    if (path === '/api/login') {
      if (!request.socket.encrypted && !['127.0.0.1','::1'].includes(remoteIp(request))) fail('Use HTTPS or a localhost SSH tunnel before entering Logitech credentials.',403);
      const target = this.store.hub(host).identity;
      if (!target) fail('Read the hub first so the login can be matched to the correct account.');
      session.cloud?.close(); session.cloud = null; session.host = null; session.review=null;
      const cloud = this.cloudFactory();
      try {
        await cloud.login(input.email,input.password,target);
        if(input.remember===true) {
          await this.credentials.save(host,target,{email:input.email,password:input.password});
          for(const s of this.sessions.values()) if(s.host===host) {s.cloud?.close();s.cloud=null;s.host=null;s.review=null;}
        }
        session.cloud = cloud; session.host = host;
      }
      catch (error) { cloud.close(); throw error; }
      finally {input.password='';}
      return;
    }
    if (!['/api/preview','/api/apply','/api/sync','/api/button-maps','/api/button-catalog','/api/activity-roles','/api/ir-codes'].includes(path)) fail('Not found.',404);
    if (!request.socket.encrypted && !['127.0.0.1','::1'].includes(remoteIp(request))) fail('Use HTTPS or a localhost SSH tunnel for Logitech cloud changes.',403);
    await this.connectSaved(host,session);
    const currentIdentity = this.store.hub(host).identity;
    if (session.cloud.target.remoteId !== currentIdentity?.remoteId || session.cloud.target.accountId !== currentIdentity?.accountId) fail('The hub identity changed. Sign out and sign in again for this hub.',409);
    if(['/api/button-maps','/api/button-catalog','/api/activity-roles','/api/ir-codes'].includes(path)) {
      const owner=input.owner, model=this.store.hub(host).model;
      if(!owner || !(owner.kind==='device' ? model.devices : owner.kind==='activity' && path!=='/api/ir-codes' ? model.activities : []).some(d=>d.id===owner.id)) fail('Choose a device or activity from the latest hub read.');
      if(path==='/api/activity-roles' && owner.kind!=='activity') fail('Choose an activity to load its role choices.');
      if(session.catalog?.host!==host || session.catalog.identity!==digest(currentIdentity)) session.catalog={host,identity:digest(currentIdentity)};
      if(path==='/api/button-maps') {session.catalog.maps=await this.withSavedLogin(host,session,()=>session.cloud.buttonMaps(owner));session.catalog.mapOwner=owner;}
      else if(path==='/api/button-catalog') session.catalog.buttonCatalog=await this.withSavedLogin(host,session,()=>session.cloud.buttonCatalog(owner));
      else if(path==='/api/activity-roles') session.catalog.activityRoles=await this.withSavedLogin(host,session,()=>session.cloud.activityRoles(owner.id));
      else {
        const commands=await this.withSavedLogin(host,session,()=>session.cloud.infraredCodes(owner.id));
        await this.editHub(host,h=>saveIrCodes(h,owner.id,commands));
      }
      return;
    }
    if (path === '/api/sync') { this.job = {host,status:'running',message:'Starting sync',startedAt:new Date().toISOString()}; return; }
    const draft = this.store.hub(host).drafts.find(d => d.key === input.key);
    if (!draft || !(draft.kind === 'device' ? deviceRoute(draft) : draft.kind==='activity' ? activityRoute(draft) : draft.cloud) || draft.status !== 'draft') fail('Only a reviewed, supported draft can be saved to Logitech.',409);
    if(path === '/api/preview') {
      session.review=null;
      const review=await this.withSavedLogin(host,session,()=>session.cloud.preview(draft));
      session.review={...review,token:token(),host,key:draft.key,digest:digest(draft),expires:Date.now()+5*60000};
      return;
    }
    if (input.confirm !== true) fail('Review the change and confirm Save to Logitech.');
    const review=session.review;session.review=null;
    if(!review || !equal(review.token,input.reviewToken) || review.host!==host || review.key!==draft.key || review.digest!==digest(draft) || review.expires<=Date.now()) fail('Review the current cloud value before saving this change.',409);
    let submitted = false;
    await this.editHub(host,h => {h.drafts.find(d => d.key === input.key).status = 'saving';});
    try {
      await this.withSavedLogin(host,session,()=>session.cloud.apply(draft,() => {submitted = true;},review),()=>!submitted);
      await this.editHub(host,h => {const d = h.drafts.find(d => d.key === input.key); d.status = 'cloud-saved'; d.cloudSavedAt = new Date().toISOString(); delete d.error;});
    } catch (error) {
      await this.editHub(host,h => {const d = h.drafts.find(d => d.key === input.key); d.status = submitted ? 'unconfirmed' : error.status === 409 ? 'conflict' : 'draft'; d.error = publicError(error);});
      throw error;
    }
  }
  async connectSaved(host,session,force=false) {
    const target=this.store.hub(host).identity;
    if(!force && session.host===host && session.cloud?.target) return;
    const credentials=await this.credentials.read(host,target);
    if(!credentials) fail('Save a Logitech login or connect for this session first.',401);
    session.cloud?.close();session.cloud=null;session.host=null;
    const cloud=this.cloudFactory();
    try {await cloud.login(credentials.email,credentials.password,target);session.cloud=cloud;session.host=host;}
    catch(error) {cloud.close();throw error;}
    finally {credentials.password='';}
  }
  async withSavedLogin(host,session,run,canRetry=()=>true) {
    try {return await run();}
    catch(error) {
      // Only retry an authentication failure before any write was submitted.
      if(error.status!==401 || !canRetry() || !this.credentials.has(host,this.store.hub(host).identity)) throw error;
      await this.connectSaved(host,session,true);
      return run();
    }
  }
  async runSync(host,session) {
    try {
      await this.withSavedLogin(host,session,()=>session.cloud.verifyAccount?.());
      await session.cloud.sync(message => {this.job.message = message;},(target,signal) => this.syncer.sync(host,target,{signal,progress:message=>{this.job.message=message;}}));
      this.job.message = 'Reading the hub to verify imported settings';
      await this.refresh(host);
      await this.editHub(host,h=>{for(const d of h.drafts) if(d.kind==='button' && d.status==='cloud-saved') d.status='remote-check';});
      this.job.status = 'complete'; this.job.message = 'Hub sync response received and settings read back. Changes matching the hub are marked confirmed; review any remaining differences.';
    } catch (error) { this.job.status = 'failed'; this.job.message = publicError(error); }
    this.job.finishedAt = new Date().toISOString();
  }
  async close() {
    this.closing = true; this.syncer.close(); this.reader.close();
    for (const s of this.sessions.values()) s.cloud?.close();
    await this.work?.catch(() => {});
    await closeServer(this.server); this.sessions.clear(); this.grants.clear();
    this.credentials?.close();
  }
}
