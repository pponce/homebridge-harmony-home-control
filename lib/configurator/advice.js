import { connectionsFor, pathsFor, methodsFor } from '../../configurator-web/settings.js';
const support = 'https://support.myharmony.com/en-us/';
export const guides = {
  power: `${support}changing-when-a-device-powers-on-or-off`,
  delay: `${support}adjusting-a-devices-power-on-delay`,
  input: `${support}adjusting-a-devices-input-delay`,
  order: `${support}change-the-power-on-order-of-your-devices`,
  apple: `${support}harmony-experience-with-apple-tv`,
  switch: 'https://www.nintendo.com/sg/support/qa/detail/34225',
};
export function suggestions(snapshot, context = {}) {
  if (!snapshot) return [];
  const result = [], answers = context.devices || {};
  const add = (device, code, title, current, proposed, why, test, source, confidence = 'Based on your answers') => result.push({ id: `${device.id}/${code}`, deviceId: device.id, device: device.name, title, current, proposed, why, test, source, confidence });
  for (const d of snapshot.devices) {
    const a = answers[d.id] || {};
    const has = (direction,method) => a[direction === 'wake' ? 'wakeBy' : 'sleepBy'] === method || pathsFor(a).some(p => p.direction === direction && p.method === method);
    const available = (direction,method) => methodsFor(a,direction).includes(method) || has(direction,method);
    const knownPath = direction => ['harmony','cec','manual','automation'].some(method => available(direction,method));
    if (!a.kind || a.kind === 'unknown' || !knownPath('wake') || !knownPath('sleep')) {
      add(d,'questions','Describe the wake and sleep paths','Wake or sleep behavior is not confirmed.','Complete this device’s Setup Assistant answers.','Harmony cannot read the CEC settings inside the device. Multiple controllers can be valid; their triggers matter.','Record what happens when you start an activity, switch activities, and press All Off.',guides.power,'Needs your input');
    }
    if (has('wake','harmony') && d.power.alwaysOn === true) add(d,'always','Harmony is configured to skip power commands','Harmony “always on” is enabled.','If Harmony should send power commands, change the device’s power policy in Harmony.','“Always on” means Harmony does not send on or off commands; it does not guarantee the device is awake.','Start from standby and confirm that the device wakes; then test All Off.',guides.power);
    if (a.cec === 'off' && (available('wake','cec') || available('sleep','cec'))) add(d,'cec-off','The chosen CEC path is disabled','You reported CEC off and listed it as a wake or sleep method.','Enable the needed CEC functions, or update the recorded wake/sleep paths.','CEC requires support and compatible settings along the HDMI path.','Test the intended direction separately: source → TV and TV → source are different behaviors.',guides.power);
    for (const direction of ['wake','sleep']) {
      const preferred=a[direction === 'wake' ? 'wakeBy' : 'sleepBy'];
      if (preferred && preferred !== 'unknown' && !methodsFor(a,direction).includes(preferred)) add(d,`preferred-${direction}`,'Check the preferred power method',`The preferred ${direction} method is not selected as available.`,`Confirm the method can ${direction} this device, or choose another preferred method.`,'Available methods describe capability; the preferred method describes how you want activities to behave.','Test the selected method, then update the method checkboxes and preferred choice.',guides.power,'Needs your input');
    }
    if (has('wake','cec') && d.power.alwaysOn === false && (d.power.on.length || d.power.toggle.length)) add(d,'two-owners','Review overlapping wake commands','Harmony has power actions and you recorded CEC for wake.','Review when each controller sends a command. Multiple paths can work if their commands and triggers agree.','A toggle sent after a CEC wake can turn a device back off. Discrete On commands are less ambiguous.','Start from standby, then start the same activity while the device is already awake.',guides.power);
    for (const direction of ['wake','sleep']) {
      const paths=pathsFor(a).filter(path => path.direction === direction);
      const methods=new Set(paths.map(path => path.method));
      const preferred=a[direction === 'wake' ? 'wakeBy' : 'sleepBy'];
      if (preferred && preferred !== 'unknown') methods.add(preferred);
      if ((paths.length > 1 || methods.size > 1) && has(direction,'harmony') && d.power.alwaysOn !== true && (d.power.type === 2 || d.power.toggle.length)) add(d,`toggle-${direction}`,'Review a power toggle with multiple controllers',`A Harmony power toggle and multiple ${direction} paths are recorded.`,'Check that the triggers cannot send competing power commands; use separate On/Off commands if the device supports them.','A toggle can reverse a power state already changed by CEC, HomeKit or another controller. Capability checkboxes alone do not mean these commands run together.','Test each recorded trigger separately and then the activity startup or All Off sequence.',guides.power,'Possible overlapping commands');
    }
    if (a.switchBehavior === 'keep' && d.power.alwaysOn === false && d.power.betweenActivities === false) add(d,'keep','Keep this device on while switching','Harmony is not set to keep it on between activities.','Review “keep on when switching activities” in Harmony.','A device no longer needed by the next activity may otherwise be powered off. All Off remains a separate choice.','Switch from an activity using this device to one that does not; then test All Off.',guides.power);
    if (a.offBehavior === 'keep' && has('sleep','cec') && a.cec === 'on') add(d,'cec-sleep','Check TV-off behavior','You want this device to stay awake after All Off and use CEC for sleep.','Check whether the device’s TV-off link can be disabled separately.','The TV turning off may trigger sleep even when Harmony sends no power command.','Leave a safe, idle task running, turn the TV off, and observe the source.',guides.power);
    if (a.coldStart === 'misses-input') add(d,'warmup','Measure readiness before increasing delays',`Imported power-on delay: ${d.delays.powerOn ?? 'unavailable'} ms.`, 'Measure how long the device needs before it accepts its input command. Adjust power-on delay only if that matches the failure.','Power-on delay handles startup readiness; input delay handles successive input changes. HDMI handshakes may add time outside Harmony’s model.','Compare a cold start with an input switch while already on. Change one setting and repeat both tests.',guides.delay,'Based on a reported failure');
    if (a.transition === 'wrong-input') add(d,'input','Investigate the last input change','You reported the wrong input after an activity switch.','Compare the activity’s selected inputs with the wiring below, then check whether a source asserts its CEC active input later.','A larger pause will not fix two controllers choosing different inputs.','Switch between each source pair and note whether the correct input appears before changing again.',guides.input,'Based on a reported failure');
    if (a.kind === 'switch') add(d,'switch','Treat Switch wake and TV wake separately','Nintendo Switch selected in Setup Assistant.','Use the controller or console to wake Switch unless you have tested another route. Use Match TV Power State only for the directions you want.','Nintendo documents that waking a docked Switch can turn on the TV; that does not establish that turning on the TV wakes Switch.','Test console wake → TV on, TV on → console wake, and TV off → console sleep separately.',guides.switch);
    if (a.kind === 'apple-tv') add(d,'apple','Check the Apple TV device profile',`${d.manufacturer} ${d.model} · ${d.transport || 'transport not supplied'}`,'Inspect the available wake/sleep commands and pairing before treating Apple TV as having no power control.','Harmony documents a Bluetooth Apple TV profile. Availability depends on the profile and pairing; a CEC sleep can also affect the TV or receiver.','Test wake and sleep with the selected profile, then switch away without sleeping and finish with All Off.',guides.apple);
    if (a.kind === 'ps5') add(d,'ps5','Confirm PS5 wake and rest behavior','PS5 selected in Setup Assistant.','Record HDMI Device Link, One-Touch Play and Power Off Link separately in your notes, and test the chosen wake route.','A Harmony device label does not prove it can wake PS5. TV power and console rest behavior need separate checks.','From rest, test your chosen wake route. Then switch activities and test TV off while the console is idle.',null,'Needs device-side testing');
    for (const [index,cable] of connectionsFor(a).entries()) {
      if (['unknown','none'].includes(cable.destination)) continue;
      const destination = snapshot.devices.find(x => x.id === cable.destination);
      for (const activity of snapshot.activities.filter(x => x.roles.some(r => r.deviceId === d.id))) {
        const role = activity.roles.find(r => r.deviceId === cable.destination && r.input);
        if (role && cable.port && role.input.toLowerCase().replace(/\s/g,'') !== cable.port.toLowerCase().replace(/\s/g,'')) add(d,`wiring-${activity.id}-${index}`,'Compare the activity input with your wiring',`${activity.name}: ${destination?.name} selects ${role.input}; ${cable.outputPort || 'this HDMI output'} connects to ${cable.port}.`,'Confirm these are names for the same physical input, or update the activity in Harmony.','Input labels may be renamed, so this is a possible mismatch rather than a confirmed error.','Start this activity and verify picture and sound reach the intended source.',guides.input,'Possible mismatch');
      }
    }
  }
  if (context.automations?.trim()) result.push({ id:'automations', title:'Review automation ownership',device:'Whole setup',current:'You recorded external automations.',proposed:'Check each automation’s trigger, delay, guard condition and resulting power/input command.',why:'A delayed automation can race an activity switch. The configurator records these notes but does not execute or automatically understand them.',test:'Test All Off and quickly starting another activity during the delay; verify the guard condition prevents an unwanted shutdown.',confidence:'Manual review needed',source:null });
  return result;
}
