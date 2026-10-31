import { isIP } from 'node:net';

export class ConfiguratorError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const fail = (message, status) => { throw new ConfiguratorError(message, status); };
export async function limitedText(response, limit = 8 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const parts = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) fail('The configuration response is too large.', 502);
      parts.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts).toString('utf8');
}

// Only reads. No command, activity-start, resource-write or arbitrary URL endpoint.
export class HubReader {
  constructor({ fetchImpl = fetch, Socket = WebSocket, timeout = 8000 } = {}) {
    this.fetch = fetchImpl; this.Socket = Socket; this.timeout = timeout; this.controllers = new Set(); this.sockets = new Set(); this.closed = false;
  }
  async read(host) {
    if (this.closed) fail('The configurator is stopping.', 503);
    if (isIP(host) !== 4 || /^(0|127|169\.254|22[4-9]|23\d|24\d|25[0-5])\./.test(host)) fail('Choose a configured Harmony hub LAN address.');
    const controller = new AbortController(); this.controllers.add(controller);
    let socket;
    try {
      const response = await this.fetch(`http://${host}:8088/`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeout)]),
        headers: { 'Content-Type': 'application/json', Origin: 'http://sl.dhg.myharmony.com' }, body: JSON.stringify({ id: 1, cmd: 'setup.account?getProvisionInfo', params: {} }) });
      if (!response.ok) fail('The hub refused its provisioning request. Check its address and local API access.', 502);
      const info = JSON.parse(await limitedText(response, 65536)).data;
      const remoteId = String(info?.activeRemoteId ?? ''), accountId = String(info?.accountId ?? '');
      if (!/^\d{1,20}$/.test(remoteId) || !/^[A-Za-z0-9_-]{1,64}$/.test(accountId)) fail('The hub did not provide the IDs needed to read its resources.', 502);
      socket = new this.Socket(`ws://${host}:8088/?domain=svcs.myharmony.com&hubId=${encodeURIComponent(remoteId)}`); this.sockets.add(socket);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => done(new ConfiguratorError('The hub WebSocket did not open. Check port 8088.', 504)), this.timeout);
        const opened = () => done(), failed = () => done(new ConfiguratorError('The hub WebSocket could not connect.', 502));
        const done = error => { clearTimeout(timer); socket.removeEventListener('open', opened); socket.removeEventListener('error', failed); socket.removeEventListener('close', failed); error ? reject(error) : resolve(); };
        socket.addEventListener('open', opened); socket.addEventListener('error', failed); socket.addEventListener('close', failed);
      });
      let sequence = 0;
      const request = name => new Promise((resolve, reject) => {
        const id = String(++sequence);
        const timer = setTimeout(() => done(new ConfiguratorError(`${name} was not returned by the hub.`, 504)), this.timeout);
        const failed = () => done(new ConfiguratorError('The hub connection closed while reading.', 502));
        const receive = event => {
          if (typeof event.data !== 'string' || event.data.length > 8 * 1024 * 1024) return done(new ConfiguratorError('Unexpected hub response.', 502));
          let message; try { message = JSON.parse(event.data); } catch { return; }
          message = message.hbus || message;
          if (String(message.id) !== id || String(message.code) === '100') return;
          if (String(message.code) !== '200' || (message.data?.code != null && String(message.data.code) !== '200')) return done(new ConfiguratorError(`${name} is unavailable on this hub.`, 502));
          let resource = message.data?.resource;
          try { if (typeof resource === 'string') resource = JSON.parse(resource); } catch { resource = null; }
          if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return done(new ConfiguratorError(`${name} has an unrecognized format.`, 502));
          done(null, resource);
        };
        const done = (error, value) => { clearTimeout(timer); socket.removeEventListener('message', receive); socket.removeEventListener('close', failed); socket.removeEventListener('error', failed); error ? reject(error) : resolve(value); };
        socket.addEventListener('message', receive); socket.addEventListener('close', failed); socket.addEventListener('error', failed);
        try { socket.send(JSON.stringify({ hubId: remoteId, timeout: Math.ceil(this.timeout / 1000), hbus: { id, cmd: 'proxy.resource?get', params: { uri: `harmony://Account/${accountId}/${name}` } } })); } catch { failed(); }
      });
      const resources = {}, unavailable = [];
      // Sequential requests avoid overwhelming older hub firmware.
      for (const name of ['DeviceList', 'ActivityList', 'MapList', 'FunctionList']) {
        try { resources[name] = await request(name); }
        catch (error) { if (['DeviceList', 'ActivityList'].includes(name)) throw error; unavailable.push(name); }
      }
      if (!Array.isArray(resources.DeviceList.DevicesWithFeatures) || !Array.isArray(resources.ActivityList.Activities)) fail('This hub returned an unsupported resource layout. Its current configuration has been preserved.', 502);
      return { host, remoteId, accountId, resources, unavailable, readAt: new Date().toISOString() };
    } catch (error) {
      if (error instanceof ConfiguratorError) throw error;
      fail('Could not read the Harmony hub. Check its address, port 8088 and network connection.', 502);
    } finally { controller.abort(); this.controllers.delete(controller); if (socket) { socket.close(); this.sockets.delete(socket); } }
  }
  close() { this.closed = true; for (const c of this.controllers) c.abort(); for (const s of this.sockets) s.close(); }
}
