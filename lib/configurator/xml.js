import { fail } from './hub.js';
export const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity) => {
  if (entity.startsWith('#')) { const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1)); if (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)) return String.fromCodePoint(n); fail('Invalid XML character.',502); }
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity] ?? whole;
});
export const child = (node, name) => node?.children.find(n => n.name === name);
export const children = (node, name) => node?.children.filter(n => n.name === name) || [];
export const descendants = (node, name) => (node?.children || []).flatMap(n => [...(n.name === name ? [n] : []), ...descendants(n, name)]);
export const value = (xml, node, trim = true) => node && !node.children.length ? decode(trim ? xml.slice(node.contentStart,node.contentEnd).trim() : xml.slice(node.contentStart,node.contentEnd)) : '';
export const field = (xml, node, name) => value(xml, child(node, name));
export const identity = (xml, node, name = 'Id') => field(xml, child(node, name), 'Value');

// A bounded, non-expanding XML index, not a serializer. Saves splice only known scalar
// spans into the original XML so unknown members, order and namespaces survive.
export function parseXml(xml) {
  if (typeof xml !== 'string' || xml.length > 8 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) fail('Unsupported cloud XML response.', 502);
  const root = { children: [], namespaces: {}, name: '#document' }, stack = [root];
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w.:-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g;
  let match, end = 0, count = 0;
  while ((match = tokens.exec(xml))) {
    if (xml.slice(end, match.index).includes('<')) fail('Malformed cloud XML.', 502);
    const tag = match[0]; end = tokens.lastIndex;
    if (tag.startsWith('<?') || tag.startsWith('<!--')) continue;
    if (tag.startsWith('<!')) fail('Unsupported cloud XML section.', 502);
    if (tag.startsWith('</')) {
      const node = stack.pop();
      if (stack.length < 1 || node.qname !== tag.slice(2,-1).trim()) fail('Malformed cloud XML.',502);
      node.contentEnd = match.index; node.end = end; continue;
    }
    if (++count > 100000 || stack.length > 60) fail('Cloud XML exceeds supported limits.',502);
    const qname = /^<([\w.:-]+)/.exec(tag)[1], parent = stack.at(-1), namespaces = { ...parent.namespaces }, attributes = {};
    const attrs = tag.slice(qname.length + 1).replace(/\/?\s*>$/, '');
    let previous = 0;
    for (const attr of attrs.matchAll(/([\w.:-]+)\s*=\s*("[^"]*"|'[^']*')/g)) {
      if (attrs.slice(previous,attr.index).trim()) fail('Malformed cloud XML attributes.',502);
      previous = attr.index + attr[0].length;
      if (Object.hasOwn(attributes,attr[1])) fail('Duplicate cloud XML attribute.',502);
      attributes[attr[1]] = decode(attr[2].slice(1,-1));
      if (attr[1] === 'xmlns') namespaces[''] = attributes[attr[1]];
      else if (attr[1].startsWith('xmlns:')) namespaces[attr[1].slice(6)] = attributes[attr[1]];
    }
    if (attrs.slice(previous).trim()) fail('Malformed cloud XML attributes.',502);
    const node = { qname, name: qname.split(':').at(-1), attributes, namespaces, children: [], start: match.index, openEnd: end, contentStart: end, contentEnd: end, end };
    parent.children.push(node);
    if (!tag.endsWith('/>')) stack.push(node);
  }
  if (stack.length !== 1 || xml.slice(end).trim() || root.children.length !== 1) fail('Incomplete cloud XML response.',502);
  return root;
}
export function standalone(xml, node) {
  const open = xml.slice(node.start,node.openEnd);
  const declarations = Object.entries(node.namespaces).filter(([key]) => !Object.hasOwn(node.attributes,key ? `xmlns:${key}` : 'xmlns')).map(([key,v]) => ` xmlns${key ? ':'+key : ''}="${escape(v)}"`).join('');
  return open.replace(/(\/?>)$/,`${declarations}$1`) + xml.slice(node.openEnd,node.end);
}
export function patchScalar(xml, node, next) {
  if (!node || node.children.length || Object.entries(node.attributes).some(([key,v]) => key.split(':').at(-1) === 'nil' && v === 'true') || xml.slice(node.start,node.openEnd).endsWith('/>')) fail('The cloud field is missing or cannot be safely edited.',409);
  return xml.slice(0,node.contentStart) + escape(next) + xml.slice(node.contentEnd);
}
