import { randomBytes, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writePrivate } from '../state.js';
import { fail } from './hub.js';
const derive = promisify(scrypt);
const random = () => randomBytes(32).toString('hex');
const hash = key => createHash('sha256').update(key).digest('hex');
export class ConfiguratorAuth {
  constructor(directory) { this.file=join(directory,'configurator-auth.json'); this.data={version:1,generation:random(),password:null,sessions:{}}; this.queue=Promise.resolve(); }
  async load() {
    try {
      const d=JSON.parse(await readFile(this.file,'utf8'));
      if(d.version!==1 || !/^[a-f0-9]{64}$/.test(d.generation) || !d.sessions || Array.isArray(d.sessions) || typeof d.sessions!=='object' || (d.password && (!/^[a-f0-9]{64}$/.test(d.password.salt) || !/^[a-f0-9]{128}$/.test(d.password.hash)))) throw new Error();
      for(const [k,v] of Object.entries(d.sessions)) if(!/^[a-f0-9]{64}$/.test(k) || !Number.isFinite(v.expires) || !/^[a-f0-9]{64}$/.test(v.csrf)) throw new Error();
      if(d.username!==undefined && (typeof d.username!=='string' || !/^[a-z0-9._@-]{1,64}$/.test(d.username))) throw new Error();
      this.data=d;
    } catch(error) { if(error.code!=='ENOENT') fail('Cannot read configurator authentication state. Its file has been preserved.',500); }
    return this;
  }
  transact(fn) {
    const task=this.queue.then(async()=>{const next=structuredClone(this.data);const result=await fn(next);await writePrivate(this.file,next);this.data=next;return result;});
    this.queue=task.catch(()=>{});return task;
  }
  setPassword(password,username) {
    if(username!==undefined) {
      if(typeof username!=='string' || !/^[a-zA-Z0-9._@-]{1,64}$/.test(username.trim())) fail('Use a username of 1–64 letters, numbers, dots, underscores, @ signs or hyphens.');
      username=username.trim().toLowerCase();
    }
    if(typeof password!=='string' || password.length<8 || password.length>256) fail('Use a configurator password of 8–256 characters.');
    return this.transact(async d=>{const salt=random();if(username!==undefined)d.username=username;d.password={salt,hash:(await derive(password,salt,64)).toString('hex')};d.sessions={};d.generation=random();});
  }
  login(password,remember,username) {
    if(typeof password!=='string' || password.length>256) fail('Incorrect configurator username or password.',401);
    return this.transact(async d=>{
      if(!d.password) fail('Set a configurator password in Homebridge settings first.',401);
      const actual=await derive(password,d.password.salt,64);
      const usernameMatches=!d.username || (typeof username==='string' && username.length<=128 && timingSafeEqual(Buffer.from(hash(username.trim().toLowerCase()),'hex'),Buffer.from(hash(d.username),'hex')));
      if(!timingSafeEqual(actual,Buffer.from(d.password.hash,'hex')) || !usernameMatches) fail('Incorrect configurator username or password.',401);
      for(const [k,v] of Object.entries(d.sessions)) if(v.expires<Date.now()) delete d.sessions[k];
      if(Object.keys(d.sessions).length>=32) fail('Too many remembered sessions. Revoke sessions in Homebridge settings.',429);
      const key=random(),session={csrf:random(),expires:Date.now()+(remember?30*86400000:12*3600000),generation:d.generation};
      if(remember) d.sessions[hash(key)]={...session};
      return {key,session};
    });
  }
  restore(key) { if(!/^[a-f0-9]{64}$/.test(key || '')) return null;const s=this.data.sessions[hash(key)];return s?.expires>Date.now()?{...s,generation:this.data.generation}:null; }
  logout(key) {return this.transact(d=>{delete d.sessions[hash(key)];});}
  revoke() {return this.transact(d=>{d.sessions={};d.generation=random();});}
}
