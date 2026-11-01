import { fail } from './hub.js';
import { child, children, field, escape } from './xml.js';
import { rootOf, subtype, setMember, one } from './device-cloud.js';
import { sameValue } from '../../configurator-web/settings.js';

const namespace='http://schemas.datacontract.org/2004/07/Logitech.Harmony.Services.DataContract.UserButtonMapping';
const buttonSchema={namespace,order:'ButtonAction ButtonDoublePressAction ButtonId ButtonLongPressAction ButtonState FunctionGroupType ButtonImageKey ButtonImagePath ImageId MenuItem TextOnRemote'.split(' ')};
const menuSchema={namespace,order:['IndexInMenu','MenuName']};
export const buttonIdentity=(raw,n)=>({key:field(raw,n,'ButtonKey'),id:field(raw,n,'ButtonId'),type:subtype(n)});

export function layoutView(raw) {
  const rows=children(child(rootOf(raw),'Buttons'),'AbstractRemoteButton').filter(n=>subtype(n)==='SoftRemoteButton').map(n=>{
    const menu=child(n,'MenuItem'),position=field(raw,menu,'IndexInMenu');
    return {button:buttonIdentity(raw,n),label:field(raw,n,'TextOnRemote'),menu:field(raw,menu,'MenuName'),position:/^\d{1,4}$/.test(position) ? Number(position) : null};
  });
  if(!rows.length || rows.some(r=>!r.button.id || !r.menu || r.position===null) || new Set(rows.map(r=>JSON.stringify(r.button))).size!==rows.length || new Set(rows.map(r=>JSON.stringify([r.menu,r.position]))).size!==rows.length) return null;
  return rows.sort((a,b)=>a.menu.localeCompare(b.menu)||a.position-b.position);
}
export function validateLayout(before,next) {
  if(!before || !Array.isArray(next) || next.length!==before.length) fail('This surface does not expose an editable touchscreen layout.');
  if(next.some(r=>!r || typeof r!=='object' || Array.isArray(r) || !r.button || typeof r.button!=='object')) fail('Choose existing touchscreen buttons.');
  const keys=r=>JSON.stringify(r.button), sorted=rows=>rows.map(keys).sort();
  if(!sameValue(sorted(before),sorted(next))) fail('Keep every existing touchscreen button exactly once.');
  for(const r of next) {
    const old=before.find(b=>keys(b)===keys(r));
    if(Object.keys(r).some(k=>!['button','label','menu','position'].includes(k)) || typeof r.label!=='string' || !r.label.trim() || r.label.length>64 || r.menu!==old.menu || !Number.isInteger(r.position)) fail('Use labels of 1–64 characters and keep each button in its current menu.');
  }
  for(const menu of new Set(before.map(r=>r.menu))) if(!sameValue(before.filter(r=>r.menu===menu).map(r=>r.position).sort((a,b)=>a-b),next.filter(r=>r.menu===menu).map(r=>r.position).sort((a,b)=>a-b))) fail('Reorder the existing positions within each menu.');
}
export function patchLayout(raw,next) {
  validateLayout(layoutView(raw),next);
  for(const row of next) {
    const node=one(children(child(rootOf(raw),'Buttons'),'AbstractRemoteButton').filter(n=>sameValue(buttonIdentity(raw,n),row.button)),'The touchscreen button changed. Load cloud button maps again.');
    if(child(node,'TextOnRemote')?.children.length) fail('This touchscreen label has an unsupported format.');
    raw=setMember(raw,node,'TextOnRemote',escape(row.label),buttonSchema);
    const updated=one(children(child(rootOf(raw),'Buttons'),'AbstractRemoteButton').filter(n=>sameValue(buttonIdentity(raw,n),row.button)),'The touchscreen button changed.');
    raw=setMember(raw,child(updated,'MenuItem'),'IndexInMenu',String(row.position),menuSchema);
  }
  return raw;
}
