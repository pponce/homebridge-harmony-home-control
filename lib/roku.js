import { ROKU_KEYS, safeMessage } from './config.js';
import { makeServer, listen, closeServer, xml, json, escapeXml, hubAllowed, remoteIp } from './http.js';

export class RokuServer {
  constructor({ config, state, actions, report = () => {} }) { Object.assign(this, { config, state, actions, report }); this.held = new Map(); this.lastPress = new Map(); }
  description() {
    return `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><device><deviceType>urn:roku-com:device:player:1-0</deviceType><friendlyName>Harmony Home Control</friendlyName><manufacturer>Roku</manufacturer><modelDescription>Homebridge remote control proxy</modelDescription><modelName>Roku 4</modelName><modelNumber>4400X</modelNumber><serialNumber>${this.state.rokuSerial}</serialNumber><UDN>uuid:${this.state.uuid}</UDN></device></root>`;
  }
  deviceInfo() {
    return `<?xml version="1.0"?><device-info><udn>${this.state.uuid}</udn><serial-number>${this.state.rokuSerial}</serial-number><device-id>${this.state.rokuSerial}</device-id><vendor-name>Roku</vendor-name><model-number>4400X</model-number><model-name>Roku 4</model-name><model-region>US</model-region><user-device-name>Harmony Home Control</user-device-name><friendly-device-name>Harmony Home Control</friendly-device-name><software-version>7.5.0</software-version><software-build>09021</software-build><network-type>ethernet</network-type><supports-ethernet>true</supports-ethernet><ethernet-mac>${this.state.mac}</ethernet-mac><power-mode>PowerOn</power-mode><supports-suspend>false</supports-suspend><is-tv>false</is-tv></device-info>`;
  }
  async handle(request, response) {
    const path = new URL(request.url, 'http://localhost').pathname;
    // Descriptors contain no accessory details and are needed by discovery relays.
    if (request.method === 'GET' && path === '/') return xml(response, this.description());
    if (request.method === 'GET' && path === '/query/device-info') return xml(response, this.deviceInfo());
    if (!hubAllowed(request, this.config.harmonyHubAddresses)) return json(response, { error: 'This address is not an allowed Harmony hub.' }, 403);
    if (request.method === 'GET' && path === '/query/apps') return xml(response, '<apps></apps>');
    if (request.method === 'GET' && path === '/query/active-app') return xml(response, '<active-app><app>Home</app></active-app>');
    const match = path.match(/^\/(keypress|keydown|keyup)\/([A-Za-z]+)$/);
    if (request.method !== 'POST' || !match) return json(response, { error: 'Unknown Roku command.' }, 404);
    const [, kind, key] = match;
    if (!ROKU_KEYS.includes(key) && key !== 'PowerOff') return json(response, { error: 'Unsupported Roku key.' }, 400);
    // Do not attach accessory actions to Harmony's automatic power-management commands.
    if (key === 'PowerOff') { response.writeHead(200); return response.end(); }
    const origin = `${remoteIp(request)}:${key}`, now = Date.now();
    if (kind === 'keyup') { this.held.delete(origin); response.writeHead(200); return response.end(); }
    if ((this.held.get(origin) || 0) > now || now - (this.lastPress.get(origin) || 0) < 150) { response.writeHead(200); return response.end(); }
    if (kind === 'keydown') this.held.set(origin, now + 10000);
    this.lastPress.set(origin, now);
    const mapping = this.config.rokuButtons.find(item => item.key === key);
    if (!mapping) { this.report({ source: 'roku', name: `${key} received — no action assigned`, ok: true }); response.writeHead(200); return response.end(); }
    try {
      await this.actions.execute(mapping.action, `${mapping.name} (${key})`, 'roku');
      response.writeHead(200); response.end();
    } catch (error) { json(response, { error: safeMessage(error) }, 503); }
  }
  async start() { this.server = makeServer(this.handle.bind(this)); this.port = await listen(this.server, this.config.rokuPort); return this.port; }
  close() { return closeServer(this.server); }
}
