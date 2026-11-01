import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, stat, chmod } from 'node:fs/promises';
import { temporary } from './helpers.js';
import { LogitechCredentials } from '../lib/configurator/credentials.js';

const host='192.0.2.70',target={accountId:'900',remoteId:'800'},credentials={email:'vault-test@example.invalid',password:'a-secret-that-must-not-appear'};
test('opt-in Logitech login is authenticated-encrypted, private, restartable and bound to a hub/account',async t=>{
  const directory=await temporary(t), vault=await new LogitechCredentials(directory).load();
  assert.equal(vault.has(host,target),false);assert.equal(await vault.read(host,target),null);
  await vault.save(host,target,credentials);
  const raw=await readFile(vault.file,'utf8'), key=await readFile(vault.keyFile);
  assert.ok(!raw.includes(credentials.password));assert.ok(!raw.includes(credentials.email));assert.ok(!raw.includes(key.toString('hex')));
  for(const f of [vault.file,vault.keyFile]) assert.equal((await stat(f)).mode & 0o777,0o600);
  vault.close();
  const restarted=await new LogitechCredentials(directory).load();t.after(()=>restarted.close());
  assert.deepEqual(await restarted.read(host,target),credentials);
  assert.equal(await restarted.read('192.0.2.71',target),null);
  assert.equal(await restarted.read(host,{...target,remoteId:'801'}),null);
  await restarted.save('192.0.2.71',target,{...credentials,password:'different-password'});
  const entries=JSON.parse(await readFile(vault.file,'utf8')).entries, ids=Object.keys(entries);
  [entries[ids[0]],entries[ids[1]]]=[entries[ids[1]],entries[ids[0]]];
  await writeFile(vault.file,JSON.stringify({version:1,entries}));
  const swapped=await new LogitechCredentials(directory).load();t.after(()=>swapped.close());
  await assert.rejects(swapped.read(host,target),/could not be decrypted/);
});
test('damaged or broadly readable credential storage fails closed; forgetting removes the last key',async t=>{
  const directory=await temporary(t), vault=await new LogitechCredentials(directory).load();t.after(()=>vault.close());
  await vault.save(host,target,credentials);vault.close();
  const data=JSON.parse(await readFile(vault.file,'utf8')), entry=Object.values(data.entries)[0];entry.ciphertext=(entry.ciphertext[0]==='0'?'1':'0')+entry.ciphertext.slice(1);
  await writeFile(vault.file,JSON.stringify(data));
  const restarted=await new LogitechCredentials(directory).load();t.after(()=>restarted.close());
  await assert.rejects(restarted.read(host,target),e=>/decrypt/.test(e.message)&&!e.message.includes(credentials.password));
  await chmod(vault.file,0o644);await assert.rejects(new LogitechCredentials(directory).load(),/private permissions/);await chmod(vault.file,0o600);
  await restarted.forget(host,target);assert.equal(restarted.has(host,target),false);
  await assert.rejects(stat(vault.keyFile),{code:'ENOENT'});
  await restarted.save(host,target,credentials);assert.deepEqual(await restarted.read(host,target),credentials);
});
test('replacing a hub account replaces its saved entry; stale bindings can still be forgotten',async t=>{
  const directory=await temporary(t),vault=await new LogitechCredentials(directory).load();t.after(()=>vault.close());
  await vault.save(host,target,credentials);const next={...target,remoteId:'801'};
  assert.equal(vault.has(host,next),false);assert.equal(vault.hasAny(host),true);
  await vault.save(host,next,{...credentials,password:'replacement'});assert.equal(await vault.read(host,target),null);assert.equal(Object.keys(vault.entries).length,1);
  await vault.forget(host,target);assert.equal(vault.hasAny(host),false);
});
