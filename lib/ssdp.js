import { createSocket } from 'node:dgram';

const GROUP = '239.255.255.250';
export function hueAdvertisements({ address, port, uuid, bridgeId }) {
  const base = { location: `http://${address}:${port}/description.xml`, server: 'Linux/1.0 UPnP/1.0 IpBridge/1.17.0', bridgeId };
  return ['upnp:rootdevice', `uuid:${uuid}`, 'urn:schemas-upnp-org:device:basic:1'].map(st => ({ ...base, st, usn: st.startsWith('uuid:') ? st : `uuid:${uuid}::${st}` }));
}
export function rokuAdvertisements({ address, port, serial }) {
  return [{ location: `http://${address}:${port}/`, server: 'Roku UPnP/1.0', st: 'roku:ecp', usn: `uuid:roku:ecp:${serial}` }];
}
export function matchSearch(message, advertisements) {
  if (message.length > 8192) return [];
  const lines = message.toString().split(/\r?\n/);
  if (!/^M-SEARCH \* HTTP\/1\.1$/i.test(lines.shift())) return [];
  const headers = Object.fromEntries(lines.filter(line => line.includes(':')).map(line => { const at = line.indexOf(':'); return [line.slice(0,at).trim().toLowerCase(), line.slice(at+1).trim()]; }));
  if (headers.man?.toLowerCase() !== '"ssdp:discover"') return [];
  return advertisements.filter(ad => headers.st?.toLowerCase() === 'ssdp:all' || headers.st?.toLowerCase() === ad.st.toLowerCase());
}
export function searchResponse(ad) {
  return ['HTTP/1.1 200 OK', 'CACHE-CONTROL: max-age=1800', 'EXT:', `LOCATION: ${ad.location}`, `SERVER: ${ad.server}`, `ST: ${ad.st}`, `USN: ${ad.usn}`, ...(ad.bridgeId ? [`hue-bridgeid: ${ad.bridgeId}`] : []), '', ''].join('\r\n');
}
export class Discovery {
  constructor({ interfaceAddress, hubs, advertisements, log = console, port = 1900 }) {
    Object.assign(this, { interfaceAddress, hubs, advertisements, log, port }); this.timers = new Set(); this.rate = new Map();
  }
  async start() {
    this.socket = createSocket({ type: 'udp4', reuseAddr: true });
    this.socket.on('message', (message, peer) => {
      if (!this.hubs.includes(peer.address)) return;
      const now = Date.now(); const rate = this.rate.get(peer.address) || { time: now, count: 0 };
      if (now - rate.time >= 1000) { rate.time = now; rate.count = 0; }
      this.rate.set(peer.address, rate); if (++rate.count > 10) return;
      for (const ad of matchSearch(message, this.advertisements)) {
        const timer = setTimeout(() => { this.timers.delete(timer); this.send(searchResponse(ad), peer.port, peer.address); }, Math.random() * 100);
        this.timers.add(timer);
      }
    });
    await new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(this.port, '0.0.0.0', () => { this.socket.removeListener('error', reject); resolve(); });
    });
    this.socket.on('error', error => this.log.warn?.(`Discovery: ${error.code || 'UDP error'}`));
    this.socket.addMembership(GROUP, this.interfaceAddress);
    this.socket.setMulticastInterface(this.interfaceAddress); this.socket.setMulticastTTL(2);
    this.announce('ssdp:alive');
    this.interval = setInterval(() => this.announce('ssdp:alive'), 900000); this.interval.unref();
  }
  send(message, port = this.port || 1900, address = GROUP) { if (this.socket) this.socket.send(Buffer.from(message), port, address, () => {}); }
  announce(kind) {
    for (const ad of this.advertisements) this.send(['NOTIFY * HTTP/1.1', `HOST: ${GROUP}:${this.port}`, 'CACHE-CONTROL: max-age=1800', `LOCATION: ${ad.location}`, `SERVER: ${ad.server}`, `NT: ${ad.st}`, `NTS: ${kind}`, `USN: ${ad.usn}`, ...(ad.bridgeId ? [`hue-bridgeid: ${ad.bridgeId}`] : []), '', ''].join('\r\n'));
  }
  close() {
    clearInterval(this.interval); for (const timer of this.timers) clearTimeout(timer); this.timers.clear();
    if (this.socket) { this.announce('ssdp:byebye'); try { this.socket.close(); } catch {} this.socket = null; }
  }
}
