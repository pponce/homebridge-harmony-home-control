import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfiguratorAuth } from '../lib/configurator/auth.js';
import { ConfiguratorServer } from '../lib/configurator/server.js';
import { normalizeConfig } from '../lib/config.js';
const password='testpass';
async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'hhc-auth-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return {directory,auth:await new ConfiguratorAuth(directory).load()};
}
test('password hashes and remembered sessions survive restart without storing credentials or bearer tokens',async t=>{
  const {directory,auth}=await fixture(t);
  assert.throws(()=>auth.setPassword('1234567'),/8–256/);
  await auth.setPassword(password);
  await assert.rejects(auth.login('wrong',true),/Incorrect/);
  const remembered=await auth.login(password,true), temporary=await auth.login(password,false);
  remembered.session.cloud={close(){},secret:'must-stay-in-memory'};
  await auth.login(password,false);
  const raw=await readFile(auth.file,'utf8');
  assert.ok(!raw.includes('must-stay-in-memory'));
  assert.ok(!raw.includes(password));assert.ok(!raw.includes(remembered.key));
  assert.equal((await stat(auth.file)).mode & 0o777,0o600);
  const restarted=await new ConfiguratorAuth(directory).load();
  assert.equal(restarted.restore(remembered.key).csrf,remembered.session.csrf);
  assert.equal(restarted.restore(temporary.key),null);
  await restarted.logout(remembered.key);
  assert.equal((await new ConfiguratorAuth(directory).load()).restore(remembered.key),null);
  const again=await restarted.login(password,true);
  await restarted.revoke();assert.equal(restarted.restore(again.key),null);
  const last=await restarted.login(password,true);
  await restarted.setPassword('a different password');
  assert.equal(restarted.restore(last.key),null);
  await assert.rejects(restarted.login(password,true),/Incorrect/);
  await restarted.login('a different password',false);
});
test('invalid auth storage fails closed and is preserved',async t=>{
  const {directory,auth}=await fixture(t);
  await writeFile(auth.file,'broken');
  await assert.rejects(new ConfiguratorAuth(directory).load(),/preserved/);
  assert.equal(await readFile(auth.file,'utf8'),'broken');
});
test('direct login requires origin, remembers across server restart, enforces CSRF and revokes sessions',async t=>{
  const {directory}=await fixture(t);
  const config={...normalizeConfig(),advertiseAddress:'127.0.0.1',harmonyHubAddresses:['192.0.2.70'],configuratorPort:0};
  let server=new ConfiguratorServer({directory,config});
  await server.start();t.after(()=>server.close());
  await server.setPassword(password);
  let origin='http://127.0.0.1:'+server.port;
  const post=(path,body,headers={})=>fetch(origin+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body:JSON.stringify(body)});
  assert.equal((await post('auth/login',{password},{Origin:'https://evil.invalid'})).status,403);
  assert.equal((await post('auth/login',{password},{Origin:''})).status,403);
  assert.equal((await post('auth/login',{password:'wrong'})).status,401);
  const login=await post('auth/login',{password,remember:true});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0],{csrf}=await login.json();
  assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Max-Age=2592000/);
  await server.close();
  server=new ConfiguratorServer({directory,config});await server.start();
  origin='http://127.0.0.1:'+server.port;
  assert.equal((await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await post('auth/revoke',{}, {Cookie:cookie})).status,403);
  assert.equal((await post('auth/revoke',{}, {Cookie:cookie,'X-Configurator-CSRF':csrf})).status,200);
  assert.equal((await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).status,401);
  for(let i=0;i<10;i++) assert.equal((await post('auth/login',{password:'wrong'})).status,401);
  assert.equal((await post('auth/login',{password})).status,429);
});
test('username migration preserves old login until configured, then requires both credentials across restart',async t=>{
  const {directory,auth}=await fixture(t);
  await auth.setPassword(password);
  const old=await auth.login(password,true);
  assert.throws(()=>auth.setPassword(password,''),/username/);
  assert.throws(()=>auth.setPassword(password,'bad name'),/username/);
  await auth.setPassword(password,' TestUser ');
  assert.equal(auth.restore(old.key),null);
  const restarted=await new ConfiguratorAuth(directory).load();
  for(const username of [undefined,'','other']) await assert.rejects(restarted.login(password,false,username),/Incorrect configurator username or password/);
  await assert.rejects(restarted.login('wrong',false,'testuser'),/Incorrect configurator username or password/);
  await restarted.login(password,false,'TESTUSER');
  await restarted.setPassword('new-test-password');
  await assert.rejects(restarted.login('new-test-password',false),/Incorrect/);
  await restarted.login('new-test-password',false,'testuser');
  await restarted.setPassword(password,'newuser');
  await assert.rejects(restarted.login(password,false,'testuser'),/Incorrect/);
  await restarted.login(password,false,'newuser');
});
test('username metadata omits identity, login enforces it, and icons are available before login',async t=>{
  const {directory}=await fixture(t);
  const server=new ConfiguratorServer({directory,config:{...normalizeConfig(),advertiseAddress:'127.0.0.1',harmonyHubAddresses:['192.0.2.70'],configuratorPort:0}});
  await server.start();t.after(()=>server.close());
  await server.setPassword(password,'testuser');
  const origin='http://127.0.0.1:'+server.port;
  const metadata=await (await fetch(origin+'/api/auth')).json();
  assert.equal(metadata.usernameRequired,true);
  assert.ok(!JSON.stringify(metadata).includes('testuser'));
  for(const username of ['other','TESTUSER']){
    const response=await fetch(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    assert.equal(response.status,username==='other'?401:200);
  }
  const manifestResponse=await fetch(origin+'/manifest.webmanifest');
  assert.equal(manifestResponse.headers.get('content-type'),'application/manifest+json');
  const manifest=await manifestResponse.json();
  assert.equal(manifest.start_url,'/');
  for(const icon of manifest.icons){
    const response=await fetch(origin+icon.src);
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
    const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(1,4).toString(),'PNG');
    assert.equal(icon.sizes,bytes.readUInt32BE(16)+'x'+bytes.readUInt32BE(20));
  }
});
