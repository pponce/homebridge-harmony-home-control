// Shared draft choices. These are editor limits, not device defaults.
const timing = (label, max, help) => ({ label, type:'number', min:0, max, help, guide:'delay' });
const sequence = (label,help) => ({label,type:'actions',help,guide:'commands'});
export const deviceFields = {
  'delays.powerOn': timing('Power-on delay (ms)',60000,'Power-on delay'),
  'delays.input': timing('Input delay (ms)',60000,'Input delay'),
  'delays.interDevice': timing('Inter-device delay (ms)',60000,'Inter-device delay'),
  'delays.interKey': timing('Inter-key delay (ms)',10000,'Inter-key delay'),
  'power.alwaysOn': { label:'Harmony skips all power commands', type:'boolean', help:'Harmony skips all power commands', guide:'power' },
  'power.betweenActivities': { label:'Keep on between activities', type:'boolean', help:'Keep on between activities', guide:'power' },
  'power.type': { label:'Power command type', type:'number', options:[[1,'Separate On / Off commands'],[2,'One power button (toggle)'],[3,'Manual / no automatic power commands']], help:'Power command type', guide:'power' },
  repeats: { label:'Command repeats', type:'number', options:[0,1,2,3,4,5].map(n => [n,String(n)]), help:'Command repeats', guide:'repeats' },
  controlPort: { label:'Control port', type:'text', options:[['1','Hub'],['2','Mini blaster 1'],['3','Hub + Mini blaster 1'],['4','Mini blaster 2'],['5','Hub + Mini blaster 2'],['6','Mini blaster 1 + Mini blaster 2'],['7','Hub + both mini blasters']], help:'Control port', guide:'port' },
  inputMethod: { label:'Input method', type:'text', options:[['1','Direct input commands'],['2','Cycle through inputs'],['4','Open a menu and cycle through inputs']], help:'Input method', guide:'inputMethod' },
  inputOrder: { label:'Input order', type:'input-order', help:'Input order', guide:'input' },
  inputCommands: sequence('Input commands','Commands'),
  'inputActions.start': sequence('Start input selection','Start input selection'),
  'inputActions.next': sequence('Next input','Next input'),
  'inputActions.previous': sequence('Previous input','Previous input'),
  'inputActions.finish': sequence('Finish input selection','Finish input selection'),
  'power.on': sequence('Power-on commands','On'),
  'power.off': sequence('Power-off commands','Off'),
  'power.toggle': sequence('Power-toggle commands','Toggle'),
};
export const activityFields = {
  name: { label:'Activity name', type:'text', maxLength:64, help:'Name', guide:'activity' },
  order: { label:'Activity display order', type:'number', min:0, max:1000, help:'Display order', guide:'activity' },
};
export const roleFields = {
  powerOnOrder: { label:'Power-on order', type:'number', min:0, max:1000, help:'On order', guide:'role' },
  powerOffOrder: { label:'Power-off order', type:'number', min:0, max:1000, help:'Off order', guide:'role' },
  nextDeviceDelay: { label:'Delay before next device (ms)', type:'number', min:0, max:60000, help:'Next delay (ms)', guide:'role' },
};
export function settingSpec(change) {
  const fields = change.kind === 'device' ? deviceFields : change.role !== undefined ? roleFields : activityFields;
  return Object.hasOwn(fields,change.field) ? fields[change.field] : null;
}
export const isInfrared = device => /^(1|ir|infrared(?: \(ir\))?)$/i.test(String(device.transport ?? '').trim());
export const orderedInputs = device => [...(device?.inputs || [])].sort((a,b) => (a.order ?? Infinity) - (b.order ?? Infinity));
export function draftValue(item,field,inputName) {
  if (deviceFields[field]?.type === 'actions') {
    const source=field === 'inputCommands' ? item?.inputs?.find(i=>i.name===inputName) : null;
    if (!item || (source ? source.actionsKnown === false : item.actionsKnown?.[field] === false)) return null;
    return normalizeActions(source ? source.actions : field.split('.').reduce((o,k)=>o?.[k],item));
  }
  if (field === 'inputOrder') {
    const inputs = item?.inputs || [];
    if (!inputs.length || inputs.some(i => i.order == null) || new Set(inputs.map(i => i.order)).size !== inputs.length) return null;
    return orderedInputs(item).map(i => i.name);
  }
  const value = field.split('.').reduce((o,key) => o?.[key],item);
  return value == null || value === '' ? null : field === 'inputMethod' ? normalizeInputMethod(value) : value;
}
export const normalizeInputMethod = value => value === 'Discrete' ? '1' : String(value);
export function normalizeActions(actions) {
  if (!Array.isArray(actions)) return null;
  return [...actions].sort((a,b)=>(a.order ?? 0)-(b.order ?? 0)).map(a => {
    const type=String(a.type || '').split(':')[0];
    if (type === 'IRPressAction') return {kind:'command',command:a.command,duration:a.duration ?? null};
    if (type === 'IRDelayAction' || type === 'DelayAction') return {kind:'delay',delay:a.delay};
    return {kind:'unsupported',type};
  });
}
export const sameValue = (a,b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function powerTypeLabel(value) {
  if (value == null) return null;
  const label = value === 0 ? 'Unspecified / no automatic power commands' : deviceFields['power.type'].options.find(([v]) => v === value)?.[1];
  return label ? `${label} (code ${value})` : `Unrecognized power type (code ${value})`;
}
export function inputMethodLabel(value) {
  if (value == null || value === '') return null;
  const label = deviceFields.inputMethod.options.find(([v]) => v === normalizeInputMethod(value))?.[1];
  return label ? `${label} (code ${value})` : /^\d+$/.test(String(value)) ? `Reported method code ${value}` : value;
}
export function formatDraftValue(change,value) {
  if (value == null || value === '') return 'Not supplied';
  if (Array.isArray(value)) return value.length ? value.map((v,i) => `${i+1}. ${typeof v === 'string' ? v : v.kind === 'command' ? `${v.command}${v.duration == null ? '' : ` (hold ${v.duration} ms)`}` : v.kind === 'delay' ? `Wait ${v.delay} ms` : `Unsupported action: ${v.type}`}`).join('\n') : 'No actions';
  const spec = settingSpec(change), label = spec?.options?.find(([v]) => v === value)?.[1];
  return label || (value === true ? 'Yes' : value === false ? 'No' : String(value));
}
// Read old single-cable answers without discarding them on the next save.
export function connectionsFor(answer = {}) {
  if (Array.isArray(answer.connections)) return answer.connections;
  return answer.destination && answer.destination !== 'unknown' ? [{ destination:answer.destination, port:answer.port || '', outputPort:'', audioReturn:'unknown' }] : [];
}
export const pathsFor = (answer = {}) => Array.isArray(answer.powerPaths) ? answer.powerPaths : [];
export const powerMethods = [['harmony','Harmony'],['cec','HDMI-CEC'],['manual','Controller / remote / manual'],['automation','HomeKit / Homebridge / automation']];
export function methodsFor(answer = {},direction) {
  if (Array.isArray(answer.powerMethods?.[direction])) return answer.powerMethods[direction];
  // Older answers recorded the preferred method and individual paths only.
  const reported=[answer[direction === 'wake' ? 'wakeBy' : 'sleepBy'],...pathsFor(answer).filter(p => p.direction === direction).map(p => p.method)];
  return powerMethods.map(([method]) => method).filter(method => reported.includes(method));
}
