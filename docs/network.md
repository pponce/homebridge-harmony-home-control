# Network and separate VLANs

[← Back to Harmony Home Control](../README.md) · [Setup guide](setup.md) · [Troubleshooting](troubleshooting.md)

| Purpose | Default | Required reachability |
| --- | --- | --- |
| Hue HTTP | TCP 18080 | Harmony hub and pairing phone to Homebridge |
| Roku HTTP | TCP 8060 | Harmony hub to Homebridge |
| Discovery | UDP 1900, multicast 239.255.255.250 | Harmony discovery network |
| Homebridge accessory access | Existing HAP ports and mDNS | This plugin to main/child bridges |
| Real Hue control | TCP 443 | Homebridge to each physical Hue bridge |
| Real Hue identification/discovery | TCP 80/443, mDNS UDP 5353 | Homebridge to physical bridges; manual IPv4 setup is available |

Port 18080 avoids conflicts with existing HTTP servers. Harmony behavior on this port still needs hardware verification. If a hub requires port 80, configure an available listener/forwarder; do not run all of Homebridge as root simply to bind a privileged port. Keep the address and ports stable after pairing.

SSDP discovery is different from mDNS. A router’s mDNS reflector alone does not relay Hue/Roku discovery. With separate VLANs, use an existing SSDP relay or run the included discovery helper on a machine with an interface in the Harmony VLAN. The helper only advertises the actual Homebridge endpoints; action traffic still goes directly to Homebridge. It requires Node.js 22.13+ but no npm dependencies.

Example helper command using documentation-only addresses (replace all three; the interface address must belong to the helper machine):

```text
node bin/advertise.js --host=192.0.2.20 --interface=198.51.100.20 --hub=198.51.100.50 --hue-port=18080 --roku-port=8060
```

Use `--hue-port=0` or `--roku-port=0` to advertise only one protocol. Keep the helper available if the hub needs to rediscover after a restart. No router configuration is changed by the plugin or helper. For containers, host networking is recommended.

The Hue/Roku interfaces use local HTTP because these legacy control protocols require it. Device descriptors and basic Hue bridge information are public for discovery. During the two-minute pairing window, clients that can reach the Hue API may register for a key. Hue resource reads require a paired key; Hue writes additionally require a configured hub address. Roku control remains restricted to configured hubs. Discovery replies are not restricted to the hub-IP list. IP filtering assumes a trusted LAN and does not authenticate a compromised host using an allowed address. The UI’s control channel binds only to loopback and uses a random token stored with owner-only permissions. Do not expose these ports on the Internet.
