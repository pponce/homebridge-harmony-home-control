#!/usr/bin/env node
import { isIP } from 'node:net';
import { Discovery, hueAdvertisements, rokuAdvertisements } from '../lib/ssdp.js';

const options = Object.fromEntries(process.argv.slice(2).map(arg => { const at = arg.indexOf('='); return [arg.slice(0,at),arg.slice(at+1)]; }));
if (!['--host','--interface','--hub'].every(key => isIP(options[key]) === 4)) {
  console.error('Usage: node bin/advertise.js --host=HOMEBRIDGE_IP --interface=LOCAL_IP_ON_HARMONY_VLAN --hub=HARMONY_IP [--hue-port=18080] [--roku-port=8060]');
  console.error('Run on a machine connected to the Harmony VLAN. Use --hue-port=0 or --roku-port=0 to disable that advertisement.');
  process.exitCode = 1;
} else {
  let discovery;
  try {
    const advertisements = [];
    async function description(port,path) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1–65535, or 0 to disable.');
      const result = await fetch(`http://${options['--host']}:${port}${path}`,{ signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!result.ok) throw new Error(`Descriptor returned HTTP ${result.status}.`);
      return result.text();
    }
    const huePort = Number(options['--hue-port'] ?? 18080), rokuPort = Number(options['--roku-port'] ?? 8060);
    if (huePort) {
      const text = await description(huePort,'/description.xml');
      const uuid = text.match(/<UDN>uuid:([^<]+)<\/UDN>/)?.[1], serial = text.match(/<serialNumber>([a-f0-9]{12})<\/serialNumber>/)?.[1];
      if (!uuid || !serial) throw new Error('Could not read the Hue emulator identity.');
      const bridgeId = `${serial.slice(0,6)}fffe${serial.slice(6)}`.toUpperCase();
      advertisements.push(...hueAdvertisements({ address: options['--host'], port: huePort, uuid, bridgeId }));
    }
    if (rokuPort) {
      const text = await description(rokuPort,'/'); const serial = text.match(/<serialNumber>(HHC[A-F0-9]+)<\/serialNumber>/)?.[1];
      if (!serial) throw new Error('Could not read the Roku emulator identity.');
      advertisements.push(...rokuAdvertisements({ address: options['--host'], port: rokuPort, serial }));
    }
    discovery = new Discovery({ interfaceAddress: options['--interface'], hubs: [options['--hub']], advertisements }); await discovery.start();
    console.log('Discovery helper running. Commands go directly from Harmony to Homebridge. Press Ctrl+C to stop.');
    for (const event of ['SIGINT','SIGTERM']) process.on(event,() => discovery.close());
  } catch (error) { discovery?.close(); console.error(error.message); process.exitCode = 1; }
}
