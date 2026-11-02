import test from 'node:test';
import assert from 'node:assert/strict';
import { HubSync } from '../lib/configurator/hub-sync.js';
import { HarmonyCloud } from '../lib/configurator/cloud.js';
const target={remoteId:'800',accountId:'900'},host='192.0.2.70';
function fixture(reply,{info={activeRemoteId:800,accountId:900},timeout=1000,open=true}={}) {
  const sent=[],sockets=[];
  class Socket extends EventTarget {
    constructor(url){super();this.url=url;this.closed=false;sockets.push(this);if(open)queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
    send(raw){const p=JSON.parse(raw);sent.push(p);reply?.(this,p);}
    message(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
    close(){this.closed=true;this.dispatchEvent(new Event('close'));}
  }
  const syncer=new HubSync({Socket,timeout,connectTimeout:100,fetchImpl:async(url,options)=>{
    assert.equal(url,'http://192.0.2.70:8088/');assert.equal(options.redirect,'error');
    assert.deepEqual(JSON.parse(options.body),{id:1,cmd:'setup.account?getProvisionInfo',params:{}});
    assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);
    return new Response(JSON.stringify({data:info}));
  }});
  return {syncer,sent,sockets};
}
test('local sync sends one fixed command, ignores notifications and progress, and waits for matching success',async()=>{
  const f=fixture((socket,p)=>{
    assert.deepEqual(p.hbus.params,{verb:'get',format:'json'});
    assert.equal(p.hbus.cmd,'setup.sync?None');assert.equal(p.hubId,'800');
    socket.message({type:'connect.stateDigest?notify',data:{syncStatus:1}});
    socket.message({id:'unrelated',code:200});
    socket.message({id:p.hbus.id,code:100});
    setTimeout(()=>socket.message({hbus:{id:p.hbus.id,code:200}}),5);
  });
  await f.syncer.sync(host,target);
  assert.equal(f.sent.length,1);assert.equal(f.sockets[0].closed,true);assert.equal(f.syncer.controllers.size,0);
});
test('local sync refuses a changed hub identity before opening a socket',async()=>{
  const f=fixture(null,{info:{activeRemoteId:801,accountId:900}});
  await assert.rejects(f.syncer.sync(host,target),/identity changed/);
  assert.equal(f.sent.length,0);assert.equal(f.sockets.length,0);
});
test('hub rejection and connection loss fail without repeating a sync request',async()=>{
  for(const reply of [(s,p)=>s.message({id:p.hbus.id,code:500,data:{secret:'private'}}),(s)=>s.close()]){
    const f=fixture(reply);await assert.rejects(f.syncer.sync(host,target),e=>e.status===502&&!e.message.includes('private'));
    assert.equal(f.sent.length,1);assert.equal(f.sockets[0].closed,true);
  }
});
test('sync has a bounded timeout and shutdown cancels an outstanding request',async()=>{
  const keepAlive=setInterval(()=>{},1000);
  try {
    const timed=fixture(null,{timeout:25});
    await assert.rejects(timed.syncer.sync(host,target),e=>e.status===504);
    assert.equal(timed.sent.length,1);assert.equal(timed.sockets[0].closed,true);
    const f=fixture(()=>queueMicrotask(()=>f.syncer.close()));
    await assert.rejects(f.syncer.sync(host,target),e=>e.status===503);
    assert.equal(f.sent.length,1);assert.equal(f.sockets[0].closed,true);
    await assert.rejects(f.syncer.sync(host,target),/stopping/);
    const cancelled=fixture(null),controller=new AbortController();controller.abort();
    await assert.rejects(cancelled.syncer.sync(host,target,{signal:controller.signal}));
    assert.equal(cancelled.sent.length,0);
    const unopened=fixture(null,{open:false});
    await assert.rejects(unopened.syncer.sync(host,target),/did not open/);
    assert.equal(unopened.sent.length,0);
  } finally {clearInterval(keepAlive);}
});
test('cloud preparation requires local trigger and never records success or retries a failed trigger',async()=>{
  const cloud=new HarmonyCloud(),ops=[];cloud.target=target;cloud.soap=async(service,name)=>{ops.push(name);return '';};
  await assert.rejects(cloud.sync(),/local hub sync/);assert.deepEqual(ops,[]);
  let triggers=0;
  await assert.rejects(cloud.sync(()=>{},async()=>{triggers++;throw new Error('sync disconnected');}),/sync disconnected/);
  assert.equal(triggers,1);
  assert.deepEqual(ops,['StartCompileWithLocale','SetRemoteSyncRequired']);
  cloud.close();
});
