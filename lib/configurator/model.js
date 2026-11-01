import { createHash } from 'node:crypto';
import { fail } from './hub.js';
import { settingValue, describeTransport, describeControlPort } from './device-control.js';
import { settingSpec, draftValue, sameValue, isInfrared, connectionsFor, methodsFor, powerMethods } from '../../configurator-web/settings.js';
export { deviceFields, activityFields, roleFields } from '../../configurator-web/settings.js';

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
    return { id: idOf(d), name: text(d.Name), manufacturer: text(d.Manufacturer), model: text(d.Model), type: text(d.DeviceTypeDisplayName), transport: settingValue(d.Transport), controlPort: settingValue(d.ControlPort),
      transportLabel: describeTransport(d.Transport), controlPortLabel: describeControlPort(d.ControlPort, d.Transport),
      delays: { interDevice: number(d.InterDeviceDelay), interKey: number(d.InterKeyDelay), powerOn: number(power.PowerOnDelay), input: number(input.InputDelay) },
      defaults: { repeats:number(d.DefaultPressMinRepeats), delays:{ interDevice:number(d.DefaultInterDeviceDelay), interKey:number(d.DefaultInterKeyDelay), powerOn:number(power.DefaultPowerOnDelay), input:number(input.DefaultInputDelay) } },
      repeats: number(d.PressMinRepeats), power: { alwaysOn: bool(power.IsPowerAlwaysOn), betweenActivities: bool(power.IsPoweredOnBetweenActivities), type: number(power.PowerTypeId), on: actions(power.PowerOnActions), off: actions(power.PowerOffActions), toggle: actions(power.PowerToggleActions) },
      inputs: list(input.Inputs).map(i => ({ id: idOf(i), name: text(i.InputName || i.Name), order: number(i.InputOrder), actions: actions(i.Actions) })),
      inputMethod: settingValue(input.InputType), inputActions: { start: actions(input.StartActions), finish: actions(input.FinishActions), next: actions(input.NextActions), previous: actions(input.PreviousActions) },
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
  const shortText = (v,max,label) => { if (typeof (v ?? '') !== 'string' || (v || '').length > max) fail(`Keep ${label} under ${max} characters.`); return v || ''; };
  if (!value.devices || typeof value.devices !== 'object' || Array.isArray(value.devices)) fail('Expected device setup answers.');
  for (const [id, d] of Object.entries(value.devices || {})) {
    if (!known.has(id) || !d || typeof d !== 'object' || Array.isArray(d)) fail('Refresh the hub before answering for this device.');
    if (d.connections !== undefined && !Array.isArray(d.connections)) fail('Expected a list of HDMI connections.');
    const connections = connectionsFor(d);
    if (connections.length > 32) fail('Keep at most 32 HDMI connections per device.');
    const cables = connections.map(c => {
      if (!c || typeof c !== 'object' || Array.isArray(c)) fail('Expected an HDMI connection.');
      const destination = choice(c.destination,['unknown','none',...known]);
      if (destination === id) fail('Choose a different device as the HDMI destination.');
      return { destination, outputPort:shortText(c.outputPort,100,'output port names'), port:shortText(c.port,100,'input port names'), audioReturn:choice(c.audioReturn,['unknown','none','arc','earc']) };
    });
    if (d.powerPaths !== undefined && !Array.isArray(d.powerPaths)) fail('Expected a list of wake and sleep paths.');
    if ((d.powerPaths || []).length > 32) fail('Keep at most 32 wake and sleep paths per device.');
    const powerPaths = (d.powerPaths || []).map(path => {
      if (!path || typeof path !== 'object' || Array.isArray(path)) fail('Expected a wake or sleep path.');
      const direction=choice(path.direction,['wake','sleep']), method=choice(path.method,['harmony','cec','manual','automation']);
      const controller=choice(path.controller,['unknown','external',...known]);
      if (method === 'cec' && controller === id) fail('Choose the other device that sends the CEC command.');
      return {direction,method,controller,trigger:shortText(path.trigger,240,'trigger descriptions')};
    });
    if (d.powerMethods !== undefined && (!d.powerMethods || typeof d.powerMethods !== 'object' || Array.isArray(d.powerMethods))) fail('Expected wake and sleep method selections.');
    const selectedMethods={};
    for (const direction of ['wake','sleep']) {
      if (d.powerMethods?.[direction] !== undefined && !Array.isArray(d.powerMethods[direction])) fail('Expected a list of power methods.');
      const methods=methodsFor(d,direction);
      if (methods.length > powerMethods.length || new Set(methods).size !== methods.length || methods.some(m => !powerMethods.some(([key]) => key === m))) fail('Choose the available wake and sleep methods.');
      selectedMethods[direction]=methods;
    }
    devices[id] = { kind: choice(d.kind, ['unknown','tv','receiver','ps5','switch','apple-tv','other']), connections:cables, powerPaths, powerMethods:selectedMethods,
      cec: choice(d.cec, ['unknown','on','off']), wakeBy: choice(d.wakeBy, ['unknown','harmony','cec','manual','automation']), sleepBy: choice(d.sleepBy, ['unknown','harmony','cec','manual','automation']),
      switchBehavior: choice(d.switchBehavior, ['unknown','keep','sleep']), offBehavior: choice(d.offBehavior, ['unknown','keep','sleep']),
      coldStart: choice(d.coldStart, ['unknown','works','misses-input','misses-power']), transition: choice(d.transition, ['unknown','works','wrong-input','unexpected-sleep']) };
  }
  const visited=new Set(), visiting=new Set();
  const visit = id => {
    if (visiting.has(id)) fail('The HDMI wiring forms a loop. Check the destination choices.');
    if (visited.has(id) || !devices[id]) return;
    visiting.add(id); for (const c of devices[id].connections) visit(c.destination); visiting.delete(id); visited.add(id);
  };
  for (const id of Object.keys(devices)) visit(id);
  if (typeof (value.automations ?? '') !== 'string' || (value.automations || '').length > 6000) fail('Keep automation notes under 6000 characters.');
  return { devices, automations: value.automations || '' };
}

export function draftChange(input, snapshot) {
  if (!snapshot || input.version !== snapshot.version) fail('The imported configuration changed. Refresh and review the change again.', 409);
  const item = (input.kind === 'device' ? snapshot.devices : input.kind === 'activity' ? snapshot.activities : []).find(d => d.id === input.id);
  if (!item) fail('Choose an imported device or activity.');
  let target = item, cloudField;
  const spec = settingSpec(input);
  if (input.kind === 'device') {
    if (input.role !== undefined) fail('Device changes do not use activity roles.');
    if (input.field === 'controlPort' && !isInfrared(item)) fail('IR output assignment requires a confirmed infrared transport.');
  } else if (input.role !== undefined) {
    if (!Number.isInteger(input.role) || !item.roles[input.role]) fail('Choose an activity role.');
    target = item.roles[input.role]; cloudField = { powerOnOrder: 'PowerOnOrder', powerOffOrder: 'PowerOffOrder' }[input.field];
  } else cloudField = { name: 'Name', order: 'ActivityOrder' }[input.field];
  if (!spec) fail('This field is not editable in this version.');
  const value = input.value;
  if (spec.type === 'input-order') {
    const names = item.inputs.map(i => i.name);
    if (!names.length || names.some(n => !n) || new Set(names).size !== names.length || !Array.isArray(value) || value.length !== names.length || new Set(value).size !== names.length || value.some(n => !names.includes(n))) fail('Arrange each imported input exactly once. Input names must be unique.');
  } else if (spec.options ? !spec.options.some(([v]) => v === value) : spec.type === 'boolean' ? typeof value !== 'boolean' : spec.type === 'text' ? typeof value !== 'string' || !value.trim() || value.length > spec.maxLength : !Number.isInteger(value) || value < spec.min || value > spec.max) fail(`Enter a valid value for ${spec.label}.`);
  const before = draftValue(target,input.field);
  if (sameValue(before,value)) fail('Choose a different value to create a change.');
  return { key: [input.kind, input.id, input.role ?? '', input.field].join('/'), kind: input.kind, id: item.id, name: item.name, role: input.role, field: input.field, label: spec.label, before, value,
    cloud: cloudField && before !== null ? { field: cloudField, roleId: target.id, deviceId: target.deviceId, roleType: target.type?.split(':')[0] } : null, version: snapshot.version, status: 'draft', createdAt: new Date().toISOString() };
}
