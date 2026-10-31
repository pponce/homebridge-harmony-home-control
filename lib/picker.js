// Picker hints only: discovery and runtime writes retain existing mapped controls.
const uuid = value => /^[a-f0-9]{1,8}$/i.test(value || '') ? value.toUpperCase().padStart(8, '0') + '-0000-1000-8000-0026BB765291' : String(value || '').toUpperCase();
const key = value => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const definitions = [
  ['lights', 'Light bulbs', ['Lightbulb'], ['43']],
  ['locks', 'Locks', ['LockMechanism'], ['45']],
  ['switches', 'Switches', ['Switch', 'StatefulProgrammableSwitch'], ['49', '88']],
  ['outlets', 'Outlets', ['Outlet'], ['47']],
  ['fans', 'Fans', ['Fan', 'Fanv2'], ['40', 'B7']],
  ['coverings', 'Blinds & curtains', ['WindowCovering', 'Slats'], ['8C', 'B9']],
  ['doors', 'Doors & garages', ['Door', 'Window', 'GarageDoorOpener'], ['81', '8B', '41']],
  ['climate', 'Climate & air quality', ['Thermostat', 'HeaterCooler', 'HumidifierDehumidifier', 'AirPurifier'], ['4A', 'BC', 'BD', 'BB']],
  ['media', 'TVs & speakers', ['Television', 'Speaker', 'TelevisionSpeaker', 'SmartSpeaker', 'Microphone'], ['D8', '113', '228', '112']],
  ['water', 'Water & irrigation', ['Valve', 'Faucet', 'IrrigationSystem'], ['D0', 'D7', 'CF']],
  ['security', 'Security systems', ['SecuritySystem'], ['7E']],
  ['groups', 'Hue groups', ['HueGroup'], []],
  ['other', 'Other / custom', [], []],
  ['internal', 'Setup & maintenance', ['AccessoryInformation', 'AccessoryMetrics', 'AccessoryRuntimeInformation', 'AccessCode', 'AccessControl', 'AssetUpdate', 'Assistant', 'AudioStreamManagement', 'Battery', 'CameraOperatingMode', 'CameraRecordingManagement', 'CameraRTPStreamManagement', 'CloudRelay', 'DataStreamTransportManagement', 'Diagnostics', 'FilterMaintenance', 'FirmwareUpdate', 'InputSource', 'LockManagement', 'NFCAccess', 'Pairing', 'PowerManagement', 'ProtocolInformation', 'ServiceLabel', 'Siri', 'SiriEndpoint', 'TapManagement', 'TargetControl', 'TargetControlManagement', 'ThreadTransport', 'TransferTransportManagement', 'Tunnel', 'WiFiRouter', 'WiFiSatellite', 'WiFiTransport'], ['3E', '270', '239', '260', 'DA', '267', '26A', '127', '96', '21A', '204', '110', '5A', '129', '237', 'BA', '236', 'D9', '44', '266', '55', '221', 'A2', 'CC', '133', '253', '22E', '125', '122', '701', '203', '56', '20A', '20F', '22A']],
];
export const PICKER_CATEGORIES = definitions.map(([id, label]) => ({ id, label, defaultSelected: !['internal', 'other'].includes(id) }));
const byType = new Map(definitions.flatMap(([id, , names]) => names.map(name => [key(name), id])));
const byUuid = new Map(definitions.flatMap(([id, , , ids]) => ids.map(value => [uuid(value), id])));

const metadataNames = new Set(['Name', 'ConfiguredName', 'Identify', 'Manufacturer', 'Model', 'SerialNumber', 'FirmwareRevision', 'HardwareRevision', 'SoftwareRevision', 'Version', 'AccessoryIdentifier', 'ProductData', 'ServiceLabelIndex', 'ServiceLabelNamespace', 'InputDeviceType', 'InputSourceType', 'IsConfigured', 'CurrentVisibilityState', 'TargetVisibilityState', 'DisplayOrder', 'SleepDiscoveryMode'].map(key));
const metadataIds = new Set(['23', 'E3', '14', '20', '21', '30', '52', '53', '54', '37', '57', '220', 'CB', 'CD', 'DC', 'DB', 'D6', '135', '134', '136', 'E8'].map(uuid));

export function isHarmonyPlatform(platform) {
  // Homebridge also accepts a fully qualified plugin.platform alias.
  return String(platform || '').split('.').at(-1).toLowerCase() === 'harmonyhubwebsocket';
}

export function pickerService(service) {
  const characteristics = service.characteristics.map(c => ({ ...c, canMap: c.canWrite && !metadataIds.has(uuid(c.id)) && !metadataNames.has(key(c.type)) }));
  // homebridge-harmony publishes Manufacturer=Harmony in both its switch and TV
  // modes. Do not match accessory names, "Logitech", or the entire main bridge.
  const harmony = service.source !== 'hue' && (String(service.manufacturer || '').trim().toLowerCase() === 'harmony' || service.platforms?.some(isHarmonyPlatform) === true);
  return { ...service, characteristics, harmony, category: byUuid.get(uuid(service.uuid || service.type)) || byType.get(key(service.type)) || 'other', selectable: characteristics.some(c => c.canMap) };
}
