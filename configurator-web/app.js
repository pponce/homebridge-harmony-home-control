import { helpText } from './help.js';

(() => {
  const $ = id => document.getElementById(id);
  let data, csrf, view = 'devices', selectedDevice, selectedActivity, contextDirty = false, localBusy = false, timer, editAction;
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
      $('field-help-title').textContent = label;
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
  function panel(title,description) { const n = e('section',undefined,'panel'); if (title) n.append(e('h2',title)); if (description) n.append(e('p',description,'muted')); return n; }
  function details(title,contents) { const n = e('details'); n.append(e('summary',title),contents); return n; }
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
  function heading(title,description) { const n = e('div',undefined,'page-head'), text = e('div'); text.append(e('h1',title),p(description)); n.append(text,badge('Imported + your context')); return n; }
  async function api(path,payload) {
    const response = await fetch(`/api/${path}`,{method:payload ? 'POST' : 'GET',credentials:'same-origin',headers:payload ? {'Content-Type':'application/json','X-Configurator-CSRF':csrf || ''} : {},body:payload ? JSON.stringify(payload) : undefined});
    const result = await response.json(); if (!response.ok) { const error = new Error(result.error || 'The request failed.'); error.status = response.status; throw error; } return result;
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
    $('device-count').textContent = s?.devices.length ?? '—'; $('activity-count').textContent = s?.activities.length ?? '—'; $('suggestion-count').textContent = data.suggestions.length; $('change-count').textContent = data.drafts.filter(d => d.status !== 'hub-confirmed').length;
    for (const n of document.querySelectorAll('[data-view]')) { if (n.dataset.view === view) n.setAttribute('aria-current','page'); else n.removeAttribute('aria-current'); }
    $('snapshot-status').textContent = data.lastError ? `Last read failed: ${data.lastError} Showing the previous import from ${time(s?.readAt)}.` : s ? `Imported from ${s.host} · ${time(s.readAt)}${data.busy ? ' · Operation in progress' : ''}` : 'No hub configuration imported yet.';
    const content = $('content'); content.replaceChildren();
    if (!s) { const empty = e('div',undefined,'empty'); empty.append(e('h1','Get to know your Harmony setup'),p('Read your hub to see its devices, activities, power settings and inputs. Then add the HDMI and CEC details Harmony cannot see.'),button('Read hub',readHub,'primary')); content.append(empty); return; }
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
  function editButton(kind,item,field,label,value,type,role) {
    const b = button('Edit draft',() => openEdit({kind,id:item.id,field,role},label,value,type));
    b.disabled = value == null || data.busy; b.setAttribute('aria-label',`Edit ${label} for ${item.name}`); return b;
  }
  function renderDevices(content,s) {
    content.append(heading('Devices','Inspect the power policy, inputs, delays and commands Harmony has stored for each device.'));
    if (!s.devices.length) { content.append(note('This hub returned an empty device list.')); return; }
    const d = s.devices.find(x => x.id === selectedDevice) || s.devices[0]; selectedDevice = d.id;
    const split = e('div',undefined,'split'), detail = e('div'); split.append(items(s.devices,d.id,id => {selectedDevice = id; render();}),detail); content.append(split);
    const card = panel(), head = e('div',undefined,'panel-head'), title = e('div'); title.append(e('h2',d.name),p([d.manufacturer,d.model].filter(Boolean).join(' · '))); head.append(title,badge('Imported')); card.append(head);
    card.append(table(['Setting','Value'],[['Control transport',d.transportLabel || d.transport || 'Not reported by hub'],['Control port',d.controlPortLabel || d.controlPort || 'Not reported by hub'],['Command repeats',d.repeats],['Power command type',d.power.type === 1 ? 'Separate On / Off' : d.power.type === 2 ? 'Toggle' : d.power.type]]));
    card.append(note('Device power and delay changes can be drafted here. Apply them in the Harmony app, sync, then Read hub to verify.'));
    detail.append(card);
    const power = panel('Power behavior');
    power.append(table(['Setting','Imported',''],[
      ['Harmony skips all power commands',d.power.alwaysOn,editButton('device',d,'power.alwaysOn','Harmony skips all power commands',d.power.alwaysOn,'boolean')],
      ['Keep on between activities',d.power.betweenActivities,editButton('device',d,'power.betweenActivities','Keep on between activities',d.power.betweenActivities,'boolean')]
    ],'settings'));
    power.append(details('Power actions',e('div'))); const actionDetail = power.lastChild.lastChild;
    for (const [label,a] of [['On',d.power.on],['Off',d.power.off],['Toggle',d.power.toggle]]) { actionDetail.append(e('h3',label),actionsTable(a)); }
    detail.append(power);
    const delays = panel('Timing'); const delayFields = [['powerOn','Power-on delay'],['input','Input delay'],['interDevice','Inter-device delay'],['interKey','Inter-key delay']];
    delays.append(table(['Delay','Imported (ms)',''],delayFields.map(([key,label]) => [label,d.delays[key],editButton('device',d,`delays.${key}`,`${label} (ms)`,d.delays[key],key === 'interKey' ? 10000 : 60000)]),'settings')); detail.append(delays);
    const inputs = panel('Inputs'), inputMethod = p(''); inputMethod.append(helpLabel('Input method'),document.createTextNode(`: ${display(d.inputMethod)}`)); inputs.append(inputMethod);
    inputs.append(d.inputs.length ? table(['Order','Input','Commands'],d.inputs.map(i => [i.order,i.name,i.actions.map(a => a.command || a.type).join(', ')])) : p('No inputs supplied by this device profile.'));
    const moreInput = e('div'); for (const [label,a] of Object.entries(d.inputActions)) moreInput.append(e('h3',label),actionsTable(a)); inputs.append(details('Input sequence actions',moreInput)); detail.append(inputs);
    const commands = panel(`${d.commands.length} available commands`), chips = e('div',undefined,'chips'); d.commands.forEach(c => chips.append(e('span',c,'chip'))); commands.append(details('Show command names',chips),e('p','Command names are inspected only; this page does not send them.','muted')); detail.append(commands);
    appendMaps(detail,s.maps.filter(m => m.deviceId === d.id));
    detail.append(e('p',s.coverage,'muted')); if (s.unavailable.length) detail.append(note(`Unavailable resources: ${s.unavailable.join(', ')}.`,true));
  }
  function renderActivities(content,s) {
    content.append(heading('Activities','See which devices participate, their selected inputs, configured power order, and explicit start/end actions.'));
    if (!s.activities.length) { content.append(note('This hub returned an empty activity list.')); return; }
    const a = s.activities.find(x => x.id === selectedActivity) || s.activities[0]; selectedActivity = a.id;
    const split = e('div',undefined,'split'), detail = e('div'); split.append(items(s.activities,a.id,id => {selectedActivity=id; render();}),detail); content.append(split);
    const card = panel(a.name), activityType = p(''); activityType.append(helpLabel('Activity type'),document.createTextNode(`: ${display(a.type)}`)); card.append(activityType);
    card.append(table(['Setting','Imported',''],[['Name',a.name,editButton('activity',a,'name','Activity name',a.name,'text')],['Display order',a.order,editButton('activity',a,'order','Activity display order',a.order,1000)]])); detail.append(card);
    const roles = panel('Power order & inputs','Configured order is not a measured execution trace. Harmony can skip devices already on; CEC and automations can act independently.');
    const orderCell = (r,key,label,max=1000) => { const cell = e('div'); cell.append(e('div',display(r[key]),'value'),editButton('activity',a,key,`${deviceName(r.deviceId)} ${label}`,r[key],max,r.index)); return cell; };
    roles.append(table(['Device / role','Selected input','On order','Off order','Next delay (ms)'],[...a.roles].sort((x,y)=>(x.powerOnOrder ?? 9999)-(y.powerOnOrder ?? 9999)).map(r => { const who = e('div'); who.append(e('strong',deviceName(r.deviceId)),e('div',r.type.split(':')[0],'muted')); return [who,r.input,orderCell(r,'powerOnOrder','power-on order'),orderCell(r,'powerOffOrder','power-off order'),orderCell(r,'nextDeviceDelay','next-device delay',60000)]; })));
    roles.append(note('Use Harmony’s activity setup to change participating devices, selected inputs, or start/end actions. Cloud editing here supports the name, display order, and existing role power-on/off order.')); detail.append(roles);
    for (const [label,actions] of [['Start actions',a.enter],['End actions',a.leave]]) { const card = panel(label); card.append(actionsTable(actions)); detail.append(card); }
    appendMaps(detail,s.maps.filter(m => m.activityId === a.id));
  }
  function appendMaps(parent,maps) {
    const card = panel('Button maps');
    if (!maps.length) card.append(p('No matching button map was supplied. Remote-specific mappings may not be included in the hub resources.'));
    for (const m of maps) { const block = e('div'); block.append(table(['Button','Group','Action'],m.buttons.map(b => [b.key,b.group,`${b.action.command || b.action.type} · ${deviceName(b.action.deviceId)}`]))); for (const s of m.sequences) block.append(e('h3',s.name),actionsTable(s.actions)); card.append(details(`Map ${m.id || 'without ID'}`,block)); }
    parent.append(card);
  }
  const unknown = ['unknown','I’m not sure'];
  const cecHelp = kind => ({tv:'On Samsung, look for Anynet+ (HDMI-CEC) under the external-device settings. Names vary by model.',receiver:'On Anthem, inspect HDMI CEC power, input and standby settings separately. Record exceptions in your automation notes.',ps5:'Check Settings → System → HDMI. Record Device Link, One-Touch Play and Power Off Link separately in the notes.',switch:'Check System Settings → TV Settings / TV Output → Match TV Power State.', 'apple-tv':'Check Settings → Remotes and Devices → Control TVs and Receivers. Confirm the Harmony profile and Bluetooth pairing.'})[kind] || 'Check the device’s HDMI-CEC settings. Harmony cannot read this setting.';
  function renderAssistant(content,s) {
    const formRevision = data.revision;
    content.append(heading('Fill in the missing pieces','Describe the physical wiring and the behavior you want. “I’m not sure” keeps a recommendation conditional until you test it.'));
    const form = e('form'), controls = {}; content.append(form);
    for (const d of s.devices) {
      const a = data.context.devices[d.id] || {}, card = panel(d.name,`${d.manufacturer} ${d.model}`), grid = e('div',undefined,'assistant-grid'); controls[d.id] = {};
      const add = (key,label,options,help) => { const input = select(options,a[key]); controls[d.id][key] = input; return {input,label:field(grid,label,input,help)}; };
      const kind = add('kind','Device type',[unknown,['tv','TV'],['receiver','AV receiver'],['ps5','PlayStation 5'],['switch','Nintendo Switch'],['apple-tv','Apple TV'],['other','Other device']]);
      const dest = add('destination','HDMI output connects to',[unknown,['none','No HDMI output'],...s.devices.filter(x => x.id !== d.id).map(x => [x.id,x.name])]);
      const port = e('input'); port.value = a.port || ''; port.maxLength = 100; port.placeholder = 'e.g. HDMI 2 or Game'; controls[d.id].port = port;
      const portField = field(grid,'Input on that destination',port,'Use the label you see in the TV or receiver’s input menu.');
      const cec = add('cec','HDMI-CEC is',[unknown,['on','Enabled'],['off','Disabled']],cecHelp(a.kind));
      add('wakeBy','Who should wake this device?',[unknown,['harmony','Harmony'],['cec','HDMI-CEC'],['manual','Controller / remote / manual'],['automation','HomeKit or another automation']]);
      add('sleepBy','Who should put it to sleep?',[unknown,['harmony','Harmony'],['cec','HDMI-CEC'],['manual','Controller / remote / manual'],['automation','HomeKit or another automation']]);
      add('switchBehavior','When switching away',[unknown,['keep','Keep it awake'],['sleep','Let it sleep']]);
      add('offBehavior','When I press All Off',[unknown,['keep','Keep it awake'],['sleep','Put it to sleep / standby']]);
      add('coldStart','Cold startup test',[unknown,['works','Works as intended'],['misses-input','Power works; input is missed'],['misses-power','Device does not wake']]);
      add('transition','Switching between activities',[unknown,['works','Works as intended'],['wrong-input','Wrong input'],['unexpected-sleep','A device sleeps unexpectedly']]);
      const update = () => { portField.hidden = ['unknown','none'].includes(dest.input.value); cec.label.querySelector('small').textContent = cecHelp(kind.input.value); };
      kind.input.addEventListener('change',update); dest.input.addEventListener('change',update); update(); card.append(grid); form.append(card);
    }
    const auto = panel('HomeKit & other automations','Include triggers, waits, conditions and actions. Describe any wake/sleep exceptions or individual CEC switches here. These notes are retained for manual review.');
    const notes = e('textarea'); notes.value = data.context.automations || ''; notes.maxLength = 6000; field(auto,'Automation and CEC notes',notes,'For example: Receiver off → wait → check it is still off → send Harmony All Off. Include what should happen if another activity starts during the wait.'); form.append(auto);
    const dock = e('div',undefined,'sticky-actions'), status = e('span','Answers are saved locally.'); const save = e('button','Save answers','primary'); save.type = 'submit'; dock.append(status,save); form.append(dock);
    form.addEventListener('input',() => {contextDirty = true; status.textContent = 'You have unsaved answers.';});
    form.onsubmit = async event => {
      event.preventDefault(); save.disabled = true;
      const context = {devices:{},automations:notes.value};
      for (const [id,fields] of Object.entries(controls)) context.devices[id] = Object.fromEntries(Object.entries(fields).map(([key,input]) => [key,input.value]));
      try { await mutate('context',{context,revision:formRevision}); contextDirty = false; render(); message('Answers saved. Suggestions now use your wiring, power choices and test results.'); }
      catch (error) { message(error.message,true); save.disabled = false; }
    };
  }
  function renderSuggestions(content) {
    content.append(heading('Suggestions for your setup','Each recommendation shows its evidence and a test. No setting changes automatically.'));
    if (!data.suggestions.length) { content.append(note('No rule matched the imported settings and saved answers. Complete the Setup Assistant and record test outcomes; this does not prove the setup is optimal.')); return; }
    const grid = e('div',undefined,'recommendations'); content.append(grid);
    for (const a of data.suggestions) {
      const card = panel(); card.append(e('p',a.device,'device-label'),e('h2',a.title),badge(a.confidence,a.confidence.includes('input') || a.confidence.includes('mismatch')));
      const dl = e('dl'); for (const [label,text] of [['Current / reported',a.current],['Suggested next step',a.proposed],['Why',a.why],['How to test',a.test]]) { const term = e('dt'); term.append(helpLabel(label)); dl.append(term,e('dd',text)); } card.append(dl);
      const actions = e('div',undefined,'actions'); if (a.deviceId) actions.append(button('Inspect device',() => {selectedDevice=a.deviceId; navigate('devices');})); actions.append(button('Update answers',() => navigate('assistant'))); card.append(actions);
      if (a.source) card.append(link('Manufacturer guidance ↗',a.source)); grid.append(card);
    }
  }
  const statusLabels = { draft:'Draft only',saving:'Saving',unconfirmed:'Cloud save unconfirmed',conflict:'Needs a fresh draft','cloud-saved':'Saved to Logitech · sync needed','hub-confirmed':'Confirmed on hub','changed-again':'Hub value changed again','manual-pending':'Waiting for app change + sync' };
  function renderChanges(content) {
    content.append(heading('Review changes','Draft locally, choose where to apply, then read the hub to verify the result. Discarding a draft does not undo an applied setting.'));
    const cloud = panel('Logitech cloud', 'Preview support: activity name, display order, and existing role power-on/off order. Device settings and other fields use guided changes in the Harmony app.');
    const connected = data.cloud.connected && data.cloud.host === data.host;
    if (connected) {
      cloud.append(note('Signed in for this hub. Credentials are held in this session only.'));
      const actions = e('div',undefined,'actions'); actions.append(button('Compile & sync this hub',async () => {await mutate('sync');render();},'primary'),button('Sign out of Logitech',async () => {await mutate('logout');render();})); cloud.append(actions);
    } else if (data.cloud.loginAvailable) {
      const form = e('form',undefined,'cloud-form'), email = e('input'), password = e('input'); email.type = 'email'; email.required = true; email.autocomplete = 'username'; password.type = 'password'; password.required = true; password.autocomplete = 'current-password';
      field(form,'Logitech email',email); field(form,'Logitech password',password);
      const submit = e('button','Sign in','primary'); submit.type = 'submit'; form.append(submit);
      form.onsubmit = async event => {event.preventDefault(); const credentials = {email:email.value,password:password.value}; password.value = ''; submit.disabled = true; try {await mutate('login',credentials);render();message('Logitech account matched to this hub.');} catch (error) {message(error.message,true);submit.disabled=false;} finally {credentials.password='';}};
      cloud.append(form,e('p','Logitech email/password accounts only. Social and legacy logins are not supported.','muted'));
    } else cloud.append(note('Cloud sign-in requires HTTPS or a localhost SSH tunnel. Use an HTTPS reverse proxy, or optionally configure a certificate for the plugin’s webserver. Hub inspection, answers, drafts and manual guidance work on this HTTP connection.',true));
    if (data.sync?.host === data.host) cloud.append(note(`${data.sync.status}: ${data.sync.message}`,data.sync.status === 'failed'));
    content.append(cloud);
    if (!data.drafts.length) { content.append(note('No changes drafted yet. Open a device or activity and choose Edit draft.')); return; }
    for (const d of data.drafts) {
      const card = panel(), head = e('div',undefined,'panel-head'), title = e('div'); title.append(e('h2',`${d.name} · ${d.label}`)); if (d.role !== undefined) title.append(p(`Activity role ${d.role+1}`)); head.append(title,badge(statusLabels[d.status] || d.status,!['draft','hub-confirmed'].includes(d.status))); card.append(head);
      const diff = e('div',undefined,'change-diff'); for (const [label,value] of [['At import',d.before],['Proposed',d.value]]) {const block=e('div');block.append(helpLabel(label),e('strong',display(value)));diff.append(block);} card.append(diff);
      if (d.error) card.append(note(d.error,true));
      if (d.status === 'conflict' || d.status === 'changed-again') card.append(note('Read the hub, inspect the current value and create a new draft. An existing draft is never silently rebased.',true));
      if (d.status === 'unconfirmed') card.append(note('The save may have reached Logitech. Check the activity in Harmony, sync if appropriate, then Read hub. This change will not be replayed automatically.',true));
      const actions = e('div',undefined,'actions');
      if (d.cloud && d.status === 'draft') { const save = button('Review cloud save',() => confirmCloud(d),'primary'); save.disabled = !connected || data.busy; actions.append(save); }
      if (d.status !== 'hub-confirmed') {
        const steps = e('div'); steps.append(p(`In Harmony, open ${d.kind === 'device' ? `Devices → ${d.name} → Change Device Settings` : `Activities → ${d.name} → Customize / Settings`}.`),p(`${d.label}: change ${display(d.before)} to ${display(d.value)}. Sync the hub from Harmony, then return and choose Read hub.`));
        if (d.kind === 'device') steps.append(p(d.field.startsWith('power.') ? 'Use Power Settings. “Always on” means Harmony sends no power commands. Keep-on-between-activities is a different policy.' : 'Use Device Delay Settings. Change one delay at a time and test cold startup, activity switches, and All Off.'));
        steps.append(button('I changed it in Harmony',async () => {await mutate('manual',{key:d.key});render();message('Marked for verification. Sync from Harmony, then Read hub.');})); card.append(details('Apply using the Harmony app',steps));
      }
      actions.append(button('Discard record',async () => {await mutate('discard',{key:d.key});render();})); card.append(actions); content.append(card);
    }
  }
  function showEditor(title,contents,submitLabel,run) {
    $('editor-title').textContent = title; $('editor-fields').replaceChildren(...contents); $('submit-editor').textContent = submitLabel; $('editor-error').hidden = true; editAction = run; $('editor').showModal();
  }
  function openEdit(target,label,before,type) {
    const version = data.snapshot.version, revision = data.revision;
    let input;
    if (type === 'boolean') input = select([['true','Yes'],['false','No']],String(before));
    else {input=e('input');input.type=type==='text'?'text':'number';input.value=before;if(type==='text')input.maxLength=64;else{input.min=0;input.max=type;input.step=1;}input.required=true;}
    const block = e('div');
    const explanation = ({'delays.powerOn':'Power-on delay','delays.input':'Input delay','delays.interDevice':'Inter-device delay','delays.interKey':'Inter-key delay','power.alwaysOn':'Harmony skips all power commands','power.betweenActivities':'Keep on between activities',name:'Name',order:'Display order',powerOnOrder:'On order',powerOffOrder:'Off order',nextDeviceDelay:'Next delay (ms)'})[target.field];
    field(block,'Proposed value',input,helpText[explanation]);
    showEditor(label,[p(`Imported value: ${display(before)}`),block,note('Saving a draft does not change Harmony. Review it in Review changes to choose how to apply it.')],'Save draft',async () => {await mutate('draft',{revision,change:{...target,version,value:type==='boolean'?input.value==='true':type==='text'?input.value:Number(input.value)}});view='changes';render();message('Change saved as a local draft.');});
  }
  function confirmCloud(d) {
    showEditor('Save this change to Logitech?',[p(`${d.name} · ${d.label}`),p(`${display(d.before)} → ${display(d.value)}`),note('This saves the activity in your Logitech account. The hub changes after compile and sync. Other fields are preserved; a changed cloud value blocks the save.')],'Save to Logitech',async () => {await mutate('apply',{key:d.key,confirm:true});render();message('Saved and read back from Logitech. Compile & sync to update the hub.');});
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
