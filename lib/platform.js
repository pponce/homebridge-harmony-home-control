import { join } from 'node:path';
import { rm, mkdir, readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { STORAGE, normalizeConfig, validateConfig, configHash, safeMessage } from './config.js';
import { StateStore, writePrivate } from './state.js';
import { CombinedAccess } from './access.js';
import { Actions } from './actions.js';
import { HueServer } from './hue.js';
import { RokuServer } from './roku.js';
import { Discovery, hueAdvertisements, rokuAdvertisements } from './ssdp.js';
import { makeServer, listen, closeServer, json, body } from './http.js';
import { ConfiguratorServer } from './configurator/server.js';

export class HarmonyPlatform {
  constructor(log, config, api) {
    this.log = log; this.config = normalizeConfig(config); this.api = api;
    this.directory = join(api.user.storagePath(), STORAGE); this.runtimeFile = join(this.directory, 'runtime.json');
    this.events = []; this.status = { running: true, hue: 'Not started', roku: 'Not started', discovery: 'Not started', errors: [] };
    api.on('didFinishLaunching', () => { this.starting = this.start().catch(error => { this.status.errors.push(safeMessage(error)); log.error(safeMessage(error)); }); });
    api.on('shutdown', () => { void (async () => { await this.starting; await this.close(); })(); });
  }
  // The platform is a protocol proxy. It never publishes HomeKit accessories.
  configureAccessory() {}
  report(event) {
    this.events.unshift({ time: new Date().toISOString(), ...event }); this.events.length = Math.min(this.events.length, 30);
    if (!event.ok) this.log.warn(`${event.name}: ${event.message}`);
  }
  async start() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.adminToken = randomBytes(32).toString('hex');
    this.admin = makeServer(async (request, response) => {
      const received = Buffer.from(request.headers.authorization || ''); const expected = Buffer.from(`Bearer ${this.adminToken}`);
      if (received.length !== expected.length || !timingSafeEqual(received,expected)) return json(response,{ error: 'Unauthorized' },401);
      if (request.method === 'GET' && request.url === '/status') return json(response, this.getStatus());
      if (request.method === 'POST' && request.url === '/configurator/open') {
        if (!this.configurator?.server?.listening) return json(response,{ error: 'Enable the configurator, save settings and restart this child bridge.' },409);
        return json(response,this.configurator.accessLink());
      }
      if (request.method === 'POST' && ['/configurator/password','/configurator/revoke'].includes(request.url)) {
        if (!this.configurator?.server?.listening) return json(response,{error:'Enable the configurator and restart the child bridge first.'},409);
        try {
          if(request.url.endsWith('/password')) { const input=await body(request);return json(response,await this.configurator.setPassword(input.password,input.username)); }
          return json(response,await this.configurator.revokeSessions());
        }
        catch(error) { return json(response,{error:error.status?error.message:'Could not update configurator authentication.'},error.status || 500); }
      }
      if (request.method === 'POST' && request.url === '/pair') {
        if (!this.hue?.server?.listening) return json(response,{ error: 'Save your settings and restart the plugin to start Hue.' },409);
        const window = this.hue.openPairing();
        this.discovery?.announce('ssdp:alive');
        return json(response, window);
      }
      return json(response,{ error: 'Not found' },404);
    });
    const adminPort = await listen(this.admin, 0, '127.0.0.1');
    await writePrivate(this.runtimeFile, { port: adminPort, token: this.adminToken });
    this.state = await new StateStore(this.directory).load();
    try { this.config = validateConfig(this.config); }
    catch (error) { this.status.errors.push(safeMessage(error)); this.log.info('Open the plugin settings to finish connection setup.'); return; }
    this.status.configurator = 'Disabled';
    if (this.config.configuratorEnabled) {
      try {
        this.configurator = new ConfiguratorServer({config:this.config,directory:this.directory});
        const port = await this.configurator.start();
        this.status.configurator = `Listening on port ${port}`;
        this.log.info(`Harmony configurator listening on port ${port}. Open it from the plugin settings.`);
      } catch {
        await this.configurator?.close();
        this.status.configurator = 'Could not start. Check the configurator port and HTTPS certificate paths.';
        this.status.errors.push(this.status.configurator); this.log.error(this.status.configurator);
      }
    }
    this.access = new CombinedAccess({ configPath: this.api.user.configPath(), directory: this.directory, bridges: this.config.hueBridges, log: this.log });
    this.actions = new Actions(this.access, this.report.bind(this));
    await this.access.start();
    await this.state.assignLightIds(this.config.hueDevices);
    const advertisements = [];
    for (const protocol of ['hue', 'roku']) {
      if (!this.config[`${protocol}Enabled`]) { this.status[protocol] = 'Disabled'; continue; }
      try {
        const common = { config: this.config, state: this.state, access: this.access, actions: this.actions, report: this.report.bind(this) };
        this[protocol] = protocol === 'hue' ? new HueServer(common) : new RokuServer(common);
        const port = await this[protocol].start(); this.status[protocol] = `Listening on port ${port}`;
        advertisements.push(...(protocol === 'hue' ? hueAdvertisements({ address: this.config.advertiseAddress, port, uuid: this.state.uuid, bridgeId: this.state.bridgeId }) : rokuAdvertisements({ address: this.config.advertiseAddress, port, serial: this.state.rokuSerial })));
      } catch (error) {
        const message = error.code === 'EADDRINUSE' ? `${protocol}: port is already in use. Choose a free port in settings.` : error.code === 'EACCES' ? `${protocol}: permission denied for this port. Choose a port above 1024 or configure port forwarding.` : `${protocol}: ${safeMessage(error)}`;
        this.status[protocol] = message; this.status.errors.push(message); this.log.error(message);
      }
    }
    if (advertisements.length) {
      this.discovery = new Discovery({ interfaceAddress: this.config.advertiseAddress, hubs: this.config.harmonyHubAddresses, advertisements, log: this.log });
      try { await this.discovery.start(); this.status.discovery = 'Advertising Hue/Roku locally'; }
      catch (error) { this.discovery.close(); const message = `Discovery could not start (${error.code || safeMessage(error)}). Select a local LAN interface and check UDP port 1900.`; this.status.discovery = message; this.status.errors.push(message); this.log.warn(message); }
    }
    this.log.info('Harmony proxy started. Assign remote buttons in the Harmony app after pairing.');
  }
  getStatus() {
    return { ...this.status, discoveryDiagnostics: this.discovery?.diagnostics || null, pairingDiagnostic: this.hue?.pairingDiagnostic || null, configHash: configHash(this.config), pairingUntil: this.hue?.pairUntil || 0, pairedClients: Object.keys(this.state?.data.users || {}).length,
      accessories: this.access?.services.size || 0, realHueBridges: this.access?.hue.status || [], events: this.events, accessoryError: this.access?.lastError || null };
  }
  async close() {
    this.access?.close(); this.discovery?.close();
    await Promise.all([this.hue?.close(), this.roku?.close(), this.configurator?.close(), closeServer(this.admin)]);
    // Do not remove the connection file of a newer process during a restart.
    try { const current = JSON.parse(await readFile(this.runtimeFile,'utf8')); if (current.token === this.adminToken) await rm(this.runtimeFile); } catch {}
  }
}
