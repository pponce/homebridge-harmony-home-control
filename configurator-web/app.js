import { helpText } from './help.js';
import { settingSpec, draftValue, isInfrared, orderedInputs, powerTypeLabel, inputMethodLabel, formatDraftValue, connectionsFor, pathsFor, powerMethods, methodsFor } from './settings.js';

(() => {
  const $ = id => document.getElementById(id);
  let data, csrf, view = 'devices', selectedDevice, selectedActivity, contextDirty = false, localBusy = false, timer, editAction;
  const cloudReads = new Map();
  const e = (tag,text,cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const display = value => value == null || value === '' ? 'Not supplied' : value === true ? 'Yes' : value === false ? 'No' : String(value);
  const time = value => value ? new Date(value).toLocaleString() : 'not yet read';
  const badge = (text,warn = false) => e('span',text,`badge${warn ? ' warning' : ''}`);
  const p = text => e('p',text);
  let fieldSequence = 0;
  function helpButton(label, explanation) {
    const b = e('button','?','field-help-button'); b.type = 'button';
    b.setAttribute('aria-label',`Help for ${label}`); b.setAttribute('aria-haspopup','dialog');
    b.setAttribute('aria-controls','field-help'); b.title = `Explain ${label}`;
    b.onclick = () => {
      $('field-help-title').textContent = `About ${label}`;
      $('field-help-text').textContent = typeof explanation === 'function' ? explanation() : explanation;
      $('field-help').showModal();
    };
    return b;
  }
  function helpLabel(label, explanation = helpText[label]) {
    const n = e('span',undefined,'help-label'); n.append(e('span',label));
    if (explanation) n.append(helpButton(label,explanation));
    return n;
  }
  function message(text,error = false) { $('message').textContent = text; $('message').hidden = !text; $('message').className = error ? 'error' : ''; }
  function button(label,run,cls = '') {
    const node = e('button',label,cls); node.type = 'button';
    node.onclick = async () => { if (localBusy) return; node.disabled = true; try { await run(); } catch (error) { message(error.message,true); } finally { if (node.isConnected) node.disabled = false; } };
    return node;
  }
  function link(text,url) { const a = e('a',text); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
  function note(text,warn = false) { return e('p',text,`note${warn ? ' warning' : ''}`); }
  function titleRow(tag,title,explanation = helpText[title]) { const row=e('div',undefined,'section-title'); row.append(e(tag,title)); if (explanation) row.append(helpButton(title,explanation)); return row; }
  function panel(title,description,explanation = helpText[title]) { const n = e('section',undefined,'panel'); if (title) n.append(titleRow('h2',title,explanation)); if (description) n.append(e('p',description,'muted')); return n; }
  function details(title,contents,explanation = helpText[title]) {
    const wrap=e('div',undefined,'disclosure'), n=e('details'); n.append(e('summary',title),contents); wrap.append(n);
    if (explanation) wrap.append(helpButton(title,explanation)); return wrap;
  }
  function field(parent,label,input,help) {
    const n = e('div',undefined,'field'), row = e('div',undefined,'field-label'), caption = e('label',label);
    input.id ||= `field-${++fieldSequence}`; caption.htmlFor = input.id; row.append(caption);
    const hint = help ? e('small',help) : null;
    if (helpText[label] || hint) row.append(helpButton(label,() => [helpText[label],hint?.textContent].filter(Boolean).join('\n\n')));
    n.append(row,input); input.setAttribute('aria-label',label);
    if (hint) { hint.id = `${input.id}-hint`; input.setAttribute('aria-describedby',hint.id); n.append(hint); }
    parent.append(n); return n;
  }
  function select(values,current = 'unknown') { const n = e('select'); for (const [value,label] of values) { const o = e('option',label); o.value = value; n.append(o); } n.value = current; if (n.selectedIndex < 0) n.value = 'unknown'; return n; }
  function table(headers,rows,cls = '') {
    const wrap = e('div',undefined,'table-wrap'), t = e('table',undefined,cls), head = e('thead'), hr = e('tr');
    headers.forEach(h => { const th = e('th'); th.append(helpLabel(h)); th.scope = 'col'; hr.append(th); }); head.append(hr); t.append(head);
    const settings = headers[0] === 'Setting' || cls === 'settings';
    const body = e('tbody'); for (const row of rows) { const tr = e('tr'); row.forEach((item,index) => { const td = e('td'); td.append(settings && index === 0 && typeof item === 'string' ? helpLabel(item) : item instanceof Node ? item : document.createTextNode(display(item))); tr.append(td); }); body.append(tr); }
    t.append(body); wrap.append(t); return wrap;
  }
  function heading(title,description) { const n = e('div',undefined,'page-head'), text = e('div'); text.append(titleRow('h1',title),p(description)); n.append(text,badge('Imported + your context')); return n; }
  async function api(path,payload) {
    const response = await fetch(`/api/${path}`,{method:payload ? 'POST' : 'GET',credentials:'same-origin',headers:payload ? {'Content-Type':'application/json','X-Configurator-CSRF':csrf || ''} : {},body:payload ? JSON.stringify(payload) : undefined});
    let result;
    try { result = await response.json(); } catch { throw new Error(`The web server returned an unreadable response (HTTP ${response.status}). Try again; if this continues, check the web server connection.`); }
    if (!response.ok) { const error = new Error(result.error || 'The request failed.'); error.status = response.status; throw error; } return result;
  }
  async function load() { data = await api(`state?host=${encodeURIComponent($('hub').value || '')}`); }
  async function mutate(path,payload = {}) {
    if (localBusy || data.busy) throw new Error('Wait for the current operation to finish.');
    localBusy = true; updateToolbar();
    try { data = await api(path,{host:data.host,revision:data.revision,...payload}); return data; }
    catch (error) { try { await load(); } catch {} throw error; }
    finally { localBusy = false; updateToolbar(); schedulePoll(); }
  }
  function updateToolbar() { $('read').disabled = !data || localBusy || data.busy; $('hub').disabled = !data || localBusy || data.busy; $('export').disabled = !data?.snapshot; }
  function unsaved() { return !contextDirty || window.confirm('Discard your unsaved Setup Assistant answers?'); }
  function navigate(next) { if (!unsaved()) return; contextDirty = false; view = next; render(); }
  function render() {
    updateToolbar();
    const s = data.snapshot;
    $('device-count').textContent = s?.devices.length ?? '—'; $('activity-count').textContent = s?.activities.length ?? '—'; $('suggestion-count').textContent = data.suggestions.length; $('change-count').textContent = data.drafts.filter(d => !['hub-confirmed','remote-confirmed'].includes(d.status)).length;
    for (const n of document.querySelectorAll('[data-view]')) { if (n.dataset.view === view) n.setAttribute('aria-current','page'); else n.removeAttribute('aria-current'); }
    $('snapshot-status').textContent = data.lastError ? `Last read failed: ${data.lastError} Showing the previous import from ${time(s?.readAt)}.` : s ? `Imported from ${s.host} · ${time(s.readAt)}${data.busy ? ' · Operation in progress' : ''}` : 'No hub configuration imported yet.';
    const content = $('content'); content.replaceChildren();
    if (!s) { const empty = e('div',undefined,'empty'); empty.append(titleRow('h1','Get to know your Harmony setup',helpText['Devices']),p('Read your hub to see its devices, activities, power settings and inputs. Then add the HDMI and CEC details Harmony cannot see.'),button('Read hub',readHub,'primary')); content.append(empty); return; }
    ({devices:renderDevices,activities:renderActivities,assistant:renderAssistant,suggestions:renderSuggestions,changes:renderChanges})[view](content,s);
  }
  async function readHub() {
    if (!unsaved()) return;
    contextDirty = false; message('Reading device, activity and button resources from the hub…');
    try { await mutate('refresh'); render(); message('Configuration imported. Reading the hub does not send power or input commands.'); }
    catch (error) { render(); throw error; }
  }
  const deviceName = id => data.snapshot.devices.find(d => d.id === id)?.name || id || 'No device';
  function items(list,selected,choose) {
    const n = e('div',undefined,'items'), search = e('input'); search.type = 'search'; search.placeholder = 'Find by name'; field(n,'Filter items',search);
    const buttons = list.map(item => { const b = button('',() => choose(item.id),item.id === selected ? 'active' : ''); b.append(e('span',item.name),e('small',item.model || `${item.roles?.length || 0} roles`)); n.append(b); return {item,b}; });
    search.oninput = () => { for (const {item,b} of buttons) b.hidden = !`${item.name} ${item.model || ''} ${item.manufacturer || ''}`.toLowerCase().includes(search.value.toLowerCase()); };
    return n;
  }
  function actionsTable(actions) { return actions.length ? table(['Order','Action','Command / device','Duration / delay'],actions.map(a => [a.order,a.type,`${a.command || a.input || '—'}${a.deviceId ? ` · ${deviceName(a.deviceId)}` : ''}`,`${a.duration ?? '—'} / ${a.delay ?? '—'}`])) : p('No explicit actions supplied.'); }
  function editButton(kind,item,field,label,role,inputName) {
    const target={kind,id:item.id,field,role,...(inputName === undefined ? {} : {inputName})}, spec=settingSpec(target), value=draftValue(role === undefined ? item : item.roles[role],field,inputName);
    label ||= spec.label;
    const b = button(value === null ? 'Set draft' : 'Edit draft',() => openEdit(target,label,value,spec,item));
    b.disabled = data.busy || ['actions','activity-actions'].includes(spec.type) && value?.some(a=>a.kind === 'unsupported'); b.setAttribute('aria-label',`${value === null ? 'Set' : 'Edit'} ${label} for ${item.name}`);
    if(b.disabled && !data.busy) b.title='This sequence contains an action type that must be configured in Harmony.';
    return b;
  }
  function renderDevices(content,s) {
    content.append(heading('Devices','Inspect the power policy, inputs, delays and commands Harmony has stored for each device.'));
    if (!s.devices.length) { content.append(note('This hub returned an empty device list.')); return; }
    const d = s.devices.find(x => x.id === selectedDevice) || s.devices[0]; selectedDevice = d.id;
    const split = e('div',undefined,'split'), detail = e('div'); split.append(items(s.devices,d.id,id => {selectedDevice = id; render();}),detail); content.append(split);
    const card = panel(), head = e('div',undefined,'panel-head'), title = e('div'); title.append(titleRow('h2',d.name,helpText['Device details']),p([d.manufacturer,d.model].filter(Boolean).join(' · '))); head.append(title,badge('Imported')); card.append(head);
    card.append(table(['Setting','Value','Reported default',''],[
      ['Device name',d.name,'',editButton('device',d,'name')],
      ['Control transport',d.transportLabel || d.transport || 'Not reported by hub','Unknown',p('Determined by the device profile')],
      ['Control port',d.controlPortLabel || d.controlPort || 'Not reported by hub','Unknown',isInfrared(d) ? editButton('device',d,'controlPort') : p(d.transport ? 'IR assignment requires infrared control' : 'Read hub to identify the transport')],
      ['Command repeats',d.repeats,d.defaults?.repeats ?? 'Unknown',editButton('device',d,'repeats')],
      ['Power command type',powerTypeLabel(d.power.type),'Unknown',editButton('device',d,'power.type')]
    ]));
    const missing=note('Not supplied means the imported value is unknown. It does not mean zero or a known default.'); missing.append(document.createTextNode(' '),helpButton('Missing values and defaults',helpText['Missing values and defaults'])); card.append(missing);
    card.append(note('Edit a draft, review its current cloud value, then save to Logitech. Compile & sync updates the hub. Available settings depend on the device profile.'),button('Logitech login & review changes',()=>navigate('changes')));
    detail.append(card);
    const power = panel('Power behavior');
    power.append(table(['Setting','Value',''],[
      ['Harmony skips all power commands',d.power.alwaysOn,editButton('device',d,'power.alwaysOn')],
      ['Keep on between activities',d.power.betweenActivities,editButton('device',d,'power.betweenActivities')]
    ],'settings'));
    const actionDetail=e('div'); power.append(details('Power actions',actionDetail));
    for (const [key,label] of [['on','On'],['off','Off'],['toggle','Toggle']]) { actionDetail.append(titleRow('h3',label),actionsTable(d.power[key]),editButton('device',d,`power.${key}`)); }
    detail.append(power);
    const delays = panel('Timing'); const delayFields = [['powerOn','Power-on delay'],['input','Input delay'],['interDevice','Inter-device delay'],['interKey','Inter-key delay']];
    delays.append(table(['Delay','Value (ms)','Reported default (ms)',''],delayFields.map(([key,label]) => [label,d.delays[key],d.defaults?.delays?.[key] ?? 'Unknown',editButton('device',d,`delays.${key}`)]),'settings')); detail.append(delays);
    const inputs = panel('Inputs'); inputs.append(table(['Setting','Value',''],[['Input method',inputMethodLabel(d.inputMethod),editButton('device',d,'inputMethod')]]));
    if (!d.inputMethod && d.inputs.length) inputs.append(p('The hub supplied the input list and commands, but no input method. The list alone does not establish the method or a default.'));
    inputs.append(d.inputs.length ? table(['Input order','Input','Commands',''],orderedInputs(d).map(i => [i.order,i.name,i.actions.map(a => a.command || a.type).join(', '),editButton('device',d,'inputCommands',`${i.name} commands`,undefined,i.name)])) : p('No inputs supplied by this device profile.'));
    if (d.inputs.length && d.inputs.every(i => i.name) && new Set(d.inputs.map(i => i.name)).size === d.inputs.length) inputs.append(editButton('device',d,'inputOrder'));
    const guidance=e('div'); guidance.append(p(helpText['Configure input switching']),p('Edit the commands beside each input, or expand Input sequence actions for shared Start, Next, Previous and Finish commands. Review and save the required commands before changing the method; then compile and sync. Profiles with unsupported methods or action types still use Harmony → Devices → Input Settings.'),link('Harmony input settings guide ↗','https://support.myharmony.com/en-us/viewing-and-adjusting-your-devices-input-list'));
    inputs.append(details('Configure input switching',guidance));
    const moreInput = e('div'); moreInput.append(p('Edit command and delay steps, then review the cloud save. Saving a sequence does not run its commands.'));
    for (const [key,label] of [['start','Start input selection'],['next','Next input'],['previous','Previous input'],['finish','Finish input selection']]) moreInput.append(titleRow('h3',label),actionsTable(d.inputActions[key] || []),editButton('device',d,`inputActions.${key}`));
    inputs.append(details('Input sequence actions',moreInput)); detail.append(inputs);
    const commands = panel(`${d.commands.length} available commands`,undefined,helpText['Available commands']), chips = e('div',undefined,'chips'); d.commands.forEach(c => chips.append(e('span',c,'chip'))); commands.append(details('Show command names',chips),e('p','Command names are inspected only; this page does not send them.','muted')); detail.append(commands);
    if(isInfrared(d)) {
      cloudReadButton(commands,'Load IR codes','ir-codes',{kind:'device',id:d.id});
      commands.append(p('Logitech may supply a Raw payload for individual IR commands. Payloads are shown exactly as returned; their format may not be Pronto hex. Commands without a supplied payload cannot be exported as IR codes.'));
      if(data.cloud.codes?.deviceId===d.id) {
        const codes=data.cloud.codes.commands, supplied=codes.filter(c=>c.raw);
        commands.append(p(`${supplied.length} of ${codes.length} commands include a Raw payload.`));
        if(supplied.length) commands.append(button('Export this device’s IR codes',()=>{
          const url=URL.createObjectURL(new Blob([JSON.stringify({format:'harmony-raw-command-export',version:1,device:{id:d.id,name:d.name},commands:supplied},null,2)],{type:'application/json'})), a=e('a');a.href=url;a.download=`harmony-ir-${d.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }));
        else commands.append(note(codes.length ? 'Logitech did not supply IR payloads for this device.' : 'Logitech returned no commands for this device.'));
        for(const [index,code] of supplied.entries()) {const box=e('textarea');box.readOnly=true;box.value=code.raw;box.setAttribute('aria-label',`Harmony Raw payload for ${code.name}`);const row=details(code.name,box);row.querySelector('details').open=index===0;commands.append(row);}
        if(codes.some(c=>!c.raw)) commands.append(details('Commands without a supplied IR payload',p(codes.filter(c=>!c.raw).map(c=>c.name).join(', '))));
      }
    }
    appendMaps(detail,s.maps.filter(m => m.deviceId === d.id),{kind:'device',id:d.id});
    detail.append(e('p',s.coverage,'muted')); if (s.unavailable.length) detail.append(note(`Unavailable resources: ${s.unavailable.join(', ')}.`,true));
  }
  function renderActivities(content,s) {
    content.append(heading('Activities','See which devices participate, their selected inputs, configured power order, and explicit start/end actions.'));
    if (!s.activities.length) { content.append(note('This hub returned an empty activity list.')); return; }
    const a = s.activities.find(x => x.id === selectedActivity) || s.activities[0]; selectedActivity = a.id;
    const split = e('div',undefined,'split'), detail = e('div'); split.append(items(s.activities,a.id,id => {selectedActivity=id; render();}),detail); content.append(split);
    const card = panel(a.name,undefined,helpText['Activity details']), activityType = p(''); activityType.append(helpLabel('Activity type'),document.createTextNode(`: ${display(a.type)}`)); card.append(activityType);
    card.append(table(['Setting','Value',''],[['Name',a.name,editButton('activity',a,'name')],['Display order',a.order,editButton('activity',a,'order')]])); detail.append(card);
    const roles = panel('Power order & inputs','Configured order is not a measured execution trace. Harmony can skip devices already on; CEC and automations can act independently.');
    const orderCell = (r,key,label) => { const cell = e('div'); cell.append(e('div',display(r[key]),'value'),editButton('activity',a,key,`${deviceName(r.deviceId)} ${label}`,r.index)); return cell; };
    roles.append(table(['Device / role','Selected input','On order','Off order','Next delay (ms)'],[...a.roles].sort((x,y)=>(x.powerOnOrder ?? 9999)-(y.powerOnOrder ?? 9999)).map(r => { const who = e('div'); who.append(e('strong',deviceName(r.deviceId)),e('div',r.type.split(':')[0],'muted')); return [who,s.devices.find(d=>d.id===r.deviceId)?.inputs.length ? orderCell(r,'input','selected input') : r.input || 'No inputs available',orderCell(r,'powerOnOrder','power-on order'),orderCell(r,'powerOffOrder','power-off order'),orderCell(r,'nextDeviceDelay','next-device delay')]; })));
    roles.append(note('Edit selected inputs, power order and delays here. To add or remove participating devices or change their roles, use Harmony activity setup.')); detail.append(roles);
    for (const [label,key] of [['Start actions','enter'],['End actions','leave']]) { const card = panel(label); card.append(actionsTable(a[key]),editButton('activity',a,key)); detail.append(card); }
    appendMaps(detail,s.maps.filter(m => m.activityId === a.id),{kind:'activity',id:a.id});
  }
  function cloudReadButton(parent,label,path,owner) {
    const ready=data.cloud.saved || data.cloud.connected && data.cloud.host===data.host;
    const key=JSON.stringify([data.host,path,owner.kind,owner.id]), state=cloudReads.get(key), status=e('p',undefined,'cloud-read-status');
    status.dataset.cloudRead=key;status.tabIndex=-1;status.setAttribute('role',state?.error ? 'alert' : 'status');
    const loaded=path==='ir-codes' ? data.cloud.codes?.deviceId===owner.id : data.cloud.mapOwner?.kind===owner.kind && data.cloud.mapOwner.id===owner.id;
    status.textContent=state?.error ? `${state.error}${loaded ? ' Showing the previously loaded data.' : ''}` : state?.loading ? 'Loading from Logitech…' : loaded ? 'Loaded from Logitech.' : !data.cloud.loginAvailable ? 'Open this page over HTTPS or through localhost to load Logitech data.' : !ready ? 'Save your Logitech login in Review changes to load this data.' : data.busy || localBusy ? 'Wait for the current operation to finish.' : '';
    status.hidden=!status.textContent;if(state?.error) status.classList.add('error');
    const b=e('button',state?.loading ? 'Loading…' : label);b.type='button';
    b.disabled=!ready || !data.cloud.loginAvailable || data.busy || localBusy;
    b.onclick=async()=>{
      if(localBusy || data.busy) return;
      const startHost=data.host,startView=view;
      cloudReads.set(key,{loading:true});b.disabled=true;b.textContent='Loading…';parent.setAttribute('aria-busy','true');
      status.classList.remove('error');status.setAttribute('role','status');status.hidden=false;status.textContent='Loading from Logitech…';
      try {await mutate(path,{owner});cloudReads.delete(key);}
      catch(error){cloudReads.set(key,{error:error.message});}
      finally {
        parent.removeAttribute('aria-busy');
        if(data.host===startHost && view===startView && (owner.kind==='device'?selectedDevice:selectedActivity)===owner.id && !contextDirty && !$('editor').open) {
          render();const result=[...document.querySelectorAll('[data-cloud-read]')].find(n=>n.dataset.cloudRead===key);
          result?.focus({preventScroll:true});result?.scrollIntoView({block:'nearest'});
        }
      }
    };
    parent.append(b,status);
    if(!ready) parent.append(button('Logitech login',()=>navigate('changes')));
  }
  function appendMaps(parent,maps,owner) {
    const card = panel('Button maps');
    cloudReadButton(card,'Load cloud button maps','button-maps',owner);
    card.append(p('Load the remote’s maps from Logitech to edit existing button assignments. Each save changes one gesture on one button.'));
    const loaded=data.cloud.mapOwner?.kind===owner.kind && data.cloud.mapOwner.id===owner.id;
    if(loaded) {
      const cloudMaps=data.cloud.maps;
      if(!cloudMaps.length) card.append(note('Logitech supplied no editable maps for this device or activity. Use Harmony button customization.'));
      for(const [index,map] of cloudMaps.entries()) {
        const block=e('div');
        block.append(table(['Button','Gesture','Assignment',''],map.buttons.flatMap(b=>Object.entries({press:'Short press',long:'Long press',double:'Double press'}).map(([gesture,label])=> {
          const action=b[gesture], name=b.label || b.key || b.id || 'Unidentified button';
          const editable=['HardRemoteButton','SoftRemoteButton'].includes(b.type) && (b.key || b.id) && action?.kind!=='unsupported';
          const edit=editable ? button('Edit draft',()=>editButtonMap(owner,map,b,gesture)) : p('Use Harmony for this action');
          if(editable) edit.setAttribute('aria-label',`Edit ${name} ${label.toLowerCase()}`);
          return [name,label,formatDraftValue({kind:'button'},action),edit];
        }))));
        const surface=details(`Remote surface ${map.target.surfaceId}${map.target.mapId ? ` · map ${map.target.mapId}` : ''}`,block,helpText['Button map']);surface.querySelector('details').open=index===0;card.append(surface);
      }
      card.append(p('To add buttons, change touchscreen layout, or edit named sequences and system actions, use Harmony button customization. Gesture support depends on the remote.'));
    } else {
      if (!maps.length) card.append(p('No matching button map was supplied by the hub.'));
      if(maps.length) card.append(p('Assignments from the most recent Read hub.'));
      for (const m of maps) {
        const block=e('div'), hasGroups=m.buttons.some(b=>b.group);
        block.append(table(['Button',...(hasGroups?['Group']:[]),'Action'],m.buttons.map(b=>{
          const a=b.action,type=a.type.split(':')[0],action=type==='ButtonClientAction' ? `System action: ${a.name || 'Name not supplied'}` : `${a.command || a.name || (a.channel ? `Channel ${a.channel}` : type || 'No assignment')}${a.deviceId ? ` · ${deviceName(a.deviceId)}` : ''}`;
          return [b.label || b.key || (b.id ? `Button ${b.id}` : 'Unnamed button'),...(hasGroups?[b.group || '—']:[]),action];
        })));
        for(const s of m.sequences) block.append(titleRow('h3',s.name,helpText['Button sequence']),actionsTable(s.actions));
        const assignments=details(m.id ? `Map ${m.id}` : 'Hub button assignments',block,helpText['Button map']);assignments.querySelector('details').open=true;card.append(assignments);
      }
    }
    parent.append(card);
  }
  function editButtonMap(owner,map,b,gesture) {
    const item=(owner.kind==='device'?data.snapshot.devices:data.snapshot.activities).find(d=>d.id===owner.id), before=b[gesture];
    const devices=data.snapshot.devices.filter(d=>owner.kind==='device'?d.id===owner.id:item.roles.some(r=>r.deviceId===d.id));
    const block=e('div'), controls=e('div'), kind=select([...(gesture==='press'?[]:[['none','Unassigned']]),...(!before || before.kind==='command' ? [['command','Device command']] : []),...(!before || before.kind==='channel' ? [['channel','Channel number']] : [])],before?.kind || (gesture==='press'?'command':'none'));
    field(block,'Assignment type',kind);block.append(controls);let device,command,channel;
    const draw=()=>{
      controls.replaceChildren();if(kind.value==='none') return;
      device=select([['','Choose a device'],...devices.map(d=>[d.id,d.name])],before?.deviceId || (devices.length===1?devices[0].id:''));device.required=true;field(controls,'Device',device);
      if(kind.value==='command') {command=select([]);command.required=true;const update=()=>{command.replaceChildren(...select([['','Choose a command'],...(devices.find(d=>d.id===device.value)?.commands || []).map(c=>[c,c])],before?.command || '').children);};device.onchange=update;update();field(controls,'Command',command);}
      else {channel=e('input');channel.required=true;channel.maxLength=12;channel.pattern='[0-9.\\-]+';channel.value=before?.channel || '';field(controls,'Channel number',channel);}
    };
    kind.onchange=draw;draw();const revision=data.revision,version=data.snapshot.version;
    showEditor(`${b.label || b.key || b.id} · ${{press:'Short press',long:'Long press',double:'Double press'}[gesture]}`,[block],'Save draft',async()=>{
      const value=kind.value==='none'?null:{kind:kind.value,deviceId:device.value,...(kind.value==='command'?{command:command.value}:{channel:channel.value})};
      await mutate('draft',{revision,change:{kind:'button',id:owner.id,ownerKind:owner.kind,field:gesture,button:{key:b.key,id:b.id,type:b.type},mapTarget:map.target,value,version}});view='changes';render();
    });
  }
  const unknown = ['unknown','I’m not sure'];
  const cecHelp = kind => ({tv:'On Samsung, look for Anynet+ (HDMI-CEC) under the external-device settings. Names vary by model.',receiver:'On Anthem, inspect HDMI CEC power, input and standby settings separately. Record exceptions in your automation notes.',ps5:'Check Settings → System → HDMI. Record Device Link, One-Touch Play and Power Off Link separately in the notes.',switch:'Check System Settings → TV Settings / TV Output → Match TV Power State.', 'apple-tv':'Check Settings → Remotes and Devices → Control TVs and Receivers. Confirm the Harmony profile and Bluetooth pairing.'})[kind] || 'Check the device’s HDMI-CEC settings. Harmony cannot read this setting.';
  function answerRows(parent,title,description,initial,addLabel,device,build) {
    const section=e('section',undefined,'answer-list'), rows=e('div'), entries=[];
    section.append(titleRow('h3',title),e('p',description,'muted'),rows); parent.append(section);
    const changed=() => section.dispatchEvent(new Event('input',{bubbles:true}));
    const addRow = (answer = {},focus = false) => {
      if (entries.length >= 32) return;
      const row=e('div',undefined,'answer-row'), grid=e('div',undefined,'assistant-grid'), fields={};
      const add = (key,label,options,max = 100) => {
        const input=options ? select(options,answer[key] ?? options[0][0]) : e('input');
        if (!options) {input.value=answer[key] || ''; input.maxLength=max;}
        if (options?.[0]?.[0] === '') input.required=true;
        fields[key]=input; field(grid,label,input); return input;
      };
      build(add); const entry={row,fields}; entries.push(entry);
      const remove=button('Remove',() => {entries.splice(entries.indexOf(entry),1);row.remove();addButton.disabled=false;changed();addButton.focus();});
      remove.setAttribute('aria-label',`Remove ${title.toLowerCase()} row for ${device.name}`);
      row.append(grid,remove); rows.append(row); addButton.disabled=entries.length>=32;
      if (focus) {changed();Object.values(fields)[0]?.focus();}
    };
    const addButton=button(addLabel,() => addRow({},true)); addButton.setAttribute('aria-label',`${addLabel} for ${device.name}`); section.append(addButton);
    for (const answer of initial) addRow(answer);
    return () => entries.map(({fields}) => Object.fromEntries(Object.entries(fields).map(([key,input]) => [key,input.value])));
  }
  function renderAssistant(content,s) {
    const formRevision = data.revision;
    content.append(heading('Fill in the missing pieces','Describe the physical wiring and the behavior you want. “I’m not sure” keeps a recommendation conditional until you test it.'));
    const form = e('form'), controls = {}, lists = {}, methodChecks = {}; content.append(form);
    for (const d of s.devices) {
      const a = data.context.devices[d.id] || {}, card = panel(d.name,`${d.manufacturer} ${d.model}`,helpText['Setup device']), grid = e('div',undefined,'assistant-grid'); controls[d.id] = {};
      const add = (key,label,options,help) => { const input = select(options,a[key]); controls[d.id][key] = input; return {input,label:field(grid,label,input,help)}; };
      const kind = add('kind','Device type',[unknown,['tv','TV'],['receiver','AV receiver'],['ps5','PlayStation 5'],['switch','Nintendo Switch'],['apple-tv','Apple TV'],['other','Other device']]);
      const cec = add('cec','HDMI-CEC is',[unknown,['on','Enabled'],['off','Disabled']],cecHelp(a.kind));
      methodChecks[d.id]={};
      for (const [direction,label] of [['wake','Methods that can wake this device'],['sleep','Methods that can put it to sleep']]) {
        const group=e('fieldset',undefined,'power-methods'), legend=e('legend'); group.setAttribute('aria-label',label);legend.append(helpLabel(label));group.append(legend);grid.append(group);
        const selected=methodsFor(a,direction); methodChecks[d.id][direction]={};
        for (const [method,name] of powerMethods) {
          const checkbox=e('input');checkbox.type='checkbox';checkbox.checked=selected.includes(method);methodChecks[d.id][direction][method]=checkbox;
          field(group,name,checkbox).classList.add('checkbox-field');
        }
      }
      add('wakeBy','Preferred wake method for activities',[unknown,...powerMethods],'Choose the main method for activity startup. Multiple methods above may still be available.');
      add('sleepBy','Preferred sleep method for All Off',[unknown,...powerMethods],'Choose the main method for activity shutdown. Record other senders and triggers below.');
      add('switchBehavior','When switching away',[unknown,['keep','Keep it awake'],['sleep','Let it sleep']]);
      add('offBehavior','When I press All Off',[unknown,['keep','Keep it awake'],['sleep','Put it to sleep / standby']]);
      add('coldStart','Cold startup test',[unknown,['works','Works as intended'],['misses-input','Power works; input is missed'],['misses-power','Device does not wake']]);
      add('transition','Switching between activities',[unknown,['works','Works as intended'],['wrong-input','Wrong input'],['unexpected-sleep','A device sleeps unexpectedly']]);
      const update = () => { cec.label.querySelector('small').textContent = cecHelp(kind.input.value); };
      kind.input.addEventListener('change',update); update(); card.append(grid); form.append(card);
      lists[d.id] = {};
      lists[d.id].connections=answerRows(card,'HDMI connections','One row per output cable. Record the sending port, receiving port and any ARC/eARC audio return.',connectionsFor(a),'Add HDMI connection',d,add => {
        add('outputPort','Output port on this device').placeholder='e.g. HDMI OUT 1 (eARC)';
        add('destination','HDMI output connects to',[unknown,['none','No connected device'],...s.devices.filter(x => x.id !== d.id).map(x => [x.id,x.name])]);
        add('port','Input on that destination').placeholder='e.g. HDMI 2 (eARC)';
        add('audioReturn','ARC/eARC on this connection',[unknown,['none','No audio return'],['arc','ARC'],['earc','eARC']]);
      });
      lists[d.id].powerPaths=answerRows(card,'Wake and sleep paths','Add additional devices, HomeKit/Homebridge buttons or automations. Describe when each acts.',pathsFor(a),'Add wake or sleep path',d,add => {
        add('direction','Power action',[['','Choose wake or sleep'],['wake','Wake'],['sleep','Sleep / standby']]);
        add('method','Control method',[['','Choose a method'],...powerMethods]);
        add('controller','Controller or sending device',[unknown,['external','External controller / automation'],...s.devices.filter(x => x.id !== d.id).map(x => [x.id,x.name])]);
        add('trigger','Trigger or button',null,240).placeholder='e.g. TV switches off or HomeKit Sleep button';
      });
    }
    const auto = panel('HomeKit & other automations','Include triggers, waits, conditions and actions. Describe any wake/sleep exceptions or individual CEC switches here. These notes are retained for manual review.');
    const notes = e('textarea'); notes.value = data.context.automations || ''; notes.maxLength = 6000; field(auto,'Automation and CEC notes',notes,'For example: Receiver off → wait → check it is still off → send Harmony All Off. Include what should happen if another activity starts during the wait.'); form.append(auto);
    const dock = e('div',undefined,'sticky-actions'), status = e('span','Answers are saved locally.'); const save = e('button','Save answers','primary'); save.type = 'submit'; dock.append(status,save); form.append(dock);
    form.addEventListener('input',() => {contextDirty = true; status.textContent = 'You have unsaved answers.';});
    form.onsubmit = async event => {
      event.preventDefault(); save.disabled = true;
      const context = {devices:{},automations:notes.value};
      for (const [id,fields] of Object.entries(controls)) context.devices[id] = {...Object.fromEntries(Object.entries(fields).map(([key,input]) => [key,input.value])),connections:lists[id].connections(),powerPaths:lists[id].powerPaths(),powerMethods:Object.fromEntries(Object.entries(methodChecks[id]).map(([direction,checks]) => [direction,Object.keys(checks).filter(method => checks[method].checked)]))};
      try { await mutate('context',{context,revision:formRevision}); contextDirty = false; render(); message('Answers saved. Suggestions now use your wiring, power choices and test results.'); }
      catch (error) { message(error.message,true); save.disabled = false; }
    };
  }
  function renderSuggestions(content) {
    content.append(heading('Suggestions for your setup','Each recommendation shows its evidence and a test. No setting changes automatically.'));
    if (!data.suggestions.length) { content.append(note('No rule matched the imported settings and saved answers. Complete the Setup Assistant and record test outcomes; this does not prove the setup is optimal.')); return; }
    const grid = e('div',undefined,'recommendations'); content.append(grid);
    for (const a of data.suggestions) {
      const card = panel(); card.append(e('p',a.device,'device-label'),titleRow('h2',a.title,helpText['Suggestion']),badge(a.confidence,a.confidence.includes('input') || a.confidence.includes('mismatch')));
      const dl = e('dl'); for (const [label,text] of [['Current / reported',a.current],['Suggested next step',a.proposed],['Why',a.why],['How to test',a.test]]) { const term = e('dt'); term.append(helpLabel(label)); dl.append(term,e('dd',text)); } card.append(dl);
      const actions = e('div',undefined,'actions'); if (a.deviceId) actions.append(button('Inspect device',() => {selectedDevice=a.deviceId; navigate('devices');})); actions.append(button('Update answers',() => navigate('assistant'))); card.append(actions);
      if (a.source) card.append(link('Manufacturer guidance ↗',a.source)); grid.append(card);
    }
  }
  const statusLabels = { draft:'Draft only',saving:'Saving',unconfirmed:'Cloud save unconfirmed',conflict:'Needs a fresh draft','cloud-saved':'Saved to Logitech · sync needed','hub-confirmed':'Confirmed on hub','remote-check':'Synced · check the remote','remote-confirmed':'Confirmed on remote','changed-again':'Hub value changed again','manual-pending':'Waiting for app change + sync' };
  function renderChanges(content) {
    content.append(heading('Review changes','Draft locally, choose where to apply, then read the hub to verify the result. Discarding a draft does not undo an applied setting.'));
    const cloud = panel('Logitech cloud', 'Save device settings, input and power command sequences, activity names, display order and role power order. Each change is reviewed before saving; compile and sync updates the hub.');
    const connected = data.cloud.connected && data.cloud.host === data.host;
    if(data.cloud.saved) cloud.append(note('Logitech login saved on this server. It is used automatically for cloud changes and sync, including after Homebridge restarts. The saved password is never displayed.'));
    if(data.cloud.savedNeedsUpdate) cloud.append(note('The saved login was verified for a different hub/account identity at this address. Read the hub and save the login again, or forget it.',true),button('Forget saved login',async()=>{await mutate('forget-login');render();}));
    if (connected) {
      cloud.append(note(data.cloud.saved ? 'Connected to Logitech for this hub.' : 'Connected for this session. Your password has not been saved; reconnect after this session ends or Homebridge restarts.'));
    }
    if(connected || data.cloud.saved) {
      const actions=e('div',undefined,'actions'), sync=button('Compile & sync this hub',async()=>{await mutate('sync');render();},'primary');sync.disabled=!data.cloud.loginAvailable || data.busy;actions.append(sync);
      actions.append(data.cloud.saved ? button('Forget saved login',async()=>{await mutate('forget-login');render();message('Saved Logitech login removed and cloud sessions disconnected.');}) : button('Sign out of Logitech',async()=>{await mutate('logout');render();}));cloud.append(actions);
    }
    if (data.cloud.loginAvailable) {
      const form = e('form',undefined,'cloud-form'), email = e('input'), password = e('input'); email.type = 'email'; email.required = true; email.autocomplete = 'username'; password.type = 'password'; password.required = true; password.autocomplete = 'current-password';
      email.maxLength=254;password.maxLength=1024;
      field(form,'Logitech email',email); field(form,'Logitech password',password);
      const submit = e('button',data.cloud.saved ? 'Replace saved login' : 'Save Logitech login','primary'); submit.type = 'submit';submit.value='save';
      const temporary=e('button','Connect for this session');temporary.type='submit';temporary.value='session';form.append(submit);if(!data.cloud.saved)form.append(temporary);
      form.onsubmit = async event => {event.preventDefault(); const credentials = {email:email.value,password:password.value,remember:event.submitter?.value !== 'session'}; password.value = ''; submit.disabled = temporary.disabled = true; try {await mutate('login',credentials);render();message(credentials.remember ? 'Logitech login verified and encrypted for automatic reuse on this server.' : 'Connected to Logitech for this session; password not saved.');} catch (error) {message(error.message,true);submit.disabled=temporary.disabled=false;} finally {credentials.password='';}};
      const login=e('div');login.append(p('Save verifies this login against the selected hub, then stores it encrypted for automatic reuse. Connect for this session keeps only a temporary connection and does not save the password.'),form,note('Saved logins are encrypted on disk and excluded from review exports and Homebridge configuration. Anyone with administrator access to this server can still recover them. Your browser’s password manager is separate.'),e('p','Logitech email/password accounts only. Social and legacy logins are not supported.','muted'));
      cloud.append(connected || data.cloud.saved ? details(data.cloud.saved ? 'Replace Logitech login' : 'Save a login for future use',login,helpText['Logitech password']) : login);
    } else cloud.append(note('Cloud sign-in requires HTTPS or a localhost SSH tunnel. Use an HTTPS reverse proxy, or optionally configure a certificate for the plugin’s webserver. Hub inspection, answers, drafts and manual guidance work on this HTTP connection.',true));
    if (data.sync?.host === data.host) cloud.append(note(`${data.sync.status}: ${data.sync.message}`,data.sync.status === 'failed'));
    content.append(cloud);
    if (!data.drafts.length) { content.append(note('No changes drafted yet. Open a device or activity and choose Edit draft.')); return; }
    for (const d of data.drafts) {
      const card = panel(), head = e('div',undefined,'panel-head'), title = e('div'); title.append(titleRow('h2',`${d.name} · ${d.label}`,helpText['Change record'])); if (d.role !== undefined) title.append(p(`Activity role ${d.role+1}`)); head.append(title,badge(statusLabels[d.status] || d.status,!['draft','hub-confirmed','remote-confirmed'].includes(d.status))); card.append(head);
      const diff = e('div',undefined,'change-diff'); for (const [label,value] of [['Original value',d.before],['Proposed',d.value]]) {const block=e('div');block.append(helpLabel(label),e('strong',formatDraftValue(d,value)));diff.append(block);} card.append(diff);
      if (d.before == null && d.kind!=='button') card.append(note(`The original value was not supplied; no default is assumed. ${d.cloud ? 'Review cloud save reads the current Logitech value before you confirm.' : 'Apply this proposal in Harmony.'} Verification remains pending if the hub continues to omit the setting.`));
      if (d.error) card.append(note(d.error,true));
      if(d.kind==='button') card.append(note('Button saves are read back from Logitech. After compile and sync, verify the assignment on the remote; hub resources may omit its control surface.'));
      if (d.status === 'conflict' || d.status === 'changed-again') card.append(note('Read the hub, inspect the current value and create a new draft. An existing draft is never silently rebased.',true));
      if (d.status === 'unconfirmed') card.append(note('The save may have reached Logitech. Check the setting in Harmony, sync if appropriate, then Read hub. This change will not be replayed automatically.',true));
      const actions = e('div',undefined,'actions');
      if(d.kind==='button' && d.status==='remote-check') actions.append(button('I verified this on the remote',async()=>{await mutate('remote-verified',{key:d.key,confirm:true});render();}));
      if (d.cloud && d.status === 'draft') { const save = button('Review cloud save',() => confirmCloud(d),'primary'); save.disabled = !(connected || data.cloud.saved) || !data.cloud.loginAvailable || data.busy; actions.append(save); }
      if (!['hub-confirmed','remote-confirmed'].includes(d.status)) {
        const steps = e('div'), guide=settingSpec(d)?.guide;
        steps.append(p(`In Harmony, open ${d.kind === 'device' || d.ownerKind==='device' ? `Devices → ${d.name}` : `Activities → ${d.name} → Customize / Settings`}.`));
        const instructions={
          delay:'Use Fix Delay in the mobile app, or Change Device Settings → Device delay settings in MyHarmony. Change one delay at a time and test cold startup, activity switches and All Off.',
          power:'Use Power Settings. Choose the intended power behavior and, if required, the separate On/Off commands or toggle command. A setting cannot add a power capability the device lacks.',
          repeats:'Use Command Repeats in the mobile app, or Change Device Settings → Device command repeats in MyHarmony. Adjust the repeat value and test for missed or duplicated commands.',
          port:'Use Remote & Hub → IR Assignments to choose the hub and/or mini blaster outputs. Bluetooth does not use this IR assignment.',
          input:'Use Input Settings in Harmony. In MyHarmony, continue to the input list and drag inputs into the proposed order. Match the device’s actual menu or cycle. Reordering does not change the command assigned to each input.',
          inputMethod:'Use Input Settings in Harmony and choose the input-changing method. Complete the wizard to select its required commands, including any menu, navigation or confirmation steps. A method choice alone does not supply those commands.',
          commands:'Use Input Settings → Fix an input for selection commands, or Power Settings for power commands. Apply the proposed commands and pauses in order.',
          role:'Open activity settings for selected inputs, or startup/shutdown customization for the named device’s power order and delay.',
          activity:'Use activity settings for names and display order, or startup/shutdown customization for extra commands and delays.',
          buttons:'Use button customization for the named remote, device or activity and gesture.',
          device:'Rename the device in its settings.',
        };
        steps.append(p(instructions[guide] || 'Use the corresponding Harmony device or activity setting.'),e('p',`${d.label}: ${formatDraftValue(d,d.value)}`,'proposed-setting'),p('Save in Harmony and sync the hub, then return and choose Read hub. If this profile does not expose the setting, leave the draft unapplied.'));
        steps.append(button('I changed it in Harmony',async () => {await mutate('manual',{key:d.key});render();message('Marked for verification. Sync from Harmony, then Read hub.');})); card.append(details('Apply using the Harmony app',steps));
      }
      actions.append(button('Discard record',async () => {await mutate('discard',{key:d.key});render();})); card.append(actions); content.append(card);
    }
  }
  function showEditor(title,contents,submitLabel,run) {
    $('editor-title').textContent = title; $('editor-fields').replaceChildren(...contents); $('submit-editor').textContent = submitLabel; $('editor-error').hidden = true; editAction = run; $('editor').showModal();
  }
  function openEdit(target,label,before,spec,item) {
    const version = data.snapshot.version, revision = data.revision;
    const block=e('div'); let readValue,readSources;
    if (spec.type === 'actions' || spec.type === 'activity-actions') {
      const activity=spec.type==='activity-actions', devices=activity ? data.snapshot.devices.filter(d=>item.roles.some(r=>r.deviceId===d.id)) : [item];
      const rows=(before || []).map((action,index)=>({...action,source:index})), list=e('div',undefined,'sequence-editor');
      block.append(p(activity ? 'Add commands from this activity’s devices and delays in milliseconds. Steps run in the order shown.' : 'Choose commands available on this device. Hold duration is optional; leave it blank to keep the command’s normal duration. Delays and holds use milliseconds.'),list);
      const draw=()=>{
        list.replaceChildren();
        rows.forEach((row,index)=>{
          const line=e('fieldset',undefined,'sequence-row');line.append(e('legend',`Step ${index+1}: ${row.kind === 'command' ? 'Command' : 'Delay'}`));
          if(row.kind === 'command') {
            if(activity) {const device=select([['','Choose a device'],...devices.map(d=>[d.id,d.name])],row.deviceId);device.required=true;device.onchange=()=>{row.deviceId=device.value;row.command='';draw();};field(line,`Device ${index+1}`,device);}
            const available=activity ? devices.find(d=>d.id===row.deviceId)?.commands || [] : item.commands;
            const cmd=select([['','Choose a command'],...available.map(c=>[c,c])],row.command);cmd.required=true;cmd.onchange=()=>{row.command=cmd.value;};field(line,`Command ${index+1}`,cmd);
            if(!activity) {const duration=e('input');duration.type='number';duration.min=0;duration.max=60000;duration.step=1;duration.value=row.duration ?? '';duration.oninput=()=>{row.duration=duration.value===''?null:Number(duration.value);};field(line,`Hold duration ${index+1} (ms)`,duration);}
          } else {
            const delay=e('input');delay.type='number';delay.required=true;delay.min=0;delay.max=60000;delay.step=1;delay.value=row.delay ?? '';delay.oninput=()=>{row.delay=delay.value===''?null:Number(delay.value);};field(line,`Delay ${index+1} (ms)`,delay);
          }
          const actions=e('div',undefined,'actions');
          for(const [delta,text] of [[-1,'Move up'],[1,'Move down']]) {
            const move=button(text,()=>{const next=index+delta;[rows[index],rows[next]]=[rows[next],rows[index]];draw();list.children[next].querySelector('input,select').focus();});move.disabled=index+delta<0 || index+delta>=rows.length;move.setAttribute('aria-label',`${text} step ${index+1}`);actions.append(move);
          }
          const remove=button('Remove',()=>{rows.splice(index,1);draw();addCommand.focus();});remove.setAttribute('aria-label',`Remove step ${index+1}`);actions.append(remove);line.append(actions);list.append(line);
        });
        addCommand.disabled=rows.length>=32 || !devices.some(d=>d.commands.length);addDelay.disabled=rows.length>=32;
      };
      const addCommand=button('Add command',()=>{rows.push({kind:'command',command:'',...(activity ? {deviceId:''} : {duration:null}),source:null});draw();list.lastElementChild.querySelector('select').focus();});
      const addDelay=button('Add delay',()=>{rows.push({kind:'delay',delay:null,source:null});draw();list.lastElementChild.querySelector('input').focus();});
      const buttons=e('div',undefined,'actions');buttons.append(addCommand,addDelay);block.append(buttons);draw();
      readValue=()=>rows.map(({source,...action})=>action);readSources=()=>rows.map(r=>r.source);
    } else if (spec.type === 'activity-input') {
      const device=data.snapshot.devices.find(d=>d.id===item.roles[target.role].deviceId), input=select([['','Choose an input'],...device.inputs.map(i=>[i.name,i.name])],before || '');
      input.required=true;field(block,'Selected input',input);readValue=()=>input.value;
    } else if (spec.type === 'input-order') {
      const names=orderedInputs(item).map(i => i.name), list=e('ol',undefined,'input-order-list');
      block.append(helpLabel('Input order'),p(helpText['Input order']),list);
      const draw = () => {
        list.replaceChildren();
        names.forEach((name,index) => {
          const row=e('li'), actions=e('div',undefined,'actions'); row.append(e('span',name));
          for (const [delta,text] of [[-1,'Move up'],[1,'Move down']]) {
            const move=button(text,() => {const next=index+delta;[names[index],names[next]]=[names[next],names[index]];draw();list.children[next].querySelector(`button[data-direction="${delta}"]`).focus();});
            move.dataset.direction=delta;move.disabled=index+delta<0 || index+delta>=names.length;move.setAttribute('aria-label',`${text}: ${name}`);actions.append(move);
          }
          row.append(actions);list.append(row);
        });
      };
      draw(); readValue=() => names;
    } else {
      let input;
      const options=spec.type === 'boolean' ? [[true,'Yes'],[false,'No']] : spec.options;
      if (options) input=select([['','Choose a value'],...options],before == null ? '' : String(before));
      else {
        input=e('input');input.type=spec.type==='text'?'text':'number';input.value=before ?? '';
        if (spec.type==='text') input.maxLength=spec.maxLength;
        else {input.min=spec.min;input.max=spec.max;input.step=1;}
      }
      input.required=true;
      const range=!options && spec.type==='number' ? `Draft range: ${spec.min}–${spec.max}, in whole numbers. The Harmony app may offer a narrower range for this profile.` : '';
      field(block,'Proposed value',input,[helpText[spec.help],range].filter(Boolean).join(' '));
      const reportedDefault=target.field === 'repeats' ? item.defaults?.repeats : target.field.startsWith('delays.') ? item.defaults?.delays?.[target.field.split('.')[1]] : null;
      if (reportedDefault != null) block.append(p(`Reported profile default: ${reportedDefault}. This is separate from the imported value and is not selected automatically.`));
      readValue=() => {if(input.value==='')throw new Error('Choose or enter a proposed value.');return spec.type==='boolean'?input.value==='true':spec.type==='number'?Number(input.value):input.value;};
    }
    const contents=[e('p',`Value at last hub read: ${formatDraftValue(target,before)}`,'proposed-setting')];
    if (before === null) contents.push(note('No current value was supplied. Enter the setting you want; zero or a default has not been assumed.'));
    contents.push(block,note('Saving a draft does not change Harmony. Review changes explains how to apply it and verify the result.'));
    showEditor(label,contents,'Save draft',async () => {await mutate('draft',{revision,change:{...target,version,value:readValue(),...(readSources ? {actionSources:readSources()} : {})}});view='changes';render();message('Change saved as a local draft.');});
  }
  async function confirmCloud(d) {
    let before=d.before,reviewToken;
    {
      message('Reading the current Logitech setting for review…');await mutate('preview',{key:d.key});
      const review=data.cloud.review;if(!review || review.key!==d.key) throw new Error('The cloud review expired. Try reviewing again.');
      before=review.before;reviewToken=review.token;message('');
    }
    const contents=[p(`${d.name} · ${d.label}`),e('p',`Current Logitech value:\n${formatDraftValue(d,before)}`,'proposed-setting'),e('p',`Proposed value:\n${formatDraftValue(d,d.value)}`,'proposed-setting'),note('This saves the setting in your Logitech account. The hub changes after compile and sync. A changed cloud value blocks the save.')];
    if(d.before===null) contents.push(note('The hub did not supply an original value. The cloud value above is what you are replacing.'));
    showEditor('Save this change to Logitech?',contents,'Save to Logitech',async () => {await mutate('apply',{key:d.key,confirm:true,reviewToken});render();message('Saved and read back from Logitech. Compile & sync to update the hub.');});
  }
  $('edit-form').onsubmit = async event => {event.preventDefault();$('submit-editor').disabled=true;try{await editAction();$('editor').close();}catch(error){$('editor-error').textContent=error.message;$('editor-error').hidden=false;if(view==='changes')render();}finally{$('submit-editor').disabled=false;}};
  $('cancel-editor').onclick = $('close-editor').onclick = () => $('editor').close();
  $('close-field-help').onclick = () => $('field-help').close();
  $('hub-label').append(helpButton('Harmony hub',helpText['Harmony hub']));
  function schedulePoll() {
    clearTimeout(timer); if (!data?.busy) return;
    timer = setTimeout(async () => {try{await load();if(!contextDirty && !$('editor').open)render();else updateToolbar();schedulePoll();}catch(error){message(error.message,true);}},2500);
  }
  $('read').onclick = () => readHub().catch(error => message(error.message,true));
  $('hub').onchange = async () => {if(!unsaved()){$('hub').value=data.host;return;}contextDirty=false;try{await load();selectedDevice=selectedActivity=null;render();}catch(error){message(error.message,true);}};
  $('export').onclick = () => {window.location.assign(`/api/export?host=${encodeURIComponent(data.host)}`);};
  for (const n of document.querySelectorAll('[data-view]')) n.onclick = () => navigate(n.dataset.view);
  window.addEventListener('beforeunload',event => {if(contextDirty){event.preventDefault();event.returnValue='';}});
  async function startApp() {
    await load(); $('hub').replaceChildren();
    for(const host of data.hosts){const o=e('option',host);o.value=host;$('hub').append(o);}
    $('hub').value=data.host;document.querySelector('nav').hidden=false;
    $('sign-out').hidden=$('revoke-sessions').hidden=false;
    message('');render();schedulePoll();
  }
  async function showLogin() {
    clearTimeout(timer);data=null;csrf=null;contextDirty=false;
    document.querySelector('nav').hidden=true;$('sign-out').hidden=$('revoke-sessions').hidden=true;
    $('read').disabled=$('export').disabled=$('hub').disabled=true;
    $('hub').replaceChildren();$('snapshot-status').textContent='Sign in to your configurator';
    const card=panel('Welcome back','Use your configurator sign-in details. These are separate from your Logitech account.');$('content').replaceChildren(card);
    try {
      const auth=await api('auth');
      if(!auth.configured){card.append(note('Set a username and password in Homebridge → Harmony Home Control → Settings → Direct website sign-in. You can also use Open configurator in Homebridge.'));return;}
      if(!auth.loginAvailable){card.append(note('Use your HTTPS configurator URL to enter your password.',true));return;}
      const form=e('form'),username=e('input'),password=e('input');
      if(auth.usernameRequired){username.type='text';username.autocomplete='username';username.required=true;username.maxLength=64;field(form,'Configurator username',username);}
      password.type='password';password.autocomplete='current-password';password.required=true;password.maxLength=256;
      field(form,'Configurator password',password);
      const remember=e('input');remember.type='checkbox';const rememberField=field(form,'Remember this browser for 30 days',remember);rememberField.classList.add('checkbox-field');
      const submit=e('button','Sign in','primary');submit.type='submit';form.append(submit);card.append(form);
      form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;const credential=password.value;password.value='';try{({csrf}=await api('auth/login',{username:username.value,password:credential,remember:remember.checked}));await startApp();}catch(error){message(error.message,true);submit.disabled=false;}};
    } catch(error){message(error.message,true);}
  }
  async function signOut(all=false) {
    if(!unsaved() || (all && !window.confirm('Sign out every configurator browser?'))) return;
    try {await api(all?'auth/revoke':'auth/logout',{});await showLogin();message('Signed out.');}
    catch(error){if(error.status===401)await showLogin();else message(error.message,true);}
  }
  $('sign-out').onclick=()=>signOut();$('revoke-sessions').onclick=()=>signOut(true);
  (async () => {
    const access = new URLSearchParams(location.hash.slice(1)).get('access'); if(access) history.replaceState(null,'',location.pathname);
    try {({csrf}=access ? await api('session',{access}) : await api('session'));await startApp();}
    catch(error){await showLogin();if(error.status!==401)message(error.message,true);}
  })();
})();
