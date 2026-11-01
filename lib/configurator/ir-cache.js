import { createHash } from 'node:crypto';
import { fail } from './hub.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity=hub=>digest([hub.identity?.accountId,hub.identity?.remoteId]);
const profile=device=>digest([device.id,device.manufacturer,device.model,device.transport]);
const text=value=>typeof value==='string' ? value : '';

// Persist only the command fields exposed by the IR viewer, never a cloud response
// or session object. Unknown vendor fields and credentials are excluded.
function commandData(commands) {
  if(!Array.isArray(commands) || commands.some(c=>!c || typeof c!=='object' || Array.isArray(c) || typeof c.name!=='string')) fail('Logitech returned an unsupported IR command list.',502);
  return commands.map(c=>{
    const raw=typeof c.raw==='string' && c.raw.trim() ? c.raw : null,keyCode=typeof c.keyCode==='string' && c.keyCode.trim() ? c.keyCode : null;
    return {name:c.name,raw,rawState:raw ? 'supplied' : c.rawState==='unsupported' ? 'unsupported' : 'not-supplied',keyCode,keyCodeState:keyCode ? 'supplied' : c.keyCodeState==='unsupported' ? 'unsupported' : 'not-supplied',protocolId:text(c.protocolId),transport:text(c.transport),learned:typeof c.learned==='boolean' ? c.learned : null};
  });
}

export function reconcileIrCodes(hub) {
  const entries={};
  if(hub.identity && hub.model) for(const device of hub.model.devices) {
    const entry=hub.irCodes?.[device.id];
    if(entry?.identity!==identity(hub) || entry.profile!==profile(device) || typeof entry.updatedAt!=='string' || !Number.isFinite(Date.parse(entry.updatedAt))) continue;
    try {entries[device.id]={identity:entry.identity,profile:entry.profile,deviceId:device.id,updatedAt:entry.updatedAt,commands:commandData(entry.commands)};} catch { /* Refresh replaces an unreadable cached entry. */ }
  }
  hub.irCodes=entries;
}

export function saveIrCodes(hub,deviceId,commands) {
  const device=hub.model?.devices.find(d=>d.id===deviceId);
  if(!device || !hub.identity) fail('Read this device from the hub before loading IR codes.',409);
  const entry={identity:identity(hub),profile:profile(device),deviceId,updatedAt:new Date().toISOString(),commands:commandData(commands)};
  reconcileIrCodes(hub);hub.irCodes[deviceId]=entry;
}

export function viewIrCodes(hub) {
  return Object.fromEntries((hub.model?.devices || []).flatMap(device=>{
    const entry=hub.irCodes?.[device.id];
    return entry?.identity===identity(hub) && entry.profile===profile(device) ? [[device.id,{deviceId:device.id,updatedAt:entry.updatedAt,commands:entry.commands}]] : [];
  }));
}
