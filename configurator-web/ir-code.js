// G:<protocol>:(<start>)(<repeat>)(<finish>):<trailer>
// Each data token is <segment id>x<hex digits>; named tokens refer to fixed
// protocol segments. Format values as written, without applying protocol padding,
// toggle bits or symbol encodings. See the Harmony IR archive's keycode grammar:
// https://github.com/pickysysadmin/logitech-harmony-ir-archive#rendering-a-keycode-yourself
export function keycodeData(keycode) {
  if(typeof keycode!=='string') return null;
  const match=/^G:([^:()\r\n]+):\(([^()]*)\)\(([^()]*)\)\(([^()]*)\):([^:\s()]+)$/.exec(keycode.trim());
  if(!match) return null;
  const values=[];
  for(const [index,phase] of ['Start','Repeat','Finish'].entries()) {
    const group=match[index+2].trim();if(!group) continue;
    for(const token of group.split('_')) {
      const data=/^([A-Za-z0-9])x([0-9A-Fa-f]+)$/.exec(token);
      if(!data) {
        if(!/^[A-Za-z0-9]+$/.test(token) || token[1]==='x') return null;
        continue;
      }
      const digits=data[2].toUpperCase(), first=digits.length%2 || 2, groups=[digits.slice(0,first)];
      for(let i=first;i<digits.length;i+=2) groups.push(digits.slice(i,i+2));
      const binary=groups.map(group=>[...group].map(digit=>parseInt(digit,16).toString(2).padStart(4,'0')).join('')).join(' ');
      values.push({phase,segment:data[1],hex:groups.join(' '),binary});
    }
  }
  return values;
}
