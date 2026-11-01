import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { fail } from './hub.js';

// Reusable Logitech passwords must be recoverable, unlike the configurator login
// hash. Each opt-in entry is encrypted with AES-256-GCM and bound to a hub/account.
// The local key is separate and private, but server administrators can read both.
const entryKey = (host,target) => createHash('sha256').update(JSON.stringify([host,target?.accountId,target?.remoteId])).digest('hex');
const scopeKey = host => createHash('sha256').update(host).digest('hex');
const validCredentials = c => c && typeof c.email === 'string' && c.email.includes('@') && c.email.length <= 254 && typeof c.password === 'string' && c.password.length > 0 && c.password.length <= 1024;
async function readPrivate(file,max) {
  const handle=await open(file,constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat=await handle.stat();
    if(!stat.isFile() || stat.size>max || (stat.mode & 0o077) || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('Invalid private file');
    return await handle.readFile();
  } finally {await handle.close();}
}
export class LogitechCredentials {
  constructor(directory) {this.file=join(directory,'configurator-logitech.json');this.keyFile=join(directory,'configurator-logitech.key');this.entries={};this.key=null;}
  async load() {
    try {
      const data=JSON.parse((await readPrivate(this.file,1024*1024)).toString('utf8'));
      if(data.version!==1 || !data.entries || Array.isArray(data.entries) || typeof data.entries!=='object' || Object.keys(data.entries).length>64) throw new Error();
      for(const [key,e] of Object.entries(data.entries)) if(!/^[a-f0-9]{64}$/.test(key) || !e || !/^[a-f0-9]{64}$/.test(e.scope) || !/^[a-f0-9]{24}$/.test(e.iv) || !/^[a-f0-9]{32}$/.test(e.tag) || typeof e.ciphertext!=='string' || !/^[a-f0-9]{2,12000}$/.test(e.ciphertext) || e.ciphertext.length%2) throw new Error();
      this.entries=data.entries;
    } catch(error) {if(error.code!=='ENOENT') fail('Cannot read saved Logitech login storage. Its files have been preserved; check their owner and private permissions.',500);}
    return this;
  }
  has(host,target) {return !!target && Object.hasOwn(this.entries,entryKey(host,target));}
  hasAny(host) {return Object.values(this.entries).some(e=>e.scope===scopeKey(host));}
  async getKey(create=false) {
    if(this.key) return this.key;
    try {this.key=await readPrivate(this.keyFile,32);}
    catch(error) {
      if(error.code!=='ENOENT' || !create || Object.keys(this.entries).length) fail('The saved Logitech login key is unavailable. Forget the saved login and save it again; existing files have been preserved.',500);
      const key=randomBytes(32);let handle;
      try {handle=await open(this.keyFile,'wx',0o600);await handle.writeFile(key);await handle.sync();this.key=key;}
      catch {key.fill(0);fail('Could not create private Logitech login storage.',500);}
      finally {await handle?.close();}
    }
    if(this.key.length!==32) {this.key.fill(0);this.key=null;fail('The saved Logitech login key is invalid. Its file has been preserved.',500);}
    return this.key;
  }
  async persist(entries) {
    const temporary=`${this.file}.${randomBytes(12).toString('hex')}.tmp`;let handle;
    try {
      handle=await open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify({version:1,entries})+'\n');await handle.sync();await handle.close();handle=null;
      await rename(temporary,this.file);this.entries=entries;
    } catch {fail('Could not save the encrypted Logitech login. The previous saved login has been preserved.',500);}
    finally {await handle?.close();await unlink(temporary).catch(()=>{});}
  }
  async save(host,target,credentials) {
    if(!target?.accountId || !target?.remoteId || !validCredentials(credentials)) fail('Enter a valid Logitech email and password.');
    const id=entryKey(host,target);
    if(!Object.hasOwn(this.entries,id) && Object.keys(this.entries).length>=64) fail('Too many saved Logitech logins. Forget an unused login first.');
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',await this.getKey(true),iv);
    cipher.setAAD(Buffer.from(id));
    const plain=Buffer.from(JSON.stringify({email:credentials.email,password:credentials.password}));
    try {
      const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);
      const scope=scopeKey(host), entries=Object.fromEntries(Object.entries(this.entries).filter(([,e])=>e.scope!==scope));
      await this.persist({...entries,[id]:{scope,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')}});
    } finally {plain.fill(0);}
  }
  async read(host,target) {
    const id=entryKey(host,target), entry=this.entries[id];if(!entry) return null;
    const key=await this.getKey();let plain;
    try {
      const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(entry.iv,'hex'));decipher.setAAD(Buffer.from(id));decipher.setAuthTag(Buffer.from(entry.tag,'hex'));
      plain=Buffer.concat([decipher.update(Buffer.from(entry.ciphertext,'hex')),decipher.final()]);
      const result=JSON.parse(plain.toString('utf8'));if(!validCredentials(result)) throw new Error();return result;
    } catch {fail('The saved Logitech login could not be decrypted. Forget it and save the login again.',500);}
    finally {plain?.fill(0);}
  }
  async forget(host,target) {
    const next=Object.fromEntries(Object.entries(this.entries).filter(([id,e])=>id!==entryKey(host,target) && e.scope!==scopeKey(host)));await this.persist(next);
    if(!Object.keys(next).length) {this.close();await unlink(this.keyFile).catch(error=>{if(error.code!=='ENOENT') fail('The login was removed, but its unused encryption key could not be deleted.',500);});}
  }
  close() {this.key?.fill(0);this.key=null;}
}
