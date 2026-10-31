/* global homebridge */
(() => {
  const $ = id => document.getElementById(id);
  const keys = ['Home','Rev','Fwd','Play','Select','Left','Right','Down','Up','Back','InstantReplay','Info','BackSpace','Search','Enter'];
  const defaults = { platform: 'HarmonyHomeControl', name: 'Harmony Home Control', advertiseAddress: '', harmonyHubAddresses: [], hueEnabled: true, huePort: 18080, rokuEnabled: true, rokuPort: 8060, hueDevices: [], rokuButtons: [] };
  let config, services = [], bootstrap, runtime, configValid = false, latestHash, changeNumber = 0, saveQueue = Promise.resolve(), editorOpen = false, lastEditor;
  const numeric = c => ['int','uint8','uint16','uint32','uint64','float'].includes(c?.format);
  const readable = name => name.replace(/([a-z])([A-Z])/g, '$1 $2');
  const short = value => value === true ? 'On' : value === false ? 'Off' : value === null ? 'No action' : String(value);
  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2,'0')).join('');
  const nameOf = id => services.find(s => s.id === id)?.name || 'Unavailable accessory';
  const errorText = error => error?.message || error?.error?.message || String(error);
  function notice(message, error = false) { const element = $(error ? 'validation' : 'notice'); element.textContent = message; element.hidden = !message; }
  function element(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
  function button(text, run, className = 'btn btn-outline-primary') { const e = element('button',text,className); e.type = 'button'; e.onclick = () => Promise.resolve(run(e)).catch(error => notice(errorText(error),true)); return e; }
  function option(select, value, label) { const e = element('option',label); e.value = value; select.append(e); }
  function field(parent, title, input, help) { const label = element('label',title); input.setAttribute('aria-label',title); label.append(input); if (help) label.append(element('small',help)); parent.append(label); return label; }
  function select() { const input = element('select',undefined,'form-control'); return input; }
  function textInput(value = '', type = 'text') { const input = element('input',undefined,'form-control'); input.type = type; input.value = value; return input; }
  function valueInput(c, value) {
    let input;
    if (c.format === 'bool' || c.validValues?.length) {
      input = select(); const values = c.format === 'bool' ? [true,false] : c.validValues;
      const labels = { TargetDoorState: ['Open','Closed'], LockTargetState: ['Unsecured','Secured'], Active: ['Inactive','Active'], TargetHeatingCoolingState: ['Off','Heat','Cool','Auto'] }[c.type];
      for (const v of values) option(input,JSON.stringify(v),labels?.[v] ? `${labels[v]} (${v})` : short(v));
      input.value = JSON.stringify(value ?? values[0]); if (input.selectedIndex < 0) input.selectedIndex = 0;
      input.readValue = () => JSON.parse(input.value);
    } else {
      input = textInput(value ?? (numeric(c) ? c.minValue ?? 0 : ''), numeric(c) ? 'number' : 'text');
      if (numeric(c)) { if (c.minValue !== undefined) input.min = c.minValue; if (c.maxValue !== undefined) input.max = c.maxValue; input.step = c.minStep ?? (c.format === 'float' ? 'any' : 1); }
      input.readValue = () => numeric(c) ? (input.value.trim() === '' ? NaN : Number(input.value)) : input.value;
    }
    input.required = true; return input;
  }
  function tab(name) {
    for (const e of document.querySelectorAll('[data-tab]')) { if (e.dataset.tab === name) e.setAttribute('aria-current','page'); else e.removeAttribute('aria-current'); }
    for (const n of ['connection','hue','roku','pair']) $(`panel-${n}`).hidden = n !== name;
    if (name === 'pair') void refreshStatus();
  }
  function changed() {
    const sequence = ++changeNumber;
    configValid = false; $('save').disabled = true; homebridge.disableSaveButton();
    $('restart-note').hidden = false;
    const snapshot = structuredClone(config);
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      try {
        const result = await homebridge.request('/validate', snapshot);
        if (sequence !== changeNumber) return;
        await homebridge.updatePluginConfig([snapshot]); latestHash = result.hash;
        configValid = true; notice('',true); $('save').disabled = editorOpen; if (!editorOpen) homebridge.enableSaveButton();
      } catch (error) { if (sequence === changeNumber) notice(errorText(error),true); }
    });
    return saveQueue;
  }
  async function save() {
    await changed(); if (!configValid || editorOpen) return;
    await homebridge.savePluginConfig(); notice('Settings saved. Restart this plugin’s bridge, then open Connect Harmony.');
    await refreshStatus();
  }
  async function discover() {
    $('refresh').disabled = true; $('refresh').textContent = 'Finding accessories…';
    try {
      const result = await homebridge.request('/discover'); services = result.services;
      $('discovery-status').textContent = services.length ? `${services.length} controllable accessory services found. Choose a button section to create a mapping.` : 'No controllable accessories found yet. Check accessory control below, wait a few seconds, then try again.';
      $('access-help').hidden = services.length > 0;
      if (result.error) { $('access-help').hidden = false; notice(result.error,true); }
      renderMappings();
    } catch (error) { notice(errorText(error),true); $('access-help').hidden = false; }
    finally { $('refresh').disabled = false; $('refresh').textContent = 'Refresh accessories'; }
  }
  async function test(action, buttonElement) {
    const original = buttonElement.textContent; buttonElement.disabled = true; buttonElement.textContent = 'Sending…';
    try { await homebridge.request('/test', { action }); notice('Command accepted by the accessory. Check the device to confirm the result.'); notice('',true); }
    finally { buttonElement.disabled = false; buttonElement.textContent = original; }
  }
  function renderMappings() {
    for (const kind of ['hue','roku']) {
      const items = config[kind === 'hue' ? 'hueDevices' : 'rokuButtons']; const list = $(`${kind}-list`); list.replaceChildren();
      if (!items.length) list.append(element('div',kind === 'hue' ? 'No accessories exposed yet. Choose “Expose an accessory” to begin.' : 'No button actions yet. Choose “Add a button action” to begin.','empty'));
      for (const item of items) {
        const card = element('article',undefined,'mapping-card'); const head = element('div',undefined,'mapping-head'); head.append(element('h4',item.name));
        if (kind === 'roku') head.append(element('span',item.key,'badge-status')); card.append(head);
        const serviceId = kind === 'hue' ? item.serviceId : item.action.serviceId;
        card.append(element('p',kind === 'hue' ? `${nameOf(serviceId)} · On: ${short(item.power.onValue)} · Off: ${short(item.power.offValue)}${item.brightness ? ' · Dimming enabled' : ''}` : `${nameOf(serviceId)} · ${readable(item.action.operation)}${item.action.operation !== 'toggle' ? ` ${short(item.action.value)}` : ''}`,'route'));
        const actions = element('div',undefined,'row-actions');
        if (kind === 'hue') {
          actions.append(button('Test on', e => test({ serviceId: item.serviceId, characteristic: item.power.characteristic, operation: 'set', value: item.power.onValue },e)));
          if (item.power.offValue !== null) actions.append(button('Test off', e => test({ serviceId: item.serviceId, characteristic: item.power.characteristic, operation: 'set', value: item.power.offValue },e)));
        } else actions.append(button('Test action', e => test(item.action,e)));
        actions.append(button('Edit', () => edit(kind,item)),button('Remove', () => { config[kind === 'hue' ? 'hueDevices' : 'rokuButtons'] = items.filter(i => i.id !== item.id); renderMappings(); return changed(); },'btn btn-outline-secondary'));
        card.append(actions, element('small','Tests send a real command to this accessory.','muted')); list.append(card);
      }
    }
  }
  async function edit(kind, original) {
    if (!services.length) { await discover(); if (!services.length) { tab('connection'); return; } }
    if (lastEditor) lastEditor.hidden = true;
    const container = $(`${kind}-editor`); lastEditor = container; container.hidden = false; container.replaceChildren(); editorOpen = true;
    homebridge.disableSaveButton(); $('save').disabled = true;
    const form = element('form'); container.append(form); form.append(element('h4', original ? 'Edit mapping' : kind === 'hue' ? 'Expose an accessory' : 'Add a button action'));
    const name = textInput(original?.name || ''); name.required = true; name.maxLength = 64;
    field(form,'Name shown in your mappings',name);
    const filter = textInput(''); filter.placeholder = 'Search accessories'; field(form,'Find an accessory',filter);
    const serviceSelect = select(); field(form,'Accessory',serviceSelect);
    const controls = element('div'); form.append(controls); let buildMapping;
    let selectedId = kind === 'hue' ? original?.serviceId : original?.action.serviceId;
    function fillServices() {
      const old = serviceSelect.value || selectedId; serviceSelect.replaceChildren(); option(serviceSelect,'','Choose an accessory');
      for (const s of services.filter(s => `${s.name} ${s.type} ${s.bridgeName || ''}`.toLowerCase().includes(filter.value.toLowerCase()) || s.id === old)) option(serviceSelect,s.id,`${s.name} · ${readable(s.type)} · ${s.bridgeName || s.bridge.slice(-5)}${s.reachable ? '' : ' · unavailable'}`);
      serviceSelect.value = old || '';
    }
    fillServices(); filter.oninput = fillServices;
    function drawControls(useOriginal) {
      controls.replaceChildren(); buildMapping = null;
      const service = services.find(s => s.id === serviceSelect.value); if (!service) return;
      if (!name.value) name.value = service.name;
      const writable = service.characteristics.filter(c => c.canWrite); const chosen = select();
      for (const c of writable) option(chosen,c.id,readable(c.type));
      const preferred = kind === 'hue' ? original?.power.characteristic : original?.action.characteristic;
      chosen.value = (useOriginal && preferred && writable.some(c => c.id === preferred)) ? preferred : (writable.find(c => ['On','Active'].includes(c.type)) || writable[0]).id;
      field(controls,kind === 'hue' ? 'Control for On and Off' : 'Accessory control',chosen);
      const detail = element('div'); controls.append(detail);
      function drawValues(useSaved) {
        detail.replaceChildren(); const c = writable.find(c => c.id === chosen.value);
        const saved = useSaved ? original : null;
        const defaultOn = c.format === 'bool' ? true : c.type === 'TargetDoorState' ? 0 : c.validValues?.includes(1) ? 1 : c.minValue === 0 && c.maxValue >= 1 ? 1 : c.validValues?.[0] ?? c.minValue ?? 1;
        const defaultOff = c.format === 'bool' ? false : c.type === 'TargetDoorState' ? 1 : c.validValues?.includes(0) ? 0 : c.validValues?.[1] ?? c.minValue ?? 0;
        if (kind === 'hue') {
          const grid = element('div',undefined,'form-grid'); detail.append(grid);
          const on = valueInput(c,saved?.power.onValue ?? defaultOn), off = valueInput(c,saved?.power.offValue ?? defaultOff);
          field(grid,'Short press · On value',on); const offLabel = field(grid,'Long press · Off value',off);
          const ignore = document.createElement('input'); ignore.type = 'checkbox'; ignore.checked = saved?.power.offValue === null;
          const ignoreLabel = element('label',undefined,'check-label'); ignoreLabel.append(ignore,document.createTextNode('Do nothing on a long press')); detail.append(ignoreLabel);
          const updateOff = () => { off.disabled = ignore.checked; offLabel.style.opacity = ignore.checked ? '.5' : '1'; }; ignore.onchange = updateOff; updateOff();
          const dim = select(); option(dim,'','No dimming');
          for (const item of writable.filter(item => item.id !== c.id && numeric(item))) option(dim,item.id,readable(item.type));
          dim.value = saved?.brightness?.characteristic || writable.find(item => item.type === 'Brightness' && item.id !== c.id)?.id || '';
          field(detail,'Dimming rocker',dim,'Optional: brightness, fan speed, or another numeric control.');
          const range = element('div',undefined,'form-grid'); detail.append(range); const min = textInput(0,'number'), max = textInput(100,'number'); min.step = max.step = 'any';
          field(range,'Lowest value',min); field(range,'Highest value',max);
          const updateRange = initial => { const ch = writable.find(item => item.id === dim.value); range.hidden = !ch; min.required = max.required = !!ch; if (ch) { min.value = initial ? saved?.brightness?.min ?? ch.minValue ?? 0 : ch.minValue ?? 0; max.value = initial ? saved?.brightness?.max ?? ch.maxValue ?? 100 : ch.maxValue ?? 100; } }; dim.onchange = () => updateRange(false); updateRange(true);
          buildMapping = () => ({ id: original?.id || newId(), name: name.value.trim(), serviceId: service.id, power: { characteristic: c.id, onValue: on.readValue(), offValue: ignore.checked ? null : off.readValue() }, ...(dim.value ? { brightness: { characteristic: dim.value, min: Number(min.value), max: Number(max.value) } } : {}) });
        } else {
          const key = select(); for (const keyName of keys) if (keyName === original?.key || !config.rokuButtons.some(b => b.key === keyName)) option(key,keyName,keyName);
          key.value = saved?.key || (Array.from(key.options).some(o => o.value === 'Play') ? 'Play' : key.options[0]?.value || ''); field(detail,'Roku command to assign in Harmony',key);
          const operation = select(); option(operation,'set','Set a value');
          if (c.canRead && (c.format === 'bool' || c.minValue === 0 && c.maxValue === 1 || c.validValues?.length === 2 && c.validValues.includes(0) && c.validValues.includes(1))) option(operation,'toggle','Toggle on/off');
          if (c.canRead && numeric(c)) { option(operation,'increase','Increase'); option(operation,'decrease','Decrease'); }
          operation.value = saved?.action.operation || 'set'; if (!operation.value) operation.value = 'set'; field(detail,'Action',operation);
          const holder = element('div'); detail.append(holder); let value;
          function drawActionValue(initial) {
            holder.replaceChildren(); value = null;
            if (operation.value === 'set') { value = valueInput(c,initial ? saved?.action.value ?? defaultOn : defaultOn); field(holder,'Value',value); }
            if (['increase','decrease'].includes(operation.value)) { value = textInput(initial ? saved?.action.value ?? 10 : 10,'number'); value.min = '0.000001'; value.step = 'any'; value.required = true; value.readValue = () => Number(value.value); field(holder,'Amount per press',value); }
          }
          operation.onchange = () => drawActionValue(false); drawActionValue(true);
          buildMapping = () => ({ id: original?.id || newId(), name: name.value.trim(), key: key.value, action: { serviceId: service.id, characteristic: c.id, operation: operation.value, ...(value ? { value: value.readValue() } : {}) } });
        }
      }
      chosen.onchange = () => drawValues(false); drawValues(useOriginal);
    }
    serviceSelect.onchange = () => drawControls(false); drawControls(true);
    const actions = element('div',undefined,'row-actions'); const submit = element('button',original ? 'Update mapping' : 'Add mapping','btn btn-primary'); submit.type = 'submit';
    const closeEditor = () => { container.hidden = true; editorOpen = false; lastEditor = null; if (configValid) { $('save').disabled = false; homebridge.enableSaveButton(); } };
    actions.append(submit,button('Cancel',closeEditor,'btn btn-outline-secondary')); form.append(actions);
    form.onsubmit = async event => {
      event.preventDefault(); if (!buildMapping) { notice('Choose an accessory first.',true); return; }
      const mapping = buildMapping(), property = kind === 'hue' ? 'hueDevices' : 'rokuButtons';
      const next = structuredClone(config); const position = next[property].findIndex(item => item.id === mapping.id); if (position < 0) next[property].push(mapping); else next[property][position] = mapping;
      try { await homebridge.request('/validate',next); config = next; closeEditor(); renderMappings(); await changed(); notice('Mapping added to your draft. Test it below, then save settings and restart the plugin.'); }
      catch (error) { notice(errorText(error),true); }
    };
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); name.focus();
  }
  async function refreshStatus() {
    try {
      runtime = await homebridge.request('/status');
      $('runtime-badge').textContent = !runtime.running ? 'Setup required' : runtime.errors?.length ? 'Needs attention' : 'Proxy running';
      $('status-details').replaceChildren();
      if (!runtime.running) $('status-details').textContent = runtime.message;
      else {
        for (const text of [`Hue: ${runtime.hue}`,`Roku: ${runtime.roku}`,`Discovery: ${runtime.discovery}`, ...(runtime.errors || [])]) $('status-details').append(element('div',text));
        if (latestHash && latestHash !== runtime.configHash) $('status-details').append(element('strong','The running configuration differs from your draft. Save and restart before pairing.'));
      }
      $('pair').disabled = !runtime.running || !runtime.hue?.startsWith('Listening') || latestHash !== runtime.configHash;
      const remaining = Math.max(0,Math.ceil(((runtime.pairingUntil || 0) - Date.now())/1000));
      $('pair-status').textContent = remaining ? `Pairing window open · ${remaining}s remaining` : runtime.pairedClients ? `${runtime.pairedClients} Hue client(s) linked` : 'Pairing window closed';
      $('events').replaceChildren();
      if (!runtime.events?.length) $('events').append(element('p','No remote commands received yet.','muted'));
      for (const event of runtime.events || []) { const row = element('div',undefined,'event'); const time = element('time',new Date(event.time).toLocaleTimeString()); time.dateTime = event.time; row.append(time,element('span',`${event.ok ? '✓' : '!'} ${event.source.toUpperCase()} · ${event.name}${event.message ? ` — ${event.message}` : ''}`)); $('events').append(row); }
    } catch (error) { notice(errorText(error),true); }
  }
  async function initialize() {
    try {
      const blocks = await homebridge.getPluginConfig(); config = { ...defaults, ...(blocks[0] || {}) };
      bootstrap = await homebridge.request('/bootstrap');
      for (const item of bootstrap.addresses) option($('address'),item.address,`${item.address} · ${item.name}`);
      if (config.advertiseAddress && !bootstrap.addresses.some(a => a.address === config.advertiseAddress)) option($('address'),config.advertiseAddress,`${config.advertiseAddress} · saved address (not found locally)`);
      $('address').value = config.advertiseAddress; $('hubs').value = config.harmonyHubAddresses.join(', ');
      for (const kind of ['hue','roku']) { $(`${kind}-enabled`).checked = config[`${kind}Enabled`]; $(`${kind}-port`).value = config[`${kind}Port`]; }
      for (const id of ['address','hubs','hue-enabled','roku-enabled','hue-port','roku-port']) $(id).addEventListener('change',() => {
        config.advertiseAddress = $('address').value; config.harmonyHubAddresses = $('hubs').value.split(/[\s,]+/).filter(Boolean);
        for (const kind of ['hue','roku']) { config[`${kind}Enabled`] = $(`${kind}-enabled`).checked; config[`${kind}Port`] = Number($(`${kind}-port`).value); }
        void changed();
      });
      if (bootstrap.huePlatforms.length) {
        $('hue-warning').hidden = false;
        const automatic = bootstrap.huePlatforms.some(p => !p.hosts.length);
        $('hue-warning').textContent = automatic ? 'Homebridge Hue is using automatic bridge discovery. In that plugin’s Bridges setting, list only your existing Hue bridges/deCONZ gateways so it ignores this emulator. Keep its other settings.' : 'Homebridge Hue already has an explicit bridge list. Keep the emulated bridge out of that list to avoid duplicate accessories.';
      }
      document.querySelectorAll('[data-tab]').forEach(e => e.onclick = () => tab(e.dataset.tab));
      $('save').onclick = () => save().catch(error => notice(errorText(error),true)); $('refresh').onclick = discover;
      $('add-hue').onclick = () => edit('hue').catch(error => notice(errorText(error),true)); $('add-roku').onclick = () => edit('roku').catch(error => notice(errorText(error),true));
      $('refresh-status').onclick = refreshStatus;
      $('pair').onclick = async () => { try { await homebridge.request('/pair'); notice('Pairing is open. Continue adding Philips Hue in Harmony.'); await refreshStatus(); } catch(error) { notice(errorText(error),true); } };
      renderMappings(); await changed(); $('restart-note').hidden = true; await refreshStatus();
      setInterval(() => { if (!document.hidden && !$('panel-pair').hidden) void refreshStatus(); },5000);
    } catch (error) { notice(errorText(error),true); }
  }
  void initialize();
})();
