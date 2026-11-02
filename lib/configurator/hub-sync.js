import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { ConfiguratorError, fail, limitedText } from './hub.js';

// Fixed local sync operation, matching aioharmony's setup.sync command.
// No arbitrary command/URL or configuration-resource write interface.
export class HubSync {
  constructor({fetchImpl=fetch, Socket=WebSocket, timeout=180000, connectTimeout=8000}={}) {
    this.fetch=fetchImpl;this.Socket=Socket;this.timeout=timeout;this.connectTimeout=connectTimeout;
    this.controllers=new Set();this.closed=false;
  }
  async sync(host,target,{signal,progress=()=>{}}={}) {
    if(this.closed) fail('The configurator is stopping.',503);
    if(isIP(host)!==4 || /^(0|127|169\.254|22[4-9]|23\d|24\d|25[0-5])\./.test(host)) fail('Choose a configured Harmony hub LAN address.');
    if(!/^\d{1,20}$/.test(target?.remoteId || '') || !/^[A-Za-z0-9_-]{1,64}$/.test(target?.accountId || '')) fail('Read the hub and connect to Logitech before syncing.',409);
    const controller=new AbortController();this.controllers.add(controller);
    const bounded=AbortSignal.any([controller.signal,AbortSignal.timeout(this.timeout),...(signal?[signal]:[])]);
    let socket;
    try {
      const response=await this.fetch(`http://${host}:8088/`,{method:'POST',redirect:'error',
        signal:AbortSignal.any([bounded,AbortSignal.timeout(this.connectTimeout)]),
        headers:{'Content-Type':'application/json',Origin:'http://sl.dhg.myharmony.com'},
        body:JSON.stringify({id:1,cmd:'setup.account?getProvisionInfo',params:{}})});
      if(!response.ok) fail('The hub refused its provisioning request. Check its address and port 8088.',502);
      const info=JSON.parse(await limitedText(response,65536)).data;
      if(String(info?.activeRemoteId)!==String(target.remoteId) || String(info?.accountId)!==String(target.accountId)) fail('The hub identity changed. Read the hub and reconnect to Logitech before syncing.',409);
      bounded.throwIfAborted();
      socket=new this.Socket(`ws://${host}:8088/?domain=svcs.myharmony.com&hubId=${encodeURIComponent(target.remoteId)}`);
      await new Promise((resolve,reject)=>{
        const id=randomUUID();let sent=false,settled=false;
        const done=error=>{
          if(settled)return;settled=true;clearTimeout(openTimer);
          socket.removeEventListener('open',opened);socket.removeEventListener('message',receive);
          socket.removeEventListener('error',failed);socket.removeEventListener('close',failed);
          bounded.removeEventListener('abort',aborted);error?reject(error):resolve();
        };
        const failed=()=>done(new ConfiguratorError(sent?'The hub connection closed before sync was confirmed. The request was not retried. Use Sync in the Harmony app, then Read hub.':'Could not connect to the hub for sync. Check port 8088.',502));
        const aborted=()=>done(new ConfiguratorError(bounded.reason?.name==='TimeoutError'?'The hub did not confirm sync within three minutes. The request was not retried. Use Sync in the Harmony app, then Read hub.':'Hub sync interrupted. The request was not retried.',bounded.reason?.name==='TimeoutError'?504:503));
        const opened=()=>{
          clearTimeout(openTimer);
          if(sent)return;
          sent=true;
          try {
            socket.send(JSON.stringify({hubId:String(target.remoteId),timeout:Math.ceil(this.timeout/1000),
              hbus:{id,cmd:'setup.sync?None',params:{verb:'get',format:'json'}}}));
            progress('Sync requested from the hub; waiting for its response');
          } catch {failed();}
        };
        const receive=event=>{
          if(typeof event.data!=='string' || event.data.length>65536)return done(new ConfiguratorError('Unexpected hub sync response.',502));
          let message;try{message=JSON.parse(event.data);}catch{return;}
          message=message?.hbus || message;
          if(!message || String(message.id)!==id)return;
          if(String(message.code)==='100')return;
          if(String(message.code)!=='200' || (message.data?.code!=null && String(message.data.code)!=='200'))return done(new ConfiguratorError('The hub rejected the sync request. Use Sync in the Harmony app, then Read hub.',502));
          done();
        };
        const openTimer=setTimeout(()=>done(new ConfiguratorError('The hub WebSocket did not open. Check port 8088.',504)),this.connectTimeout);
        socket.addEventListener('open',opened);socket.addEventListener('message',receive);
        socket.addEventListener('error',failed);socket.addEventListener('close',failed);
        bounded.addEventListener('abort',aborted,{once:true});
        if(bounded.aborted)aborted();
      });
    } catch(error) {
      if(error instanceof ConfiguratorError)throw error;
      if(bounded.aborted)fail('Hub sync interrupted or timed out. Use Sync in the Harmony app, then Read hub.',504);
      fail('Could not contact the hub for sync. Check its address, port 8088 and network connection.',502);
    } finally {
      controller.abort();this.controllers.delete(controller);
      try{socket?.close();}catch{}
    }
  }
  close(){this.closed=true;for(const c of this.controllers)c.abort();}
}
