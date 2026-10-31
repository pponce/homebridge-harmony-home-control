# Harmony Home Control

Control real Hue lights and existing Homebridge accessories with a Logitech Harmony remote. The plugin presents one combined virtual **Hue bridge** for dedicated home-control buttons and a virtual **Roku** for ordinary buttons in Harmony activities. Commands go directly to the selected physical Hue bridge or to the original Homebridge accessory plugin.

**Early preview:** the implementation has automated protocol and action tests. Discovery, mobile pairing, button behavior, and HTTP-port compatibility still require testing with a physical Harmony hub. Begin with one non-critical accessory. The plugin does not modify your Harmony configuration or publish duplicate HomeKit accessories.

## Requirements

- Homebridge 1.8+ or 2.x and Node.js 22.13 or newer.
- Homebridge UI for the guided configuration screen.
- For Homebridge accessory targets: accessory control enabled (`-I`, commonly already enabled when the UI’s Accessories page works). The plugin reads the main and child-bridge PINs from the local Homebridge configuration; they are not entered into the plugin UI or returned to a browser. Direct Hue targets do not require HAP accessory control.
- For direct Hue targets: a physical square Hue Bridge (BSB002) or Hue Bridge Pro (BSB003) with current firmware, reachable from Homebridge. Multiple bridges are supported. The original round bridge and emulated Hue/deCONZ bridges are not supported as direct Hue sources.
- A Harmony hub and a compatible remote. Hue home-control features require a remote with the dedicated buttons. Roku mappings use activity control buttons.
- Stable IPv4 addresses for Homebridge and Harmony, plus network access described below.

The plugin operates through Homebridge’s local accessory-control interface and the physical Hue Bridge’s local HTTPS API. It does not pair with Apple Home or enumerate Apple Home accessories. Hue devices can be selected directly from their physical bridge, independently of `homebridge-hue` or their Apple Home pairing. Other devices available only in Apple Home need a Homebridge virtual switch connected to an Apple Home automation.

## Install from GitHub

Clone this repository into a single working folder. For a private repository, authenticate Git on that machine first. Keep the checkout: it is the source for future updates.

On an `hb-service` installation, package the checkout and install the tarball with this sequence, substituting the checkout’s absolute path. Packaging gives Homebridge its own installed copy and avoids a live symlink into the development folder. The tarball stays under the project’s `local-work/artifacts` folder:

```bash
{
  printf '\n===== HARMONY HOME CONTROL INSTALL START =====\n'
  hhc_path="$HOME/devProjects/homebridge-harmony-home-control"
  if [ -f "$hhc_path/package.json" ]; then
    mkdir -p "$hhc_path/local-work/artifacts"
    if hhc_package="$(npm pack --ignore-scripts --pack-destination "$hhc_path/local-work/artifacts" "$hhc_path")"; then
      if sudo hb-service stop; then
        if sudo hb-service add "$hhc_path/local-work/artifacts/$hhc_package"; then
          printf 'Plugin installed.\n'
        else
          printf 'Installation failed; restarting Homebridge.\n'
        fi
        sudo hb-service start || printf 'Homebridge could not restart; inspect the Homebridge log.\n'
      else
        printf 'Could not stop Homebridge; installation was not attempted.\n'
      fi
    else
      printf 'Packaging failed; Homebridge was not stopped.\n'
    fi
  else
    printf 'Clone the repository into %s before installing.\n' "$hhc_path"
  fi
  printf '===== HARMONY HOME CONTROL INSTALL END =====\n'
}
```

Open **Plugins → Harmony Home Control → Settings**. If the platform has never been configured, save its connection settings and restart Homebridge so the platform can start. A child bridge is supported and recommended for isolating restarts. This proxy has no accessories to pair with Apple Home.

## Guided setup

### 1. Connection

Choose the Homebridge LAN interface, enter your Harmony hub’s IPv4 address, and enable Hue, Roku, or both. Multiple hub addresses can be entered with commas. Requests that perform actions are accepted only from these addresses; forwarding headers are not trusted.

Optionally select **Add Hue bridge** under **Real Hue bridges**:

1. Select **Find Hue bridges** and choose a discovered bridge, or enter its IPv4 address manually. Discovery is local and does not query Hue’s cloud; manual addresses are useful across VLANs.
2. Press the button on that **physical** Hue bridge, then select **Connect Hue bridge** within 30 seconds. This grants this plugin its own authorization. Reconnecting an already authorized bridge can reuse that authorization.
3. Repeat for additional physical Hue bridges. Only the devices you map to buttons are presented to Harmony.
4. Select **Find accessories**, then choose devices in either button editor. The **Device source** selector filters Homebridge devices and real Hue devices. Bridge labels distinguish identical names.

The combined picker includes Homebridge main/child-bridge services and the connected Hue bridges’ lights, plugs, and groups. A Hue group appears as one selectable control and sends commands to the physical bridge’s group API. On/off is supported; brightness is offered only for dimmable lights and groups. Read-only sensors, timed-write controls, additional-authorization controls, and binary data/TLV controls are not supported. Scenes, color, and color temperature are not available through this proxy.

Both mapping editors combine **Find an accessory**, **Device source**, and **Accessory types** checkboxes. Types include light bulbs, locks, switches, outlets, fans, blinds/curtains, doors/garages, climate controls, TVs/speakers, water/irrigation, security systems, Hue groups, and custom controls. Counts reflect the current search, source, and Harmony inclusion setting. Use **Clear types** to select just a few, **All types** to include maintenance services, or **Default types** to restore the usual device types.

Accessories from `homebridge-harmony` are hidden by default because Harmony already controls them. Enable **Include homebridge-harmony accessories** to select one deliberately. Identification uses that plugin’s Harmony manufacturer metadata or its dedicated child-bridge platform, not accessory display names or the Logitech manufacturer alone. **Setup & maintenance** services, including input configuration, filter resets, camera setup, and bridge management, are also unchecked by default. Unknown custom controls remain available. Devices are not automatically removed just because they are temporarily unavailable.

Naming and identification properties such as **Configured Name** and **Identify** are excluded from new actions. Configured Name renames an accessory; it is not a power command. Services with no supported action controls do not appear in new selections. Filters affect the picker only: existing mappings continue to work, and an existing selection outside the filters stays visible with an explanation. Existing metadata mappings remain editable with a notice so they are not silently changed.

Selecting **Expose an accessory** or **Add a button action** opens its editor immediately. If discovery is still needed, its progress appears inside the editor. An empty result leaves the draft open so you can refresh the accessory list without recreating the mapping.

**Test on/off** and **Test action** operate the selected real device. Save the mappings and restart this plugin’s bridge to apply them to Harmony. If a physical Hue bridge’s address changes, use **Reconnect / change address**; the bridge identity must still match. Remove a bridge’s mappings before removing its connection.

Physical Hue authorization is stored with owner-only permissions in `harmony-home-control/hue-bridges.json` under Homebridge’s storage directory. Keys are not returned to the browser or included in plugin configuration. Keep this file when updating. Authenticated HTTPS requests use the Hue CA certificates and identity validation provided by `hb-hue-tools`, the client library also used by Homebridge Hue; credentials are never sent over HTTP. Public bridge identification is read separately before authorization. No Hue account or cloud connection is required for direct control.

If you use `homebridge-hue`, set that plugin’s **Bridges** (`hosts`) list to your existing real bridges/deCONZ gateways. A nonempty list disables automatic discovery, preventing the emulator from being imported back into Homebridge. The UI calls attention to this setting without changing another plugin’s configuration.

### 2. Dedicated home-control buttons: Hue

Choose **Expose an accessory**, select its power control, and choose the values for On and Off. Common lights, outlets, and switches have an `On` control; newer fans may use `Active`. Non-light services are represented as virtual lights with explicitly chosen values. A long press can optionally do nothing.

**Device name in Harmony** is the name supplied for that virtual Hue light when Harmony imports it. It does not rename the original Homebridge or Hue device. After changing a name, save and restart the plugin; Harmony may need to refresh or reimport its device list to display the new name.

Saved cards show **Harmony Device Name: _chosen name_** and **Mapped Action: _accessory_ : _control and short/long-press values_**, plus the dimming control when assigned.

Select an optional numeric dimming control, such as Brightness or Rotation Speed. The numeric range maps to Hue’s 0–254 brightness range. On/off values and numeric writes are checked against the accessory’s actual permissions and limits. **Test on/off** sends a real command directly to the accessory.

Save and restart the plugin’s bridge. In **Connect Harmony**, follow the steps to discover Philips Hue and use **Open pairing window** when asked to press the bridge link button. The window lasts two minutes, and linked users survive restarts. Mobile pairing varies; MyHarmony desktop with the remote connected over USB is an alternative.

Import the virtual lights, then assign them in Harmony’s **Remote & Hub → Button Customization → Home Control Buttons**. Short press sends On; long press sends Off. The dimming rocker controls a selected dimmable light/group. These assignments are independent of the current AV activity.

**Harmony supports one Hue bridge per hub.** This plugin combines the selected devices from all connected physical Hue bridges and Homebridge into that one bridge. If Harmony currently connects directly to a physical Hue bridge, replace that connection **in Harmony** with the plugin’s emulated bridge, import the combined device list, and recreate the affected button and activity lighting assignments. Your physical bridge can stay connected to the Hue app, Apple Home, and other integrations. The plugin does not replace or remove Harmony’s existing bridge automatically. An alternative is to use only Roku mappings while retaining Harmony’s current direct Hue connection.

Hue scenes, cloud login, color, schedules, and timed transitions are not implemented. `transitiontime` is accepted for interoperability, but changes are sent immediately. Multiple-characteristic commands are sequential rather than transactional: if a later write fails, an earlier successful write is not rolled back. Explicit power is applied after brightness so a combined brightness/off request ends off.

### 3. Other remote buttons: Roku

Choose **Add a button action**, select an accessory control, and choose **Set a value**, **Toggle**, **Increase**, or **Decrease**, where supported. Assign one of the available Roku commands to it. Each command has one mapping; several commands can address the same accessory.

**Name Mapped Action** sets a label in this plugin. Saved cards show that name, **Harmony Selector: Roku device _command_** (for example, Play), and **Mapped Action: _accessory_ : _action_**. In Harmony, select the assigned Roku command rather than this label.

Save and restart. Discover the virtual Roku through Harmony’s network scan. Its serial starts with `HHC`; Harmony may initially call it Roku 4. Rename it to **Homebridge Controls**, add it to each desired activity, then assign its commands to physical buttons through **Activity Control Buttons**. Sync the remote.

For example, assign a spare physical button to the virtual Roku’s `Play` command, and map `Play` to a Homebridge switch’s On value. Configure short and long presses in Harmony to send different commands when desired; the plugin receives Roku commands, not the identity of the physical button or active activity.

The dedicated home-control buttons use Hue, not Roku. App-launch commands are not offered because Harmony sends those through IR rather than the emulated Wi-Fi API. Automatic Roku PowerOff commands are acknowledged without triggering an accessory. Keydown repeats are suppressed until keyup or a ten-second timeout; very rapid repeats of the same key within 150 ms are ignored. Failed commands are not replayed automatically.

### 4. Check the result

Use **Recent commands** in the pairing screen to see the last 30 remote commands and failures. Editor tests act directly on an accessory and do not prove discovery or pairing. Check both the physical device and the log after a remote press.

Mappings are saved in Homebridge’s normal plugin configuration. Hue numeric IDs, the emulated device identities, groups, and pairing users are stored in `harmony-home-control/state.json` under Homebridge’s storage directory. Keep that file when updating; removing it changes the identities Harmony knows. Removed light IDs are never reused. Renaming a mapping preserves its ID, while deleting and recreating it creates a new one.

Homebridge targets use bridge username, accessory ID, service ID, and characteristic UUID. Direct Hue lights use their physical bridge ID and Zigbee unique ID; Hue groups use their physical bridge ID and group ID. Ordinary restarts preserve mappings and Harmony’s virtual light IDs. Removing and re-adding a device or group may require remapping; unavailable targets are never reassigned automatically by name. The plugin verifies the original Hue light identity before a write so a replacement cannot inherit its commands through a reused numeric resource ID. State changes made elsewhere are refreshed approximately every 15 seconds. Toggle and relative adjustments read current state before writing. Failure of one physical Hue bridge does not disable the other bridges or Homebridge devices. Failed commands are not replayed automatically.

## Network and separate VLANs

| Purpose | Default | Required reachability |
| --- | --- | --- |
| Hue HTTP | TCP 18080 | Harmony hub to Homebridge |
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

The Hue/Roku interfaces use local HTTP because these legacy control protocols require it. Device descriptors are public for discovery; accessory lists and commands require an allowed hub address, and Hue additionally requires a paired user. IP filtering assumes a trusted LAN and does not authenticate a compromised host using an allowed address. The UI’s control channel binds only to loopback and uses a random token stored with owner-only permissions. Do not expose these ports on the Internet.

## Troubleshooting

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

## Development

```text
npm install
npm run check
npm test
npx playwright install chromium
npm run test:ui
npm pack
```

Protocol tests use local HTTP and UDP sockets with a simulated HAP accessory and simulated physical Hue bridges. They cover mixed routing, authorization, multiple bridges, group writes, state changes, unavailable devices, and stable identities. Browser tests exercise physical bridge discovery/pairing, source selection, mapping, child-bridge settings, and narrow-screen layout. CI installs the runtime dependencies and exercises their imports and the Homebridge UI IPC protocol. These checks do not substitute for testing real Hue hardware and Harmony pairing.

No build step is required to install from a Git checkout. No publishing workflow is included.

## References

- [Homebridge HAP client](https://github.com/homebridge/hap-client)
- [Hue client and discovery tools](https://github.com/ebaauw/hb-hue-tools)
- [Hue local API getting started](https://developers.meethue.com/develop/get-started-2/)
- [Homebridge custom UI utilities](https://github.com/homebridge/plugin-ui-utils)
- [Roku External Control Protocol](https://developer.roku.com/dev/docs/external-control-api)
- [Emulated Roku compatibility notes](https://www.home-assistant.io/integrations/emulated_roku/)
- [Emulated Hue compatibility notes](https://www.home-assistant.io/integrations/emulated_hue/)
- [Harmony physical button assignments](https://support.myharmony.com/en-us/customizing-physical-buttons-on-your-remote)
- [Harmony home-control buttons](https://support.myharmony.com/en-be/customizing-home-control-buttons-remote)
- [Homebridge Hue bridge selection](https://github.com/ebaauw/homebridge-hue/wiki/Configuration)

This community plugin is not affiliated with Logitech, Philips/Signify, Roku, or Apple.
