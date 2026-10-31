# Harmony Home Control

Control existing Homebridge accessories with a Logitech Harmony remote. The plugin presents a virtual **Hue bridge** for dedicated home-control buttons and a virtual **Roku** for ordinary buttons in Harmony activities. Commands are forwarded to the original accessory plugins.

**Early preview:** the implementation has automated protocol and action tests. Discovery, mobile pairing, button behavior, and HTTP-port compatibility still require testing with a physical Harmony hub. Begin with one non-critical accessory. The plugin does not modify your Harmony configuration or publish duplicate HomeKit accessories.

## Requirements

- Homebridge 1.8+ or 2.x and Node.js 22.13 or newer.
- Homebridge UI for the guided configuration screen.
- Homebridge accessory control enabled (`-I`, commonly already enabled when the UI’s Accessories page works). The plugin reads the main and child-bridge PINs from the local Homebridge configuration; they are not entered into the plugin UI or returned to a browser.
- A Harmony hub and a compatible remote. Hue home-control features require a remote with the dedicated buttons. Roku mappings use activity control buttons.
- Stable IPv4 addresses for Homebridge and Harmony, plus network access described below.

The plugin operates through Homebridge’s local accessory-control interface. It does not pair with Apple Home or enumerate accessories paired directly to Apple Home. To reach those devices, expose a Homebridge virtual switch and connect it to an Apple Home automation.

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

Select **Find accessories**. The picker includes writable services on the main bridge and child bridges, with bridge identifiers to distinguish duplicate names. A multi-service accessory can have multiple entries. Read-only sensors, timed-write controls, additional-authorization controls, and binary data/TLV controls are not supported.

If you use `homebridge-hue`, set that plugin’s **Bridges** (`hosts`) list to your existing real bridges/deCONZ gateways. A nonempty list disables automatic discovery, preventing the emulator from being imported back into Homebridge. The UI calls attention to this setting without changing another plugin’s configuration.

### 2. Dedicated home-control buttons: Hue

Choose **Expose an accessory**, select its power control, and choose the values for On and Off. Common lights, outlets, and switches have an `On` control; newer fans may use `Active`. Non-light services are represented as virtual lights with explicitly chosen values. A long press can optionally do nothing.

Select an optional numeric dimming control, such as Brightness or Rotation Speed. The numeric range maps to Hue’s 0–254 brightness range. On/off values and numeric writes are checked against the accessory’s actual permissions and limits. **Test on/off** sends a real command directly to the accessory.

Save and restart the plugin’s bridge. In **Connect Harmony**, follow the steps to discover Philips Hue and use **Open pairing window** when asked to press the bridge link button. The window lasts two minutes, and linked users survive restarts. Mobile pairing varies; MyHarmony desktop with the remote connected over USB is an alternative.

Import the virtual lights, then assign them in Harmony’s **Remote & Hub → Button Customization → Home Control Buttons**. Short press sends On; long press sends Off. The dimming rocker controls a selected dimmable light/group. These assignments are independent of the current AV activity.

**Harmony supports one Hue bridge per hub.** If your hub already controls a physical Hue bridge, replacing that bridge in Harmony can require recreating its existing lighting assignments. You can expose the corresponding Homebridge light services through this proxy, or use Roku mappings while retaining Harmony’s current Hue bridge. The plugin does not replace or remove a bridge automatically.

Hue scenes, cloud login, color, schedules, and timed transitions are not implemented. `transitiontime` is accepted for interoperability, but changes are sent immediately. Multiple-characteristic commands are sequential rather than transactional: if a later write fails, an earlier successful write is not rolled back. Explicit power is applied after brightness so a combined brightness/off request ends off.

### 3. Other remote buttons: Roku

Choose **Add a button action**, select an accessory control, and choose **Set a value**, **Toggle**, **Increase**, or **Decrease**, where supported. Assign one of the available Roku commands to it. Each command has one mapping; several commands can address the same accessory.

Save and restart. Discover the virtual Roku through Harmony’s network scan. Its serial starts with `HHC`; Harmony may initially call it Roku 4. Rename it to **Homebridge Controls**, add it to each desired activity, then assign its commands to physical buttons through **Activity Control Buttons**. Sync the remote.

For example, assign a spare physical button to the virtual Roku’s `Play` command, and map `Play` to a Homebridge switch’s On value. Configure short and long presses in Harmony to send different commands when desired; the plugin receives Roku commands, not the identity of the physical button or active activity.

The dedicated home-control buttons use Hue, not Roku. App-launch commands are not offered because Harmony sends those through IR rather than the emulated Wi-Fi API. Automatic Roku PowerOff commands are acknowledged without triggering an accessory. Keydown repeats are suppressed until keyup or a ten-second timeout; very rapid repeats of the same key within 150 ms are ignored. Failed commands are not replayed automatically.

### 4. Check the result

Use **Recent commands** in the pairing screen to see the last 30 remote commands and failures. Editor tests act directly on an accessory and do not prove discovery or pairing. Check both the physical device and the log after a remote press.

Mappings are saved in Homebridge’s normal plugin configuration. Hue numeric IDs, the emulated device identities, groups, and pairing users are stored in `harmony-home-control/state.json` under Homebridge’s storage directory. Keep that file when updating; removing it changes the identities Harmony knows. Removed light IDs are never reused. Renaming a mapping preserves its ID, while deleting and recreating it creates a new one.

Accessory targets use bridge username, accessory ID, service ID, and characteristic UUID. Ordinary restarts preserve them. Removing and re-adding an original accessory may require remapping; unavailable targets are never reassigned automatically by name. State changes made elsewhere are refreshed approximately every 15 seconds. Toggle and relative adjustments read current state before writing.

## Network and separate VLANs

| Purpose | Default | Required reachability |
| --- | --- | --- |
| Hue HTTP | TCP 18080 | Harmony hub to Homebridge |
| Roku HTTP | TCP 8060 | Harmony hub to Homebridge |
| Discovery | UDP 1900, multicast 239.255.255.250 | Harmony discovery network |
| Homebridge accessory access | Existing HAP ports and mDNS | This plugin to main/child bridges |

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

Protocol tests use local HTTP and UDP sockets with a simulated HAP accessory. Browser tests exercise the configuration flow, preserve child-bridge settings, and check narrow-screen layout. CI installs the runtime dependencies and exercises their imports and the Homebridge UI IPC protocol. These checks do not substitute for a real Harmony pairing test.

No build step is required to install from a Git checkout. No publishing workflow is included.

## References

- [Homebridge HAP client](https://github.com/homebridge/hap-client)
- [Homebridge custom UI utilities](https://github.com/homebridge/plugin-ui-utils)
- [Roku External Control Protocol](https://developer.roku.com/dev/docs/external-control-api)
- [Emulated Roku compatibility notes](https://www.home-assistant.io/integrations/emulated_roku/)
- [Emulated Hue compatibility notes](https://www.home-assistant.io/integrations/emulated_hue/)
- [Harmony physical button assignments](https://support.myharmony.com/en-us/customizing-physical-buttons-on-your-remote)
- [Harmony home-control buttons](https://support.myharmony.com/en-be/customizing-home-control-buttons-remote)
- [Homebridge Hue bridge selection](https://github.com/ebaauw/homebridge-hue/wiki/Configuration)

This community plugin is not affiliated with Logitech, Philips/Signify, Roku, or Apple.
