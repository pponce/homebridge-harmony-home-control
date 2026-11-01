// Preserve the hub's scalar values separately from their display labels.
// Native examples: schlambos/harmony-hub-control, tools/hub-emu/seed/resources/DeviceList.json.
// IR port bitmask: iranl/harmony-ng, docs/API.md, Direct IR Command.
export const settingValue = value => typeof value === 'string' ? value.trim().slice(0, 1000)
  : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const codeOf = value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const transportNames = new Map([[1, 'Infrared (IR)'], [32, 'Bluetooth']]);
const isInfrared = value => codeOf(value) === 1 || /^(ir|infrared(?: \(ir\))?)$/i.test(value);
const isBluetooth = value => codeOf(value) === 32 || /^(bluetooth|bt)$/i.test(value);

export function describeTransport(value) {
  const raw = settingValue(value);
  if (!raw) return '';
  const code = codeOf(raw);
  if (transportNames.has(code)) return `${transportNames.get(code)} (code ${raw})`;
  return code !== null ? `Unrecognized transport (code ${raw})` : raw;
}

export function describeControlPort(value, transport) {
  const raw = settingValue(value), method = settingValue(transport);
  if (!raw) return '';
  const code = codeOf(raw);
  // The stored IR assignment does not route Bluetooth commands to an IR emitter.
  if (isBluetooth(method)) return `Not used for Bluetooth (stored: ${raw})`;
  if (isInfrared(method) && code >= 1 && code <= 7) {
    const outputs = [[1, 'Hub'], [2, 'Mini blaster 1'], [4, 'Mini blaster 2']]
      .filter(([bit]) => code & bit).map(([, name]) => name);
    return `${outputs.join(' + ')} (code ${raw})`;
  }
  return code !== null ? `Reported port code ${raw}` : raw;
}
