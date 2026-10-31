# Project handoff

## Objective

Build a Homebridge proxy that exposes selected existing accessories as an emulated Hue bridge and receives emulated Roku commands for Harmony button assignments. Provide a guided configuration UI. Keep all actual device ownership with the original plugins.

## Repository and branch

- Repository: https://github.com/pponce/homebridge-harmony-home-control
- Target branch: main (new repository).
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
- 16 local automated tests passed; one dependency/IPC smoke test skipped because the execution environment blocks npm registry downloads.
- Local Playwright execution could not start because the browser binary is absent and the environment blocks its download.
- GitHub Actions is configured to require the dependency/IPC check and run browser tests, with Node 22/24/26 coverage.
- No physical Harmony discovery or button test performed.

## Decisions and limits

- Physical remote assignment remains in Logitech's app. The plugin only maps protocol commands to existing accessory controls.
- Hue and Roku endpoints use separate configurable ports (18080 and 8060).
- Hardware pairing and Hue port compatibility must be verified; preview status is explicit.
- No Home Assistant, rooting, hub firmware changes, live Homebridge changes, or npm publication.
- Native Apple Home accessories require a separate automation through a Homebridge accessory.
- Keep Homebridge Hue's explicit hosts list to prevent duplicate imports.
- Keep custom notes in local-work; package files exclude tests, notes, and artifacts.

## Next steps

1. Complete implementation review and any remaining test fixes.
2. Push the reviewable preview to main and inspect CI.
3. Resolve CI failures if accessible, then update this checkpoint with exact results.
4. Install from the Git checkout on a Homebridge host, configure hub/interface, and test one non-critical accessory.
5. Verify cross-VLAN SSDP reachability, Hue pairing, Roku discovery, and physical button assignments.
6. Only consider a release/npm publication after hardware verification and explicit publishing approval.
