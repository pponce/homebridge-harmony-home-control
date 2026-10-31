import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HapAccess, longUuid } from '../lib/hap.js';
import { listen, closeServer, json } from '../lib/http.js';
import { StateStore } from '../lib/state.js';
import { Actions } from '../lib/actions.js';
import { normalizeConfig } from '../lib/config.js';

export const ON = longUuid('25'), BRI = longUuid('8'), CUSTOM = 'CCCCCCCC-0000-1000-8000-0026BB765291';
export const BRIDGE = 'AA:BB:CC:DD:EE:FF', SERVICE = `${BRIDGE}/2/10`;
export async function temporary(t) {
  const root = join(process.cwd(),'local-work','artifacts'); await mkdir(root,{ recursive: true });
  const directory = await mkdtemp(join(root,'test-')); t.after(() => rm(directory,{ recursive: true, force: true })); return directory;
}
export async function fixture(t) {
  const directory = await temporary(t), configPath = join(directory,'config.json');
  await writeFile(configPath,JSON.stringify({ bridge: { pin: '031-45-154' }, platforms: [{ _bridge: { username: BRIDGE, pin: '031-45-155' } }] }));
  const writes = [], seenPins = []; const values = { 11: false, 12: 50, 13: false, 14: false }; let rejectWrites = false;
  const hap = createServer(async (request,response) => {
    seenPins.push(request.headers.authorization);
    if (request.headers.authorization !== '031-45-155') return json(response,{},470);
    const route = new URL(request.url,'http://localhost');
    if (route.pathname === '/accessories') return json(response,{ accessories: [{ aid: 2, services: [
      { iid: 1, type: '3E', characteristics: [{ iid: 2, type: '23', format: 'string', perms: ['pr'], value: 'Reading lamp' }] },
      { iid: 10, type: '43', characteristics: [
        { iid: 11, type: '25', format: 'bool', perms: ['pr','pw','ev'], value: values[11] },
        { iid: 12, type: '8', format: 'int', minValue: 0, maxValue: 100, minStep: 1, perms: ['pr','pw'], value: values[12] },
        { iid: 13, type: CUSTOM, description: 'Custom switch', format: 'bool', perms: ['pr','pw'], value: values[13] },
        { iid: 14, type: 'F00', description: 'Timed write', format: 'bool', perms: ['pr','pw','tw'], value: false },
      ] },
    ] }] });
    if (request.method === 'GET' && route.pathname === '/characteristics') { const iid = Number(route.searchParams.get('id').split('.')[1]); return json(response,{ characteristics: [{ aid: 2, iid, value: values[iid] }] }); }
    if (request.method === 'PUT' && route.pathname === '/characteristics') {
      let text = ''; for await (const part of request) text += part;
      const item = JSON.parse(text).characteristics[0]; writes.push(item);
      if (rejectWrites) return json(response,{ characteristics: [{ aid: 2, iid: item.iid, status: -70402 }] },207);
      values[item.iid] = item.value; response.writeHead(204); return response.end();
    }
    json(response,{},404);
  });
  const port = await listen(hap,0,'127.0.0.1'); t.after(() => closeServer(hap));
  const client = new EventEmitter(); client.startDiscovery = () => {}; client.refreshInstances = () => {}; client.destroy = () => {};
  const access = new HapAccess({ configPath, clientFactory: () => client, types: { Characteristics: { [ON]: 'On', [BRI]: 'Brightness' }, Services: { [longUuid('43')]: 'Lightbulb' } } });
  await access.start(); t.after(() => access.close());
  client.emit('instance-discovered',{ username: BRIDGE, name: 'homebridge', ipAddress: '127.0.0.1', port }); await access.refresh();
  const state = await new StateStore(directory).load();
  const config = normalizeConfig({ advertiseAddress: '127.0.0.1', harmonyHubAddresses: ['127.0.0.1'], huePort: 0, rokuPort: 0,
    hueDevices: [{ id: 'lamp', name: 'Reading lamp', serviceId: SERVICE, power: { characteristic: ON, onValue: true, offValue: false }, brightness: { characteristic: BRI, min: 0, max: 100 } }],
    rokuButtons: [{ id: 'toggle', name: 'Toggle lamp', key: 'Play', action: { serviceId: SERVICE, characteristic: ON, operation: 'toggle' } }],
  });
  await state.assignLightIds(config.hueDevices); const events = []; const report = event => events.push(event); const actions = new Actions(access,report);
  return { directory, configPath, config, state, access, actions, values, writes, seenPins, events, report, rejectWrites: value => { rejectWrites = value; } };
}
export async function request(port,path,method = 'GET',data,headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`,{ method, headers, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  const text = await response.text(); let value; try { value = JSON.parse(text); } catch { value = text; }
  return { status: response.status, value, text };
}
