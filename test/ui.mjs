import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, configHash, normalizeConfig } from '../lib/config.js';
import { listen, closeServer } from '../lib/http.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../',import.meta.url)), publicDir = join(root,'homebridge-ui','public');
const artifacts = join(root,'local-work','artifacts'); await mkdir(artifacts,{ recursive: true });
const server = createServer(async (request,response) => {
  const names = { '/': 'index.html','/app.js': 'app.js','/style.css': 'style.css' }; const file = names[request.url];
  if (!file) { response.writeHead(404); response.end(); return; }
  const content = await readFile(join(publicDir,file),'utf8'); response.writeHead(200,{ 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
  response.end(file === 'index.html' ? `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;background:#fff;color:#263238;margin:12px}.form-control{box-sizing:border-box;width:100%;border:1px solid #bbb;border-radius:5px;padding:8px;background:transparent;color:inherit}.btn{border:1px solid #246b65;border-radius:5px;padding:8px 12px;background:transparent;cursor:pointer;color:inherit}.btn-primary{background:#246b65;color:white}.btn:disabled{opacity:.5}button{font:inherit}*{box-sizing:border-box}</style></head><body>${content}</body></html>` : content);
});
const port = await listen(server,0,'127.0.0.1');
const on = '00000025-0000-1000-8000-0026BB765291', brightness = '00000008-0000-1000-8000-0026BB765291';
const service = { id: 'AA:BB:CC:DD:EE:FF/2/10',name: 'Reading lamp',bridge: 'AA:BB:CC:DD:EE:FF',type: 'Lightbulb',reachable: true,characteristics: [
  { id: on,type: 'On',format: 'bool',canRead: true,canWrite: true,value: false },
  { id: brightness,type: 'Brightness',format: 'int',canRead: true,canWrite: true,minValue: 0,maxValue: 100,minStep: 1,value: 50 },
] };
let draft, saved, tests = [], runningHash;
const browser = await chromium.launch({ headless: true,args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000,height: 900 } }); const errors = []; page.on('pageerror',error => errors.push(error.message));
  await page.exposeFunction('bridgeRequest',async (path,body) => {
    if (path === '/bootstrap') return { addresses: [{ name: 'eth0',address: '192.168.1.2' }],huePlatforms: [{ name: 'Hue',hosts: [] }] };
    if (path === '/validate') return { hash: configHash(validateConfig(body)) };
    if (path === '/discover') return { services: [service],error: null };
    if (path === '/test') { tests.push(body.action); return { value: body.action.value }; }
    if (path === '/pair') return { pairingUntil: Date.now()+120000 };
    if (path === '/status') return { running: true,hue: 'Listening on port 18080',roku: 'Listening on port 8060',discovery: 'Advertising Hue/Roku locally',errors: [],events: [{ time: new Date().toISOString(),source: 'roku',name: 'Play received — no action assigned',ok: true }],configHash: runningHash || configHash(normalizeConfig()),pairedClients: 0 };
    throw new Error(`Unknown UI request ${path}`);
  });
  await page.exposeFunction('updateConfig',async config => { draft = structuredClone(config[0]); });
  await page.exposeFunction('saveConfig',async () => { saved = structuredClone(draft); });
  await page.addInitScript(() => { window.homebridge = { getPluginConfig: async () => [{ _bridge: { username: 'AA:00:00:00:00:01' } }],request: (path,body) => window.bridgeRequest(path,body),updatePluginConfig: value => window.updateConfig(value),savePluginConfig: () => window.saveConfig(),disableSaveButton() {},enableSaveButton() {} }; });
  await page.goto(`http://127.0.0.1:${port}`); await page.waitForSelector('#address option[value="192.168.1.2"]');
  assert.equal(await page.locator('#save').isDisabled(),true);
  await page.locator('#address').selectOption('192.168.1.2'); await page.locator('#hubs').fill('192.168.1.3'); await page.locator('#hubs').dispatchEvent('change');
  await page.waitForFunction(() => !document.getElementById('save').disabled);
  await page.locator('#refresh').click(); await page.waitForFunction(() => document.getElementById('discovery-status').textContent.startsWith('1 controllable'));
  assert.match(await page.locator('#hue-warning').textContent(),/automatic bridge discovery/);
  await page.locator('[data-tab="hue"]').click(); await page.locator('#add-hue').click();
  let editor = page.locator('#hue-editor'); await editor.getByLabel('Accessory',{ exact: true }).selectOption(service.id);
  await editor.getByLabel('Name shown in your mappings').fill('Reading lamp <script>unsafe</script>');
  await editor.getByRole('button',{ name: 'Add mapping',exact: true }).click(); await page.waitForFunction(() => document.getElementById('hue-editor').hidden);
  await page.waitForFunction(() => !document.getElementById('save').disabled);
  assert.equal(draft.hueDevices.length,1); assert.equal(draft.hueDevices[0].brightness.characteristic,brightness);
  assert.equal(await page.locator('#hue-list script').count(),0);
  const hueId = draft.hueDevices[0].id;
  await page.getByRole('button',{ name: 'Test on',exact: true }).click(); await page.waitForFunction(() => document.getElementById('notice').textContent.startsWith('Command accepted'));
  assert.equal(tests[0].value,true);
  await page.locator('#hue-list').getByRole('button',{ name: 'Edit',exact: true }).click();
  await editor.getByLabel('Name shown in your mappings').fill('Reading lamp'); await editor.getByRole('button',{ name: 'Update mapping',exact: true }).click();
  await page.waitForFunction(() => !document.getElementById('save').disabled); assert.equal(draft.hueDevices[0].id,hueId);
  await page.screenshot({ path: join(artifacts,'ui-hue-desktop.png'),fullPage: true });
  await page.locator('[data-tab="roku"]').click(); await page.locator('#add-roku').click(); editor = page.locator('#roku-editor');
  await editor.getByLabel('Accessory',{ exact: true }).selectOption(service.id); await editor.getByLabel('Action',{ exact: true }).selectOption('toggle');
  await editor.getByRole('button',{ name: 'Add mapping',exact: true }).click(); await page.waitForFunction(() => !document.getElementById('save').disabled);
  assert.equal(draft.rokuButtons[0].key,'Play'); assert.equal(draft.rokuButtons[0].action.operation,'toggle');
  assert.equal(draft._bridge.username,'AA:00:00:00:00:01');
  await page.locator('#save').click(); await page.waitForFunction(() => document.getElementById('notice').textContent.startsWith('Settings saved'));
  assert.equal(saved.hueDevices.length,1); assert.equal(saved.rokuButtons.length,1);
  runningHash = configHash(saved); await page.locator('[data-tab="pair"]').click(); await page.waitForFunction(() => !document.getElementById('pair').disabled);
  assert.match(await page.locator('#events').textContent(),/Play received/);
  await page.screenshot({ path: join(artifacts,'ui-pair-desktop.png'),fullPage: true });
  await page.setViewportSize({ width: 390,height: 844 }); await page.locator('[data-tab="roku"]').click();
  await page.screenshot({ path: join(artifacts,'ui-roku-mobile.png'),fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),'Mobile UI must not overflow horizontally');
  assert.deepEqual(errors,[]); console.log('UI passed: connection validation, discovery, Hue mapping/edit/test, Roku mapping, saved bridge settings, pairing status, escaping, and mobile layout.');
} finally { await browser.close(); await closeServer(server); }
