# Troubleshooting

[← Back to Harmony Home Control](../README.md) · [Setup guide](setup.md) · [Network guide](network.md)

Start with the symptom below. The plugin settings also show connection status and recent commands.

- **No accessories:** verify Homebridge accessory control and the UI’s Accessories page; refresh after child bridges finish starting. Different child-bridge PINs are read automatically from their `_bridge` configuration. Check mDNS reachability if the plugin runs in a separate container.
- **Real Hue bridge not discovered:** enter its IPv4 address from the Hue app and press its physical link button. Check Homebridge-to-Hue HTTPS reachability. Across VLANs, automatic discovery may be unavailable even when direct control works.
- **Hue authorization refused:** reconnect that physical bridge in this plugin’s settings, press its physical button if prompted, and refresh accessories. Then save and restart the plugin. Keep `hue-bridges.json` readable by the Homebridge service account.
- **A different bridge is at the address:** correct the saved address using **Reconnect / change address**. The plugin deliberately does not reassign existing mappings to another bridge.
- **Harmony cannot find a device:** check the chosen LAN interface, SSDP across VLANs, enabled protocols, and the hub address. The hub must scan the network; manually adding an IR-only Roku profile will not send commands to this plugin.
- **Device found, but no action:** open Recent commands. No entry indicates a routing, button-assignment, activity, or source-IP issue. An entry with an error indicates a target/permission/device problem.
- **Port conflict:** choose a free port, restart, and rediscover if necessary. Hue and Roku cannot share a port.
- **Saved settings differ from runtime:** restart this plugin’s child bridge, or Homebridge if running on the main bridge.
- **Logs:** on `hb-service` installations, inspect `/var/lib/homebridge/homebridge.log`.
- **Corrupt state file:** preserve it and correct the problem before restarting. The plugin refuses to silently replace an unreadable identity file.
