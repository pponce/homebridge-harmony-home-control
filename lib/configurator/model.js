import { createHash } from 'node:crypto';
import { fail } from './hub.js';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const idOf = value => String(value?.['Id-'] ?? value?.Id?.Value ?? value?.Id ?? '');
const list = value => Array.isArray(value) ? value : [];
const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const bool = value => value === true || value === 'true' ? true : value === false || value === 'false' ? false : null;
const text = value => typeof value === 'string' ? value.slice(0, 1000) : '';
const actions = value => list(value).map(a => ({ type: text(a.__type), command: text(a.IRCommandName || a.CommandName), deviceId: String(a['DeviceId-'] ?? ''), order: number(a.Order), duration: number(a.Duration), delay: number(a.Delay ?? a.Milliseconds), input: text(a.InputName) }));

// Explicit projections keep provisioning details, IR payloads and credentials off the page.
export function project(snapshot) {
  if (!snapshot) return null;
  const devices = list(snapshot.resources.DeviceList?.DevicesWithFeatures).map(entry => {
    const d = entry.Device || {}, features = list(entry.DeviceFeatures);
    const power = features.find(f => String(f.__type).split(':')[0] === 'PowerFeature') || {};
    const input = features.find(f => String(f.__type).split(':')[0] === 'InputFeature') || {};
    return { id: idOf(d), name: text(d.Name), manufacturer: text(d.Manufacturer), model: text(d.Model), type: text(d.DeviceTypeDisplayName), transport: text(d.Transport), controlPort: text(d.ControlPort),
      delays: { interDevice: number(d.InterDeviceDelay), interKey: number(d.InterKeyDelay), powerOn: number(power.PowerOnDelay), input: number(input.InputDelay) },
      repeats: number(d.PressMinRepeats), power: { alwaysOn: bool(power.IsPowerAlwaysOn), betweenActivities: bool(power.IsPoweredOnBetweenActivities), type: number(power.PowerTypeId), on: actions(power.PowerOnActions), off: actions(power.PowerOffActions), toggle: actions(power.PowerToggleActions) },
      inputs: list(input.Inputs).map(i => ({ id: idOf(i), name: text(i.InputName || i.Name), order: number(i.InputOrder), actions: actions(i.Actions) })),
      inputMethod: text(input.InputType), inputActions: { start: actions(input.StartActions), finish: actions(input.FinishActions), next: actions(input.NextActions), previous: actions(input.PreviousActions) },
      commands: list(entry.Commands).map(c => text(c.Name)).filter(Boolean), features: features.map(f => text(f.__type)) };
  });
  const activities = list(snapshot.resources.ActivityList?.Activities).map(a => ({ id: idOf(a), name: text(a.Name), order: number(a.ActivityOrder), type: text(a.Type),
    roles: list(a.Roles).map((r, index) => ({ index, id: idOf(r), type: text(r.__type), deviceId: String(r['DeviceId-'] ?? ''), input: text(r.SelectedInput?.Name), inputId: idOf(r.SelectedInput), powerOnOrder: number(r.PowerOnOrder), powerOffOrder: number(r.PowerOffOrder), nextDeviceDelay: number(r.NextDevicePowerOnDelay) })), enter: actions(a.EnterActions), leave: actions(a.LeaveActions) }));
  for (const group of [devices,activities]) if (group.length > 500 || group.some(d => !/^-?\d{1,20}$/.test(d.id)) || new Set(group.map(d => d.id)).size !== group.length) fail('Unsupported or duplicate device/activity IDs in the hub configuration.',502);
  const maps = list(snapshot.resources.MapList?.ButtonMaps).map(m => ({ id: idOf(m), activityId: String(m['ActivityId-'] ?? ''), deviceId: String(m['DeviceId-'] ?? ''),
    buttons: list(m.Buttons).map(b => ({ key: text(b.ButtonKey), group: text(b.FunctionGroupType), action: { type: text(b.ButtonAction?.__type), command: text(b.ButtonAction?.CommandName), deviceId: String(b.ButtonAction?.['DeviceId-'] ?? '') } })),
    sequences: list(m.Sequences).map(s => ({ name: text(s.Name), actions: actions(s.Actions) })) }));
  return { host: snapshot.host, readAt: snapshot.readAt, version: digest(snapshot.resources), devices, activities, maps, unavailable: snapshot.unavailable,
    coverage: 'Device power/input settings, delays, commands, activity roles, start/end actions and available button maps. Unknown vendor fields and raw IR data are omitted. FunctionList is read for coverage; function maps are not interpreted yet.' };
}

export function validateContext(value, snapshot) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected setup answers.');
  const known = new Set(snapshot?.devices.map(d => d.id) || []), devices = {};
  const choice = (v, values) => { if (!values.includes(v ?? 'unknown')) fail('Choose one of the available setup answers.'); return v ?? 'unknown'; };
  for (const [id, d] of Object.entries(value.devices || {})) {
    if (!known.has(id) || !d || typeof d !== 'object') fail('Refresh the hub before answering for this device.');
    const destination = d.destination ?? 'unknown';
    if (!['unknown','none',...known].includes(destination) || destination === id) fail('Choose a different device as the HDMI destination.');
    if (typeof (d.port ?? '') !== 'string' || (d.port || '').length > 100) fail('Keep HDMI port names under 100 characters.');
    devices[id] = { kind: choice(d.kind, ['unknown','tv','receiver','ps5','switch','apple-tv','other']), destination, port: d.port || '',
      cec: choice(d.cec, ['unknown','on','off']), wakeBy: choice(d.wakeBy, ['unknown','harmony','cec','manual','automation']), sleepBy: choice(d.sleepBy, ['unknown','harmony','cec','manual','automation']),
      switchBehavior: choice(d.switchBehavior, ['unknown','keep','sleep']), offBehavior: choice(d.offBehavior, ['unknown','keep','sleep']),
      coldStart: choice(d.coldStart, ['unknown','works','misses-input','misses-power']), transition: choice(d.transition, ['unknown','works','wrong-input','unexpected-sleep']) };
  }
  for (const id of Object.keys(devices)) {
    const visited = new Set([id]); let next = devices[id].destination;
    while (devices[next]) { if (visited.has(next)) fail('The HDMI wiring forms a loop. Check the destination choices.'); visited.add(next); next = devices[next].destination; }
  }
  if (typeof (value.automations ?? '') !== 'string' || (value.automations || '').length > 6000) fail('Keep automation notes under 6000 characters.');
  return { devices, automations: value.automations || '' };
}

export const deviceFields = { 'delays.powerOn': ['Power-on delay (ms)',0,60000], 'delays.input': ['Input delay (ms)',0,60000], 'delays.interDevice': ['Inter-device delay (ms)',0,60000], 'delays.interKey': ['Inter-key delay (ms)',0,10000], 'power.alwaysOn': ['Harmony never sends power commands', 'boolean'], 'power.betweenActivities': ['Keep on between activities', 'boolean'] };
export const activityFields = { name: ['Activity name','text'], order: ['Activity display order',0,1000] };
export const roleFields = { powerOnOrder: ['Power-on order',0,1000], powerOffOrder: ['Power-off order',0,1000], nextDeviceDelay: ['Delay before next device (ms)',0,60000] };
export function draftChange(input, snapshot) {
  if (!snapshot || input.version !== snapshot.version) fail('The imported configuration changed. Refresh and review the change again.', 409);
  const item = (input.kind === 'device' ? snapshot.devices : input.kind === 'activity' ? snapshot.activities : []).find(d => d.id === input.id);
  if (!item) fail('Choose an imported device or activity.');
  let target = item, spec, cloudField;
  if (input.kind === 'device') spec = Object.hasOwn(deviceFields,input.field) ? deviceFields[input.field] : null;
  else if (input.role !== undefined) {
    if (!Number.isInteger(input.role) || !item.roles[input.role]) fail('Choose an activity role.');
    target = item.roles[input.role]; spec = Object.hasOwn(roleFields,input.field) ? roleFields[input.field] : null; cloudField = { powerOnOrder: 'PowerOnOrder', powerOffOrder: 'PowerOffOrder' }[input.field];
  } else { spec = Object.hasOwn(activityFields,input.field) ? activityFields[input.field] : null; cloudField = { name: 'Name', order: 'ActivityOrder' }[input.field]; }
  if (!spec) fail('This field is not editable in this version.');
  const value = input.value;
  if (spec[1] === 'boolean' ? typeof value !== 'boolean' : spec[1] === 'text' ? typeof value !== 'string' || !value.trim() || value.length > 64 : !Number.isInteger(value) || value < spec[1] || value > spec[2]) fail(`Enter a valid value for ${spec[0]}.`);
  const before = input.field.split('.').reduce((obj,key) => obj?.[key], target);
  if (before == null) fail('This field was not supplied by the hub; it cannot be safely edited here.');
  if (before === value) fail('Choose a different value to create a change.');
  return { key: [input.kind, input.id, input.role ?? '', input.field].join('/'), kind: input.kind, id: item.id, name: item.name, role: input.role, field: input.field, label: spec[0], before, value,
    cloud: cloudField ? { field: cloudField, roleId: target.id, deviceId: target.deviceId, roleType: target.type?.split(':')[0] } : null, version: snapshot.version, status: 'draft', createdAt: new Date().toISOString() };
}
