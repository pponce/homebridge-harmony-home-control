import { isIP } from 'node:net';
import { createHash } from 'node:crypto';

export const PLUGIN = 'homebridge-harmony-home-control';
export const PLATFORM = 'HarmonyHomeControl';
export const STORAGE = 'harmony-home-control';
export const ROKU_KEYS = ['Home', 'Rev', 'Fwd', 'Play', 'Select', 'Left', 'Right', 'Down', 'Up', 'Back', 'InstantReplay', 'Info', 'BackSpace', 'Search', 'Enter'];
export const OPERATIONS = ['set', 'toggle', 'increase', 'decrease'];
export const scalar = value => ['boolean', 'string', 'number'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value));

export function normalizeConfig(input = {}) {
  return {
    platform: PLATFORM,
    name: input.name || 'Harmony Home Control',
    advertiseAddress: input.advertiseAddress || '',
    harmonyHubAddresses: input.harmonyHubAddresses || [],
    hueEnabled: input.hueEnabled !== false,
    huePort: input.huePort ?? 18080,
    rokuEnabled: input.rokuEnabled !== false,
    rokuPort: input.rokuPort ?? 8060,
    hueDevices: input.hueDevices || [],
    rokuButtons: input.rokuButtons || [],
  };
}

export function validateAction(action) {
  if (!action || typeof action.serviceId !== 'string' || !action.serviceId || typeof action.characteristic !== 'string' || !action.characteristic) throw new Error('Choose an accessory and a control.');
  if (!OPERATIONS.includes(action.operation)) throw new Error('Choose a supported action.');
  if (action.operation === 'set' && !scalar(action.value)) throw new Error('An action value must be text, a number, or true/false.');
  if (['increase', 'decrease'].includes(action.operation) && !(typeof action.value === 'number' && Number.isFinite(action.value) && action.value > 0)) throw new Error('The adjustment must be a positive number.');
}

export function validateConfig(input, { allowIncomplete = false } = {}) {
  const config = normalizeConfig(input);
  if (!Array.isArray(config.harmonyHubAddresses) || config.harmonyHubAddresses.some(ip => isIP(ip) !== 4)) throw new Error('Enter Harmony hub IPv4 addresses, for example 192.168.1.50.');
  if (!allowIncomplete || config.advertiseAddress) {
    if (isIP(config.advertiseAddress) !== 4 || config.advertiseAddress === '0.0.0.0' || config.advertiseAddress.startsWith('127.')) throw new Error('Choose this Homebridge machine’s LAN IPv4 address.');
  }
  if (!allowIncomplete && (config.hueEnabled || config.rokuEnabled) && !config.harmonyHubAddresses.length) throw new Error('Add at least one Harmony hub address.');
  for (const port of [config.huePort, config.rokuPort]) if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Ports must be whole numbers from 1 to 65535.');
  if (config.hueEnabled && config.rokuEnabled && config.huePort === config.rokuPort) throw new Error('Hue and Roku must use different ports.');
  const ids = new Set();
  for (const list of [config.hueDevices, config.rokuButtons]) {
    if (!Array.isArray(list) || list.length > 100) throw new Error('Use at most 100 mappings per interface.');
    for (const mapping of list) {
      if (!mapping || !/^[a-zA-Z0-9_-]{1,80}$/.test(mapping.id || '') || ids.has(mapping.id)) throw new Error('Each mapping needs a unique, permanent ID.');
      ids.add(mapping.id);
      if (typeof mapping.name !== 'string' || !mapping.name.trim() || mapping.name.length > 64) throw new Error('Give each mapping a name of 1–64 characters.');
    }
  }
  for (const item of config.hueDevices) {
    if (!item.power || !scalar(item.power.onValue) || !(item.power.offValue === null || scalar(item.power.offValue))) throw new Error(`${item.name}: choose on and off values.`);
    validateAction({ serviceId: item.serviceId, characteristic: item.power.characteristic, operation: 'set', value: item.power.onValue });
    if (item.brightness) {
      const { min, max, characteristic } = item.brightness;
      if (!characteristic || !Number.isFinite(min) || !Number.isFinite(max) || max <= min || characteristic === item.power.characteristic) throw new Error(`${item.name}: choose a separate brightness control and an increasing numeric range.`);
    }
  }
  const keys = new Set();
  for (const item of config.rokuButtons) {
    if (!ROKU_KEYS.includes(item.key) || keys.has(item.key)) throw new Error('Assign each Roku command only once.');
    keys.add(item.key);
    validateAction(item.action);
  }
  return config;
}

export function configHash(config) {
  return createHash('sha256').update(JSON.stringify(normalizeConfig(config))).digest('hex');
}

export function bridgeCredentials(config) {
  if (!config?.bridge?.pin) throw new Error('The Homebridge configuration does not contain a bridge PIN.');
  const pins = {};
  for (const entry of [...(config.platforms || []), ...(config.accessories || [])]) {
    if (entry._bridge?.username && entry._bridge?.pin) pins[entry._bridge.username.toUpperCase()] = entry._bridge.pin;
  }
  return { pin: config.bridge.pin, pins };
}

export function safeMessage(error) {
  return String(error?.message || error).replace(/\b\d{3}-\d{2}-\d{3}\b/g, '[PIN redacted]').slice(0,400);
}
