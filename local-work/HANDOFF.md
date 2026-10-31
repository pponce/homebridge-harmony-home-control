# Project handoff

## Objective

Build a Homebridge proxy that exposes selected existing accessories as an emulated Hue bridge and receives emulated Roku commands for Harmony button assignments. Provide a guided configuration UI. Keep all actual device ownership with the original plugins.

## Repository and branch

- Repository: https://github.com/pponce/homebridge-harmony-home-control
- Branch: main.
- Validated implementation commit: d34ee5848fa8a67818aeeed737dd023590e8a98b.
- Package: homebridge-harmony-home-control, 0.1.0-alpha.1.

## Implemented

- ESM platform, no new HomeKit accessories.
- HAP discovery, local main/child bridge credentials, custom writable characteristics, permission/range checks, bounded per-service command queues, explicit HAP error handling.
- Hue discovery/API, timed pairing, persistent identity/users/light IDs, on/off/dimming, groups.
- Roku descriptors/commands, activity-button mappings, hold/repeat protection, ignored power-management commands.
- Hub IP allowlist; authenticated loopback UI control channel; no credentials returned to browser.
- Guided UI: connection, accessory search, Hue/Roku editors, tests, save/restart guidance, pairing, recent events.
- Standalone SSDP advertisement helper for separate VLANs.
- Public setup/usage documentation and automated tests/CI.

## Validation checkpoint

- JavaScript syntax/JSON check passed.
- 17 local automated tests passed; one dependency/IPC smoke test skipped locally because the execution environment blocks npm registry downloads.
- Local Playwright execution could not start because the browser binary is absent and the environment blocks its download.
- GitHub Actions passed all 18 tests, syntax/JSON checks, and npm packaging on Node 22, 24, and 26 for the validated implementation commit.
- Browser workflow passed on Node 24: connection validation, accessory discovery, Hue add/edit/test, Roku mapping, preservation of child-bridge settings, save, pairing status, escaped names, and mobile layout.
- The Browser workflow details check contains the result. UI screenshots are attached to the successful run as the ui-checks artifact.
- No physical Harmony discovery or button test performed.

## Decisions and limits

- Physical remote assignment remains in Logitech's app. The plugin only maps protocol commands to existing accessory controls.
- Hue and Roku endpoints use separate configurable ports (18080 and 8060).
- Hardware pairing and Hue port compatibility must be verified; preview status is explicit.
- No Home Assistant, rooting, hub firmware changes, live Homebridge changes, or npm publication.
- Installation packages the checkout into local-work/artifacts and passes that tarball to hb-service add, providing an installed copy rather than a live development symlink.
- Native Apple Home accessories require a separate automation through a Homebridge accessory.
- Keep Homebridge Hue's explicit hosts list to prevent duplicate imports.
- Keep custom notes in local-work; package files exclude tests, notes, and artifacts.

## Next steps

1. Clone main to ~/devProjects/homebridge-harmony-home-control on the Homebridge host.
2. Package with npm pack --ignore-scripts into local-work/artifacts; install with hb-service stop, hb-service add <tarball>, hb-service start.
3. Open plugin settings, choose the host's LAN interface, enter allowed hub addresses, find accessories, and create one non-critical mapping.
4. Save, restart the plugin's bridge, and verify network discovery. Separate VLANs require SSDP forwarding or the provided advertisement helper; mDNS forwarding alone is insufficient.
5. Pair Hue and assign a home-control button, then discover Roku and assign an activity button. Confirm direct editor tests and physical remote presses independently.
6. Preserve state.json on updates. Review discovery/pairing logs before changing protocol compatibility behavior.
7. Only consider a release/npm publication after hardware verification and explicit publishing approval.
